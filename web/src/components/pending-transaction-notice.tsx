"use client";

import { useEffect, useState } from "react";

import { arcPublicClient } from "@/lib/arc-public-client";
import { getCircleSession } from "@/lib/circle-client";
import {
  clearPendingTransaction,
  PENDING_TRANSACTION_GIVE_UP_MS,
  readInterruptedTransaction,
  type PendingTransaction,
} from "@/lib/pending-transactions";
import {
  explorerAddressUrl,
  explorerTxUrl,
  networkStorageKey,
} from "@/lib/showup-network";
import { SHOWUP_WALLET_CHANGED_EVENT } from "@/lib/showup-wallet";

const POLL_INTERVAL_MS = 5_000;
/** A success older than this was finished in an earlier visit: stay quiet. */
const QUIET_SUCCESS_AFTER_MS = 10 * 60 * 1000;
// Existing reservation and organizer components re-read on-chain state when
// either of these fires.
const CIRCLE_WALLET_CHANGED_EVENT = "showup-circle-wallet-changed";

type Outcome =
  | { state: "pending" }
  | { state: "success"; txHash?: string }
  | { state: "failed"; reason: string; txHash?: string }
  | { state: "unknown" };

type CircleResult = {
  status?: string;
  error?: string;
  transaction?: { state?: string; txHash?: string } | null;
};

/** Asks Circle (then the chain) for the result of exactly this transaction. */
async function checkCircle(
  pending: Extract<PendingTransaction, { kind: "circle" }>,
): Promise<Outcome> {
  const userId = window.localStorage.getItem(networkStorageKey("circle_user_id"));
  if (!userId) {
    return { state: "unknown" };
  }

  const session = await getCircleSession(userId);
  const response = await fetch("/api/circle/transactions/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      userToken: session.userToken,
      walletId: pending.walletId,
      refId: pending.refId,
      createdAfter: pending.createdAfter,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as CircleResult;
  const txHash = data.transaction?.txHash;

  if (response.status === 409) {
    return { state: "failed", reason: data.error ?? "The transaction failed.", txHash };
  }

  const state = data.status ?? data.transaction?.state;
  if (state === "COMPLETE" || state === "CONFIRMED") {
    // Circle reports success; confirm with the receipt when there is a hash.
    if (txHash) {
      const receipt = await arcPublicClient
        .getTransactionReceipt({ hash: txHash as `0x${string}` })
        .catch(() => null);
      if (receipt?.status === "reverted") {
        return { state: "failed", reason: "The transaction reverted on-chain.", txHash };
      }
      if (!receipt) {
        return { state: "pending" };
      }
    }
    return { state: "success", txHash };
  }

  return { state: "pending" };
}

async function checkBrowser(
  pending: Extract<PendingTransaction, { kind: "browser" }>,
): Promise<Outcome> {
  if (!pending.txHash) {
    // The wallet never returned a hash before the reload, so it may not
    // have been sent at all.
    return { state: "unknown" };
  }

  const receipt = await arcPublicClient
    .getTransactionReceipt({ hash: pending.txHash as `0x${string}` })
    .catch(() => null);

  if (!receipt) {
    return { state: "pending" };
  }

  return receipt.status === "success"
    ? { state: "success", txHash: pending.txHash }
    : { state: "failed", reason: "The transaction reverted on-chain.", txHash: pending.txHash };
}

/**
 * Shown after a reload that interrupted a transaction. It follows that
 * specific transaction (Circle reference or hash) until it succeeds or
 * fails, then asks the page to re-read on-chain state.
 */
export default function PendingTransactionNotice() {
  const [pending, setPending] = useState<PendingTransaction | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ state: "pending" });

  useEffect(() => {
    const record = readInterruptedTransaction();
    if (!record) {
      return;
    }

    let stopped = false;
    let timer = 0;

    const refreshPage = () => {
      window.dispatchEvent(new Event(SHOWUP_WALLET_CHANGED_EVENT));
      window.dispatchEvent(new Event(CIRCLE_WALLET_CHANGED_EVENT));
    };

    const poll = async () => {
      let result: Outcome;
      try {
        result =
          record.kind === "circle" ? await checkCircle(record) : await checkBrowser(record);
      } catch {
        result = { state: "pending" };
      }

      if (stopped) {
        return;
      }

      const age = Date.now() - record.startedAt;

      if (result.state === "success" && age > QUIET_SUCCESS_AFTER_MS) {
        // Finished long ago in an earlier visit; nothing to tell the user.
        clearPendingTransaction();
        return;
      }

      if (result.state === "pending" && age > PENDING_TRANSACTION_GIVE_UP_MS) {
        result = { state: "unknown" };
      }

      setPending(record);
      setOutcome(result);

      if (result.state === "pending") {
        timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      clearPendingTransaction();
      refreshPage();
    };

    timer = window.setTimeout(poll, 0);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!pending) {
    return null;
  }

  const txHash =
    outcome.state === "success" || outcome.state === "failed" ? outcome.txHash : undefined;

  const tone =
    outcome.state === "failed"
      ? "border-red-400/30 bg-red-400/10 text-red-100"
      : outcome.state === "success"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
        : "border-[#73d8ff]/20 bg-[#0b1025] text-[#b8e8ff]";

  return (
    <div className={`border-b px-6 py-3 text-center text-sm ${tone}`}>
      {outcome.state === "pending" ? (
        <>
          {pending.label} from {new Date(pending.startedAt).toLocaleTimeString()} is
          still confirming. This page will update when it settles.
        </>
      ) : outcome.state === "success" ? (
        <>{pending.label} confirmed on-chain.</>
      ) : outcome.state === "failed" ? (
        <>
          {pending.label} did not go through: {outcome.reason}
        </>
      ) : (
        <>
          The result of {pending.label.toLowerCase()} from{" "}
          {new Date(pending.startedAt).toLocaleTimeString()} could not be determined. Check
          your wallet&apos;s activity before trying again.
        </>
      )}{" "}
      {txHash ? (
        <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className="underline">
          View transaction
        </a>
      ) : outcome.state === "unknown" && pending.walletAddress ? (
        <a
          href={explorerAddressUrl(pending.walletAddress)}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View wallet activity
        </a>
      ) : null}{" "}
      {outcome.state !== "pending" ? (
        <button type="button" className="font-semibold underline" onClick={() => setPending(null)}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
