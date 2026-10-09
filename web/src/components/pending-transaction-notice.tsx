"use client";

import { useEffect, useState } from "react";

import {
  clearPendingTransaction,
  PENDING_TRANSACTION_WINDOW_MS,
  readInterruptedTransaction,
} from "@/lib/pending-transactions";
import { SHOWUP_WALLET_CHANGED_EVENT } from "@/lib/showup-wallet";

const REFRESH_INTERVAL_MS = 15_000;

// Existing reservation and organizer components re-read on-chain state when
// either of these fires.
const CIRCLE_WALLET_CHANGED_EVENT = "showup-circle-wallet-changed";

/**
 * Shown after a reload that interrupted a transaction. While the window is
 * open it periodically asks every component to re-read on-chain state (the
 * same signals used when the active wallet changes).
 */
export default function PendingTransactionNotice() {
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    const pending = readInterruptedTransaction();
    if (!pending) {
      return;
    }

    // Deferred so the first render matches the server-rendered markup.
    const show = window.setTimeout(() => setStartedAt(pending.startedAt), 0);

    const refresh = window.setInterval(() => {
      window.dispatchEvent(new Event(SHOWUP_WALLET_CHANGED_EVENT));
      window.dispatchEvent(new Event(CIRCLE_WALLET_CHANGED_EVENT));
    }, REFRESH_INTERVAL_MS);

    const finish = window.setTimeout(
      () => {
        window.clearInterval(refresh);
        clearPendingTransaction();
        setStartedAt(null);
      },
      Math.max(0, pending.startedAt + PENDING_TRANSACTION_WINDOW_MS - Date.now()),
    );

    return () => {
      window.clearTimeout(show);
      window.clearInterval(refresh);
      window.clearTimeout(finish);
    };
  }, []);

  if (startedAt === null) {
    return null;
  }

  return (
    <div className="border-b border-[#73d8ff]/20 bg-[#0b1025] px-6 py-3 text-center text-sm text-[#b8e8ff]">
      A transaction you approved at{" "}
      {new Date(startedAt).toLocaleTimeString()} may still be confirming.
      The status on this page is read from the chain and refreshes
      automatically.{" "}
      <button
        type="button"
        className="font-semibold underline"
        onClick={() => {
          clearPendingTransaction();
          setStartedAt(null);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
