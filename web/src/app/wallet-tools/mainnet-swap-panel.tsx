"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";

import { arcPublicClient } from "@/lib/arc-public-client";
import { findBrowserWalletProvider, getArcFeeOverrides } from "@/lib/browser-wallet";
import { explorerTxUrl } from "@/lib/showup-network";
import {
  ARC_MAINNET_CHAIN_ID,
  CIRCLE_SWAP_ADAPTER,
  DEFAULT_SLIPPAGE_BPS,
  SLIPPAGE_OPTIONS_BPS,
  SWAP_TOKENS,
  formatTokenUnits,
  isQuoteExpired,
  loadSwaps,
  otherToken,
  quoteSecondsLeft,
  saveSwap,
  type StoredSwap,
  type SwapQuote,
  type SwapTokenSymbol,
} from "@/lib/mainnet-swap/swap-logic";
import { checkSwapTransaction, createSwapSession, describeSwapError, type SwapSession } from "@/lib/mainnet-swap/swap-runtime";

import {
  Choice,
  Field,
  Notice,
  Panel,
  PrimaryButton,
  SecondaryButton,
  SummaryRow,
  TxLink,
  inputClass,
  shortHash,
} from "./wallet-tools-ui";

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Approval (EURC) + swap execution, with headroom. */
const SWAP_GAS_BUDGET = BigInt(450_000);
const NATIVE_TO_USDC = BigInt(1_000_000_000_000);

type Funds = { tokenIn: bigint; usdc: bigint; gasUsdc: bigint };

