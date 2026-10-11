"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";

import {
  PREVIEW_TTL_MS,
  advanceTransfer,
  canReceive,
  discardTransfer,
  previewBridge,
  receiveTransfer,
  recoverFromBurnHash,
  startBridge,
  type BridgePreview,
  type BridgeRuntime,
} from "@/lib/mainnet-bridge/bridge-engine";
import { createBrowserBridgeRuntime } from "@/lib/mainnet-bridge/browser-runtime";
import {
  BRIDGE_CHAINS,
  CCTP_V2_TOKEN_MESSENGER,
  explorerTx,
  formatUsdcUnits,
  supportedSpeeds,
  type BridgeChainKey,
  type BridgeSpeed,
} from "@/lib/mainnet-bridge/cctp-routes";
import { loadTransfers, type BridgeDelivery, type BridgeTransfer } from "@/lib/mainnet-bridge/transfer-store";

import {
  Choice,
  Field,
  Notice,
  Panel,
  PrimaryButton,
  SecondaryButton,
  SummaryRow,
  TxLink,
  errorMessage,
  inputClass,
  shortHash,
} from "./wallet-tools-ui";

type Direction = "into-arc" | "out-of-arc";
type OtherChain = "ethereum" | "base";

const POLL_MS = 10_000;
const FORWARDING_GRACE_MS = 3 * 60_000;

