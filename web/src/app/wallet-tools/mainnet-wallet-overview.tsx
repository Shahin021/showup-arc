"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";

import {
  ARC_NETWORK_LABEL,
  explorerAddressUrl,
} from "@/lib/showup-network";
import {
  readActiveWallet,
  SHOWUP_WALLET_CHANGED_EVENT,
  type ShowUpWallet,
} from "@/lib/showup-wallet";

const fiatOnrampEnabled = process.env.NEXT_PUBLIC_ENABLE_FIAT_ONRAMP === "true";
const fiatOnrampUrl = process.env.NEXT_PUBLIC_FIAT_ONRAMP_URL ?? "";

type Balances = { USDC: string; EURC: string; gasReserve: string };

/**
 * Mainnet wallet page: real balances, the gas reserve, and how to add funds.
 * The testnet bridge and swap are not offered with real funds.
 */
export default function MainnetWalletOverview() {
  const [wallet, setWallet] = useState<ShowUpWallet | null>(null);
  // Results are keyed by address so a wallet switch never shows stale data.
  const [result, setResult] = useState<{
    address: string;
    balances?: Balances;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const sync = () => setWallet(readActiveWallet());
    const initial = window.setTimeout(sync, 0);
    window.addEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    if (!wallet) {
      return;
    }

    let cancelled = false;
    const address = wallet.address;

    fetch(`/api/wallet-tools/balances?address=${address}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Unable to load balances.");
        }
        if (!cancelled) {
          setResult({
            address,
            balances: { ...data.balances.arc, gasReserve: data.gasReserve } as Balances,
          });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setResult({
            address,
            error:
              loadError instanceof Error
                ? loadError.message
                : "Unable to load balances.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const current =
    wallet && result?.address === wallet.address ? result : null;
  const balances = current?.balances ?? null;
  const error = current?.error ?? "";
  const loading = Boolean(wallet) && current === null;

  const usdcUnits = balances ? parseUnits(balances.USDC, 6) : null;
  const reserveUnits = balances ? parseUnits(balances.gasReserve, 6) : null;
  const spendable =
    usdcUnits === null || reserveUnits === null
      ? null
      : usdcUnits > reserveUnits
        ? usdcUnits - reserveUnits
        : BigInt(0);
  const lowBalance =
    usdcUnits !== null && reserveUnits !== null && usdcUnits <= reserveUnits;

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-[28%] top-[-280px] h-[700px] w-[700px] rounded-full bg-[#288cff]/15 blur-[180px]" />

      <div className="relative mx-auto max-w-3xl px-6 py-14 lg:px-10 lg:py-20">
        <div className="text-center">
          <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-[#72cfff]/25 bg-[#418cff]/10 px-4 py-2 text-sm text-[#9bddff]">
            <span className="h-2 w-2 rounded-full bg-[#75d7ff] shadow-[0_0_16px_rgba(117,215,255,0.95)]" />
            {ARC_NETWORK_LABEL} mainnet wallet
          </div>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            Your wallet
          </h1>
          <p className="mt-4 text-base leading-7 text-white/50">
            ShowUp uses real USDC on {ARC_NETWORK_LABEL}. USDC also pays for
            network fees, so keep a small amount aside.
          </p>
        </div>

        <div className="mt-10 rounded-[28px] border border-[#79b7ff]/18 bg-[#0b1025]/85 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {!wallet ? (
            <p className="text-center text-white/60">
              Connect a wallet from the top-right button to see your balances.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-sm text-white/70">
                  {wallet.address}
                </p>
                <a
                  href={explorerAddressUrl(wallet.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-[#9bddff] hover:underline"
                >
                  View on explorer
                </a>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Stat label="USDC" value={balances?.USDC} loading={loading} />
                <Stat
                  label="Available for reservations"
                  value={spendable === null ? undefined : formatUnits(spendable, 6)}
                  loading={loading}
                />
                <Stat label="EURC" value={balances?.EURC} loading={loading} />
              </div>

              <p className="mt-4 text-sm leading-6 text-white/45">
                About {balances?.gasReserve ?? "…"} USDC (estimated from current
                network fees) is kept aside so you can pay for the
                reservation and for a later refund or cancellation.
              </p>

              {lowBalance ? (
                <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Your USDC balance is too low to pay for a reservation and
                  network fees. Add funds first.
                </p>
              ) : null}

              {error ? (
                <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-6 rounded-[24px] border border-[#79b7ff]/18 bg-[#0b1025]/70 p-6 backdrop-blur-xl">
          <p className="font-semibold text-white/85">Add funds</p>
          <p className="mt-2 text-sm leading-6 text-white/50">
            Send USDC on {ARC_NETWORK_LABEL} to the address above, or move USDC
            from another chain with Circle&apos;s cross-chain transfer (CCTP).
            Always double-check the network before sending.
          </p>
          {fiatOnrampEnabled && fiatOnrampUrl ? (
            <a
              href={fiatOnrampUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-2xl border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-3 text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15"
            >
              Buy USDC with a card
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#79b7ff]/12 bg-[#070c1d] p-4">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">
        {loading && value === undefined ? "…" : value ?? "—"}
      </p>
    </div>
  );
}