async function readFunds(owner: Address, tokenIn: SwapTokenSymbol): Promise<Funds> {
  const [tokenBalance, usdc, fees] = await Promise.all([
    arcPublicClient.readContract({
      address: SWAP_TOKENS[tokenIn].address,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    arcPublicClient.readContract({
      address: SWAP_TOKENS.USDC.address,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    getArcFeeOverrides(() => arcPublicClient.estimateFeesPerGas()),
  ]);
  const gasNative = fees.maxFeePerGas * SWAP_GAS_BUDGET;
  return { tokenIn: tokenBalance, usdc, gasUsdc: (gasNative + NATIVE_TO_USDC - BigInt(1)) / NATIVE_TO_USDC };
}

function fundsProblem(quote: SwapQuote, funds: Funds) {
  if (funds.tokenIn < quote.amountIn) {
    return `Insufficient ${quote.tokenIn} on Arc.`;
  }
  // Network fees on Arc are paid in USDC.
  const usdcNeeded = funds.gasUsdc + (quote.tokenIn === "USDC" ? quote.amountIn : BigInt(0));
  if (funds.usdc < usdcNeeded) {
    return "Not enough USDC on Arc to cover the network fee.";
  }
  return null;
}

export default function MainnetSwapPanel({ owner, providerRdns }: { owner: Address; providerRdns: string }) {
  const [tokenIn, setTokenIn] = useState<SwapTokenSymbol>("USDC");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [funds, setFunds] = useState<Funds | null>(null);
  const [busy, setBusy] = useState<"quote" | "swap" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ tone: "success" | "error" | "warn"; text: string; txHash?: Hex } | null>(null);
  const [history, setHistory] = useState<StoredSwap[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef<Promise<SwapSession> | null>(null);
  const tokenOut = otherToken(tokenIn);

  const reload = useCallback(() => {
    try {
      setHistory(loadSwaps(window.localStorage, owner));
    } catch {
      setHistory([]);
    }
  }, [owner]);

  const getSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = createSwapSession({ providerRdns, owner }).catch((cause) => {
        sessionRef.current = null;
        throw cause;
      });
    }
    return sessionRef.current;
  }, [owner, providerRdns]);

  const [rechecking, setRechecking] = useState<string | null>(null);
  const [walletWarning, setWalletWarning] = useState("");
  /** Bumped on every wallet account/network change; results from an older epoch are discarded. */
  const epochRef = useRef(0);

  // Like the bridge panel: an account or network switch in the wallet clears the
  // quote and invalidates any confirmation in progress, so nothing continues
  // with the old context.
  useEffect(() => {
    let detached = false;
    let detach = () => {};
    const invalidate = () => {
      epochRef.current += 1;
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.then((active) => active.cancel()).catch(() => {});
      setQuote(null);
      setFunds(null);
    };
    findBrowserWalletProvider(providerRdns)
      .then(({ provider }) => {
        if (detached) return;
        const events = provider as unknown as {
          on?: (event: string, handler: (value: unknown) => void) => void;
          removeListener?: (event: string, handler: (value: unknown) => void) => void;
        };
        const onAccounts = (accounts: unknown) => {
          invalidate();
          const active = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
          setWalletWarning(
            active.toLowerCase() === owner.toLowerCase()
              ? ""
              : "Your wallet switched to a different account. Swapping is paused until you switch back.",
          );
        };
        const onChain = (chainId: unknown) => {
          // The swap itself switches the wallet to Arc; only leaving Arc invalidates it.
          if (typeof chainId === "string" && /^0x[0-9a-f]+$/i.test(chainId) && Number(BigInt(chainId)) === ARC_MAINNET_CHAIN_ID) {
            return;
          }
          invalidate();
          setError("");
          setResult({ tone: "warn", text: "Your wallet left Arc mainnet, so the quote was cleared. Get a new quote to continue." });
        };
        events.on?.("accountsChanged", onAccounts);
        events.on?.("chainChanged", onChain);
        detach = () => {
          events.removeListener?.("accountsChanged", onAccounts);
          events.removeListener?.("chainChanged", onChain);
        };
      })
      .catch(() => {});
    return () => {
      detached = true;
      detach();
    };
  }, [owner, providerRdns]);

  /** Re-verifies a submitted swap from its Arc receipt. Only a proven result is stored. */
  const recheck = useCallback(
    async (swap: StoredSwap, timeoutMs?: number) => {
      const outcome = await checkSwapTransaction(
        owner,
        swap.txHash,
        { tokenOut: swap.tokenOut, minimumOut: BigInt(swap.minimumOut) },
        timeoutMs,
      );
      if (outcome.state === "success" || outcome.state === "failed") {
        saveSwap(window.localStorage, {
          ...swap,
          status: outcome.state,
          ...(outcome.state === "success" ? { received: outcome.received.toString() } : {}),
        });
      }
      return outcome;
    },
    [owner],
  );

  // Reset on wallet change and resume checking swaps submitted before a refresh.
  useEffect(() => {
    sessionRef.current = null;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQuote(null);
      setResult(null);
      reload();
      for (const swap of loadSwaps(window.localStorage, owner).filter((entry) => entry.status === "submitted")) {
        void recheck(swap).then(() => {
          if (!cancelled) reload();
        });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [owner, providerRdns, reload, recheck]);

  async function handleRecheck(swap: StoredSwap) {
    setRechecking(swap.txHash);
    try {
      const outcome = await recheck(swap, 15_000);
      if (outcome.state === "pending" || outcome.state === "unknown") {
        setResult({ tone: "warn", text: outcome.reason, txHash: swap.txHash });
      }
    } finally {
      setRechecking(null);
      reload();
    }
  }

  useEffect(() => {
    if (!quote) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [quote]);

  function reset() {
    setQuote(null);
    setFunds(null);
    setError("");
  }

  async function handleQuote() {
    reset();
    setResult(null);
    setBusy("quote");
    const epoch = epochRef.current;
    try {
      const session = await getSession();
      const [nextQuote, nextFunds] = await Promise.all([
        session.quote({ tokenIn, tokenOut, amountText: amount, slippageBps }),
        readFunds(owner, tokenIn),
      ]);
      // The wallet changed while the quote was loading: discard it.
      if (epoch !== epochRef.current) return;
      setQuote(nextQuote);
      setFunds(nextFunds);
      setNow(Date.now());
    } catch (cause) {
      if (epoch === epochRef.current) setError(describeSwapError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function handleSwap() {
    if (!quote || walletWarning) return;
    setError("");
    setBusy("swap");
    const epoch = epochRef.current;
    const expected = { tokenOut: quote.tokenOut, minimumOut: quote.minimumOut };
    const record = (txHash: Hex): StoredSwap => ({
      version: 1,
      owner,
      txHash,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn.toString(),
      minimumOut: quote.minimumOut.toString(),
      createdAt: Date.now(),
      status: "submitted",
    });
    try {
      const session = await getSession();
      const { txHash, outcome } = await session.execute(quote, (hash, kind) => {
        // Saved the moment the wallet returns the hash, so a refresh can verify it.
        if (kind === "swap") {
          saveSwap(window.localStorage, record(hash));
          reload();
        }
      });
      const stored = { ...record(txHash), ...(loadSwaps(window.localStorage, owner).find((s) => s.txHash === txHash) ?? {}) };
      if (outcome.state === "success") {
        saveSwap(window.localStorage, { ...stored, status: "success", received: outcome.received.toString() });
        setResult({
          tone: "success",
          text: `Swap confirmed on-chain. You received ${formatTokenUnits(outcome.received, SWAP_TOKENS[expected.tokenOut].decimals)} ${expected.tokenOut}.`,
          txHash,
        });
        setAmount("");
      } else if (outcome.state === "failed") {
        saveSwap(window.localStorage, { ...stored, status: "failed" });
        setResult({ tone: "error", text: outcome.reason, txHash });
      } else {
        saveSwap(window.localStorage, stored);
        setResult({ tone: "warn", text: `${outcome.reason} The status is checked again when you reopen this page.`, txHash });
      }
      setQuote(null);
    } catch (cause) {
      setError(
        epoch !== epochRef.current
          ? "Your wallet changed account or network, so the swap was stopped before anything else was signed. Get a new quote."
          : describeSwapError(cause),
      );
    } finally {
      setBusy(null);
      reload();
    }
  }

  const expired = quote ? isQuoteExpired(quote, now) : false;
  const problem = quote && funds ? fundsProblem(quote, funds) : null;
  const decimalsOut = SWAP_TOKENS[tokenOut].decimals;

  return (
    <Panel
      title="New swap"
      subtitle="USDC ⇄ EURC on Arc mainnet, routed by Circle. Your wallet signs every step, and the minimum you confirm is enforced on-chain."
    >
      <div className="grid gap-4">
        <Field label="You pay">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={busy !== null}
              onChange={(event) => {
                setAmount(event.target.value);
                reset();
              }}
            />
            <SecondaryButton
              disabled={busy !== null}
              onClick={() => {
                setTokenIn(tokenOut);
                reset();
              }}
            >
              {tokenIn} → {tokenOut} ⇅
            </SecondaryButton>
          </div>
        </Field>

        <Field label="Maximum slippage">
          <Choice<string>
            columns={3}
            value={String(slippageBps)}
            disabled={busy !== null}
            onChange={(value) => {
              setSlippageBps(Number(value));
              reset();
            }}
            options={SLIPPAGE_OPTIONS_BPS.map((bps) => ({ value: String(bps), label: `${bps / 100}%` }))}
          />
        </Field>

        {!quote ? (
          <PrimaryButton onClick={handleQuote} disabled={busy !== null || !amount.trim() || Boolean(walletWarning)}>
            {busy === "quote" ? "Getting a quote from Circle…" : "Get quote"}
          </PrimaryButton>
        ) : (
          <div className="rounded-2xl border border-[#79b7ff]/14 bg-[#070c1d] p-4">
            <p className="text-sm font-semibold text-white">Review before signing</p>
            <div className="mt-2 divide-y divide-white/5">
              <SummaryRow label="Network" value="Arc mainnet (chain 5042)" />
              <SummaryRow label="You pay" value={`${formatTokenUnits(quote.amountIn, SWAP_TOKENS[quote.tokenIn].decimals)} ${quote.tokenIn}`} strong />
              <SummaryRow label="Estimated to receive" value={`${formatTokenUnits(quote.estimatedOut, decimalsOut)} ${quote.tokenOut}`} strong />
              <SummaryRow label="Minimum received" value={`${formatTokenUnits(quote.minimumOut, decimalsOut)} ${quote.tokenOut}`} />
              <SummaryRow label="Slippage" value={`${quote.slippageBps / 100}%`} />
              {quote.fees.map((fee, index) => (
                <SummaryRow
                  key={`${fee.type}-${index}`}
                  label={`${fee.type === "gas" ? "Network" : fee.type === "provider" ? "Provider" : fee.type} fee (est.)`}
                  value={fee.amount === null ? "—" : `${fee.amount} ${fee.token}`}
                />
              ))}
              {funds ? <SummaryRow label="Network fee budget (est.)" value={`≈ ${formatTokenUnits(funds.gasUsdc, 6)} USDC`} /> : null}
              <SummaryRow
                label="Authorization"
                value={
                  quote.tokenIn === "USDC"
                    ? `Permit signature for exactly ${formatTokenUnits(quote.amountIn, 6)} USDC to Circle's App Kit adapter ${shortHash(CIRCLE_SWAP_ADAPTER)}`
                    : `Approval of exactly ${formatTokenUnits(quote.amountIn, 6)} EURC to Circle's App Kit adapter ${shortHash(CIRCLE_SWAP_ADAPTER)} (if not already approved)`
                }
              />
            </div>
            {problem ? <Notice tone="warn">{problem}</Notice> : null}
            <p className="mt-3 text-xs text-white/40">
              {expired ? "This quote expired. Get a new one." : `Quote valid for ${quoteSecondsLeft(quote, now)}s.`} Circle
              re-checks the price at signing; if it falls below the minimum, nothing is swapped.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <SecondaryButton onClick={reset} disabled={busy !== null}>
                Edit
              </SecondaryButton>
              {expired ? (
                <PrimaryButton onClick={handleQuote} disabled={busy !== null}>
                  Refresh quote
                </PrimaryButton>
              ) : (
                <PrimaryButton onClick={handleSwap} disabled={busy !== null || Boolean(problem) || Boolean(walletWarning)}>
                  {busy === "swap" ? "Confirm in your wallet…" : `Swap ${quote.tokenIn} for ${quote.tokenOut}`}
                </PrimaryButton>
              )}
            </div>
          </div>
        )}

        {walletWarning ? <Notice tone="warn">{walletWarning}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {result ? (
          <Notice tone={result.tone}>
            {result.text}{" "}
            {result.txHash ? <TxLink href={explorerTxUrl(result.txHash)} label={shortHash(result.txHash)} /> : null}
          </Notice>
        ) : null}
      </div>

      {history.length > 0 ? (
        <div className="mt-8">
          <p className="text-sm font-semibold text-white/80">Recent swaps</p>
          <ul className="mt-3 grid gap-2">
            {history.slice(0, 5).map((swap) => (
              <li key={swap.txHash} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#79b7ff]/12 bg-[#070c1d] px-4 py-3 text-sm">
                <span className="text-white/80">
                  {formatTokenUnits(BigInt(swap.amountIn), 6)} {swap.tokenIn} → {swap.tokenOut}
                  {swap.received ? ` · received ${formatTokenUnits(BigInt(swap.received), 6)} ${swap.tokenOut}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={
                      swap.status === "success" ? "text-emerald-200" : swap.status === "failed" ? "text-red-200" : "text-amber-200"
                    }
                  >
                    {swap.status === "success" ? "Confirmed" : swap.status === "failed" ? "Failed" : "Not confirmed yet"}
                  </span>
                  {swap.status === "submitted" ? (
                    <SecondaryButton onClick={() => handleRecheck(swap)} disabled={rechecking !== null}>
                      {rechecking === swap.txHash ? "Checking…" : "Check again"}
                    </SecondaryButton>
                  ) : null}
                  <TxLink href={explorerTxUrl(swap.txHash)} label={shortHash(swap.txHash)} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