function formatNative(value: bigint, symbol: string) {
  const text = Number(formatUnits(value, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return `${text} ${symbol}`;
}

const STATUS_LABEL: Record<BridgeTransfer["status"], string> = {
  "burn-requested": "Waiting for the burn signature",
  "burn-submitted": "Burn submitted — waiting for confirmation",
  "burn-failed": "Burn failed — nothing was burned",
  "awaiting-attestation": "Burned — waiting for Circle's attestation",
  "ready-to-mint": "Attested — ready to receive",
  "mint-submitted": "Receive submitted — waiting for confirmation",
  "mint-failed": "Receive failed — retry available",
  completed: "Completed",
  discarded: "Discarded",
};

function stepState(transfer: BridgeTransfer) {
  const s = transfer.status;
  const burnDone = !["burn-requested", "burn-submitted", "burn-failed", "discarded"].includes(s);
  const attested = ["ready-to-mint", "mint-submitted", "mint-failed", "completed"].includes(s);
  return [
    { label: "Burn", done: burnDone, failed: s === "burn-failed" },
    { label: "Attestation", done: attested, failed: false },
    { label: "Receive", done: s === "completed", failed: s === "mint-failed" },
  ];
}

export default function MainnetBridgePanel({
  owner,
  providerRdns,
}: {
  owner: Address;
  providerRdns: string;
}) {
  const [direction, setDirection] = useState<Direction>("into-arc");
  const [otherChain, setOtherChain] = useState<OtherChain>("base");
  const [amount, setAmount] = useState("");
  const [speed, setSpeed] = useState<BridgeSpeed>("standard");
  const [delivery, setDelivery] = useState<BridgeDelivery>("forwarding");
  const [preview, setPreview] = useState<BridgePreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [transfers, setTransfers] = useState<BridgeTransfer[]>([]);
  const [recoverHash, setRecoverHash] = useState("");
  const [recoverChain, setRecoverChain] = useState<BridgeChainKey>("base");
  const [walletWarning, setWalletWarning] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const runtimeRef = useRef<Promise<BridgeRuntime & { provider: unknown }> | null>(null);
  const inFlight = useRef(new Set<string>());

  const from: BridgeChainKey = direction === "into-arc" ? otherChain : "arc";
  const to: BridgeChainKey = direction === "into-arc" ? "arc" : otherChain;
  const speeds = supportedSpeeds(from);
  const effectiveSpeed: BridgeSpeed = speeds.includes(speed) ? speed : "standard";

  const reload = useCallback(() => {
    try {
      setTransfers(loadTransfers(window.localStorage, owner));
    } catch {
      setTransfers([]);
    }
  }, [owner]);

  const getRuntime = useCallback(() => {
    if (!runtimeRef.current) {
      runtimeRef.current = createBrowserBridgeRuntime(providerRdns).catch((cause) => {
        runtimeRef.current = null;
        throw cause;
      });
    }
    return runtimeRef.current;
  }, [providerRdns]);

  // Reset when the wallet changes.
  useEffect(() => {
    runtimeRef.current = null;
    const timer = window.setTimeout(() => {
      setPreview(null);
      reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [owner, providerRdns, reload]);

  // Watch for account/network switches in the wallet.
  useEffect(() => {
    let detach = () => {};
    getRuntime()
      .then((runtime) => {
        const provider = runtime.provider as {
          on?: (event: string, handler: (value: unknown) => void) => void;
          removeListener?: (event: string, handler: (value: unknown) => void) => void;
        };
        const onAccounts = (accounts: unknown) => {
          const active = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
          setWalletWarning(
            active.toLowerCase() === owner.toLowerCase()
              ? ""
              : "Your wallet switched to a different account. Bridge actions are paused until you switch back.",
          );
          setPreview(null);
        };
        const onChain = () => setPreview(null);
        provider.on?.("accountsChanged", onAccounts);
        provider.on?.("chainChanged", onChain);
        detach = () => {
          provider.removeListener?.("accountsChanged", onAccounts);
          provider.removeListener?.("chainChanged", onChain);
        };
      })
      .catch(() => {});
    return () => detach();
  }, [getRuntime, owner]);

  const onProgress = useCallback(() => reload(), [reload]);

  const pollOne = useCallback(
    async (transfer: BridgeTransfer) => {
      if (inFlight.current.has(transfer.id)) return;
      inFlight.current.add(transfer.id);
      try {
        await advanceTransfer(await getRuntime(), transfer, onProgress);
      } catch (cause) {
        console.error("Bridge status check failed:", cause);
      } finally {
        inFlight.current.delete(transfer.id);
        reload();
      }
    },
    [getRuntime, onProgress, reload],
  );

  // Resume and poll unfinished transfers (also after a refresh).
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      for (const transfer of loadTransfers(window.localStorage, owner)) {
        const pollable =
          transfer.status === "burn-submitted" ||
          transfer.status === "awaiting-attestation" ||
          transfer.status === "mint-submitted" ||
          transfer.status === "mint-failed" ||
          (transfer.status === "ready-to-mint" && transfer.delivery === "forwarding");
        if (pollable) void pollOne(transfer);
      }
    };
    tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(interval);
  }, [owner, pollOne]);

  // Keep the quote countdown fresh.
  useEffect(() => {
    if (!preview) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [preview]);

  const previewExpired = preview ? now - preview.quotedAt > PREVIEW_TTL_MS : false;
  const previewSecondsLeft = preview ? Math.max(0, Math.ceil((preview.quotedAt + PREVIEW_TTL_MS - now) / 1000)) : 0;
  const activeTransfers = useMemo(() => transfers.filter((t) => t.status !== "discarded"), [transfers]);
  const blockedByPending = transfers.some((t) => t.status === "burn-requested");

  function resetPreview() {
    setPreview(null);
    setError("");
  }

  async function handleReview() {
    setError("");
    setPreview(null);
    setBusy("review");
    try {
      const runtime = await getRuntime();
      setPreview(await previewBridge(runtime, { owner, from, to, amountText: amount, speed: effectiveSpeed, delivery }));
      setNow(Date.now());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setError("");
    setBusy("bridge");
    try {
      await startBridge(await getRuntime(), preview, onProgress);
      setPreview(null);
      setAmount("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
      reload();
    }
  }

  async function handleReceive(transfer: BridgeTransfer) {
    setError("");
    setBusy(`receive:${transfer.id}`);
    inFlight.current.add(transfer.id);
    try {
      await receiveTransfer(await getRuntime(), transfer, onProgress);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current.delete(transfer.id);
      setBusy(null);
      reload();
    }
  }

  async function handleRecover() {
    setError("");
    setBusy("recover");
    try {
      await recoverFromBurnHash(await getRuntime(), { owner, from: recoverChain, burnTxHash: recoverHash.trim() as Hex }, onProgress);
      setRecoverHash("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
      reload();
    }
  }

  async function handleDiscard(transfer: BridgeTransfer) {
    if (
      !window.confirm(
        "Discard only if your wallet shows no burn transaction for this transfer. If a burn was sent, recover it with its transaction hash instead.",
      )
    ) {
      return;
    }
    try {
      discardTransfer(await getRuntime(), transfer);
    } catch (cause) {
      setError(errorMessage(cause));
    }
    reload();
  }

  const sourceLabel = BRIDGE_CHAINS[from].label;
  const destinationLabel = BRIDGE_CHAINS[to].label;
  const locked = busy !== null || Boolean(walletWarning);

  return (
    <Panel
      title="New transfer"
      subtitle={
        <>
          USDC is burned on the source network and minted on the destination after Circle confirms the burn
          (Circle CCTP). Progress is saved in this browser, so you can leave and come back.
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Direction">
          <Choice<Direction>
            columns={2}
            value={direction}
            disabled={locked}
            onChange={(value) => {
              setDirection(value);
              resetPreview();
            }}
            options={[
              { value: "into-arc", label: "Into Arc" },
              { value: "out-of-arc", label: "Out of Arc" },
            ]}
          />
        </Field>

        <Field label={direction === "into-arc" ? "From network" : "To network"}>
          <Choice<OtherChain>
            columns={2}
            value={otherChain}
            disabled={locked}
            onChange={(value) => {
              setOtherChain(value);
              resetPreview();
            }}
            options={[
              { value: "base", label: "Base" },
              { value: "ethereum", label: "Ethereum" },
            ]}
          />
        </Field>

        <Field label="Amount (USDC)">
          <input
            className={inputClass}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={locked}
            onChange={(event) => {
              setAmount(event.target.value);
              resetPreview();
            }}
          />
        </Field>

        <Field label="Speed">
          <Choice<BridgeSpeed>
            value={effectiveSpeed}
            disabled={locked}
            onChange={(value) => {
              setSpeed(value);
              resetPreview();
            }}
            options={[
              { value: "standard", label: "Standard", hint: `No CCTP fee, ${BRIDGE_CHAINS[from].standardWaitLabel}` },
              ...(speeds.includes("fast")
                ? [{ value: "fast" as const, label: "Fast", hint: "Seconds, small CCTP fee" }]
                : []),
            ]}
          />
          {!speeds.includes("fast") ? (
            <p className="mt-2 text-xs text-white/40">
              Circle does not offer Fast Transfer from Arc; standard attestation from Arc is already quick.
            </p>
          ) : null}
        </Field>

        <Field label="Delivery on the destination">
          <Choice<BridgeDelivery>
            value={delivery}
            disabled={locked}
            onChange={(value) => {
              setDelivery(value);
              resetPreview();
            }}
            options={[
              {
                value: "forwarding",
                label: "Circle delivers",
                hint: `Circle's Forwarding Service submits the receive transaction; its fee is taken from the USDC. No ${BRIDGE_CHAINS[to].nativeSymbol} needed on ${destinationLabel}.`,
              },
              {
                value: "self",
                label: "I receive it myself",
                hint: `You sign the receive transaction on ${destinationLabel} and pay its gas in ${BRIDGE_CHAINS[to].nativeSymbol}.`,
              },
            ]}
          />
        </Field>

        {!preview ? (
          <PrimaryButton onClick={handleReview} disabled={locked || !amount.trim() || blockedByPending}>
            {busy === "review" ? "Checking balances and fees…" : "Review transfer"}
          </PrimaryButton>
        ) : (
          <div className="rounded-2xl border border-[#79b7ff]/14 bg-[#070c1d] p-4">
            <p className="text-sm font-semibold text-white">Review before signing</p>
            <div className="mt-2 divide-y divide-white/5">
              <SummaryRow label="From" value={`${sourceLabel} (chain ${BRIDGE_CHAINS[from].chainId})`} />
              <SummaryRow label="To" value={`${destinationLabel} (chain ${BRIDGE_CHAINS[to].chainId})`} />
              <SummaryRow label="Token" value="USDC → USDC" />
              <SummaryRow label="Amount burned" value={`${formatUsdcUnits(preview.amount)} USDC`} strong />
              <SummaryRow
                label={preview.request.speed === "fast" ? "CCTP Fast Transfer fee (est.)" : "CCTP fee (standard transfer)"}
                value={`${formatUsdcUnits(preview.fees.protocolFee)} USDC`}
              />
              {preview.request.delivery === "forwarding" ? (
                <SummaryRow label="Circle forwarding fee (est.)" value={`${formatUsdcUnits(preview.fees.forwardFee)} USDC`} />
              ) : null}
              <SummaryRow label="Maximum fee (enforced on-chain)" value={`${formatUsdcUnits(preview.fees.maxFee)} USDC`} />
              <SummaryRow label="Expected to receive" value={`${formatUsdcUnits(preview.fees.expectedReceived)} USDC`} strong />
              <SummaryRow label="Guaranteed minimum" value={`${formatUsdcUnits(preview.fees.minimumReceived)} USDC`} />
              <SummaryRow
                label={`Network fee on ${sourceLabel} (est.)`}
                value={`${formatNative(preview.sourceGas.cost, preview.sourceGas.symbol)} · you have ${formatNative(preview.sourceGas.balance, preview.sourceGas.symbol)}`}
              />
              {preview.destinationGas ? (
                <SummaryRow
                  label={`Network fee on ${destinationLabel} (est.)`}
                  value={`${formatNative(preview.destinationGas.cost, preview.destinationGas.symbol)} · you have ${formatNative(preview.destinationGas.balance, preview.destinationGas.symbol)}`}
                />
              ) : null}
              <SummaryRow
                label="Approval"
                value={
                  preview.needsApproval
                    ? `Exactly ${formatUsdcUnits(preview.amount)} USDC to Circle TokenMessengerV2 ${shortHash(CCTP_V2_TOKEN_MESSENGER)}`
                    : "Not needed (existing allowance)"
                }
              />
              <SummaryRow label="Recipient" value={<span className="font-mono text-xs">{owner}</span>} />
            </div>

            {preview.problems.map((problem) => (
              <Notice key={problem} tone="warn">
                {problem}
              </Notice>
            ))}

            <p className="mt-3 text-xs text-white/40">
              {previewExpired ? "This quote expired." : `Quote valid for ${previewSecondsLeft}s.`} Your wallet will ask you
              to {preview.needsApproval ? "approve USDC, then " : ""}sign the burn on {sourceLabel}.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <SecondaryButton onClick={resetPreview} disabled={busy !== null}>
                Edit
              </SecondaryButton>
              {previewExpired ? (
                <PrimaryButton onClick={handleReview} disabled={locked}>
                  Refresh quote
                </PrimaryButton>
              ) : (
                <PrimaryButton onClick={handleConfirm} disabled={locked || preview.problems.length > 0}>
                  {busy === "bridge" ? "Confirm in your wallet, then wait for the burn…" : `Bridge ${formatUsdcUnits(preview.amount)} USDC`}
                </PrimaryButton>
              )}
            </div>
          </div>
        )}

        {blockedByPending && !preview ? (
          <Notice tone="warn">
            A previous transfer was interrupted while its burn was being signed. Resolve it below (recover it by
            transaction hash or discard it) before starting a new transfer, so USDC is never burned twice.
          </Notice>
        ) : null}
        {walletWarning ? <Notice tone="warn">{walletWarning}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>

      {activeTransfers.length > 0 ? (
        <div className="mt-8">
          <p className="text-sm font-semibold text-white/80">Your transfers</p>
          <ul className="mt-3 grid gap-3">
            {activeTransfers.map((transfer) => (
              <TransferCard
                key={transfer.id}
                transfer={transfer}
                now={now}
                busy={busy}
                locked={locked}
                onReceive={() => handleReceive(transfer)}
                onDiscard={() => handleDiscard(transfer)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <details className="mt-6 rounded-2xl border border-[#79b7ff]/12 bg-[#070c1d]/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white/75">Recover a transfer by burn transaction</summary>
        <p className="mt-2 text-sm leading-6 text-white/45">
          If a burn was sent but does not appear above (for example, the page closed while signing, or it was started
          in another browser), paste its transaction hash. The app reads it from the chain and continues from the
          attestation step; it never burns again.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
          <select
            className={inputClass}
            value={recoverChain}
            disabled={busy !== null}
            onChange={(event) => setRecoverChain(event.target.value as BridgeChainKey)}
          >
            <option value="base">Base</option>
            <option value="ethereum">Ethereum</option>
            <option value="arc">Arc</option>
          </select>
          <input
            className={`${inputClass} font-mono text-xs`}
            placeholder="0x… burn transaction hash"
            value={recoverHash}
            disabled={busy !== null}
            onChange={(event) => setRecoverHash(event.target.value)}
          />
        </div>
        <div className="mt-3">
          <SecondaryButton onClick={handleRecover} disabled={busy !== null || !/^0x[0-9a-fA-F]{64}$/.test(recoverHash.trim())}>
            {busy === "recover" ? "Recovering…" : "Recover transfer"}
          </SecondaryButton>
        </div>
      </details>
    </Panel>
  );
}

function TransferCard({
  transfer,
  now,
  busy,
  locked,
  onReceive,
  onDiscard,
}: {
  transfer: BridgeTransfer;
  now: number;
  busy: string | null;
  locked: boolean;
  onReceive: () => void;
  onDiscard: () => void;
}) {
  const from = BRIDGE_CHAINS[transfer.from];
  const to = BRIDGE_CHAINS[transfer.to];
  const forwardingPending = transfer.delivery === "forwarding" && transfer.status === "ready-to-mint";
  // Give Circle's forwarder a few minutes before offering a self-receive fallback.
  const receivable = canReceive(transfer, now) && (!forwardingPending || now - transfer.updatedAt > FORWARDING_GRACE_MS);
  const receiving = busy === `receive:${transfer.id}`;
  const tone =
    transfer.status === "completed"
      ? "text-emerald-200"
      : transfer.status === "burn-failed" || transfer.status === "mint-failed"
        ? "text-red-200"
        : "text-[#9bddff]";

  return (
    <li className="rounded-2xl border border-[#79b7ff]/12 bg-[#070c1d] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          {formatUsdcUnits(BigInt(transfer.amount))} USDC · {from.label} → {to.label}
        </p>
        <p className="text-xs text-white/40">{new Date(transfer.createdAt).toLocaleString()}</p>
      </div>
      <p className={`mt-1 text-sm ${tone}`}>{STATUS_LABEL[transfer.status]}</p>

      <ol className="mt-3 flex gap-2 text-xs">
        {stepState(transfer).map((step) => (
          <li
            key={step.label}
            className={`rounded-full border px-3 py-1 ${
              step.failed
                ? "border-red-400/40 text-red-200"
                : step.done
                  ? "border-emerald-300/40 text-emerald-200"
                  : "border-white/10 text-white/40"
            }`}
          >
            {step.done ? "✓ " : ""}
            {step.label}
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-1 text-xs text-white/50">
        <span>
          {transfer.speed === "fast" ? "Fast" : "Standard"} ·{" "}
          {transfer.delivery === "forwarding" ? "Circle delivers" : "Self receive"} · max fee{" "}
          {formatUsdcUnits(BigInt(transfer.maxFee))} USDC
        </span>
        {transfer.burnTxHash ? (
          <span>
            Burn on {from.label}: <TxLink href={explorerTx(transfer.from, transfer.burnTxHash)} label={shortHash(transfer.burnTxHash)} />
          </span>
        ) : null}
        {transfer.mintTxHash ? (
          <span>
            Receive on {to.label}: <TxLink href={explorerTx(transfer.to, transfer.mintTxHash)} label={shortHash(transfer.mintTxHash)} />
          </span>
        ) : null}
        {transfer.status === "completed" ? (
          <span className="text-emerald-200/80">
            {transfer.receivedAmount
              ? `Received ${formatUsdcUnits(BigInt(transfer.receivedAmount))} USDC on ${to.label}.`
              : transfer.completedBy === "already-received"
                ? `Confirmed on ${to.label}: this transfer's message has been received.`
                : `Received on ${to.label}.`}
          </span>
        ) : null}
      </div>

      {transfer.status === "awaiting-attestation" ? (
        <p className="mt-2 text-xs text-white/45">
          Waiting for Circle&apos;s attestation: {transfer.speed === "fast" ? "usually seconds" : from.standardWaitLabel}.
          Checked automatically every few seconds.
        </p>
      ) : null}
      {forwardingPending ? (
        <p className="mt-2 text-xs text-white/45">
          Circle is submitting the receive transaction. If it has not arrived after a few minutes, you can receive it
          yourself with the same attestation (the burn is not repeated).
        </p>
      ) : null}
      {transfer.status === "burn-requested" ? (
        <Notice tone="warn">
          The page closed or the wallet disconnected while the burn was being signed. Check your wallet activity on{" "}
          {from.label}. If a burn transaction was sent, recover it with its hash below; otherwise discard this entry.
        </Notice>
      ) : null}
      {transfer.lastError && transfer.status !== "completed" ? (
        <p className="mt-2 text-xs text-amber-200/80">{transfer.lastError}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {receivable ? (
          <SecondaryButton onClick={onReceive} disabled={locked}>
            {receiving
              ? "Confirm in your wallet…"
              : transfer.status === "mint-failed" || transfer.status === "mint-submitted"
                ? `Retry receive on ${to.label}`
                : forwardingPending
                  ? `Receive myself on ${to.label}`
                  : `Receive on ${to.label}`}
          </SecondaryButton>
        ) : null}
        {transfer.status === "burn-requested" ? (
          <SecondaryButton onClick={onDiscard} disabled={locked}>
            Discard (no burn was sent)
          </SecondaryButton>
        ) : null}
      </div>
    </li>
  );
}
