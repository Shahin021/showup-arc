"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";

import { ARC_CHAIN_ID, ARC_NETWORK_LABEL, ARC_USDC_ADDRESS, FEATURES, explorerAddressUrl } from "@/lib/showup-network";
import { WALLET_TOOL_ROUTES, openWalletChooser } from "@/lib/site-nav";

import { Notice, Panel, PrimaryButton, SecondaryButton } from "./wallet-tools-ui";

type Balances = { USDC: string; EURC: string; gasReserve: string };

/**
 * Add Funds: where to receive USDC on Arc mainnet (address, network, copy,
 * QR), current balances, and the route to bridge USDC in. No card on-ramp
 * is shown because none is integrated.
 */
export default function AddFundsPanel({ owner }: { owner: Address | null }) {
  if (!owner) {
    return (
      <Panel
        title="Add USDC on Arc"
        subtitle="ShowUp payments and network fees are paid in USDC on Arc mainnet. Connect a wallet to see the address that receives it."
      >
        <ol className="grid gap-3 text-sm leading-6 text-white/65">
          <li>1. Connect the browser wallet you use for ShowUp.</li>
          <li>2. Send USDC to that address on Arc mainnet, or bridge USDC from Ethereum or Base.</li>
          <li>3. Keep a little extra USDC: it also pays Arc network fees.</li>
        </ol>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <PrimaryButton onClick={openWalletChooser}>Connect wallet</PrimaryButton>
          {FEATURES.mainnetBridge ? (
            <Link
              href={WALLET_TOOL_ROUTES.bridge}
              className="rounded-2xl border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-5 py-3 text-center text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15"
            >
              Bridge USDC to Arc
            </Link>
          ) : null}
        </div>
      </Panel>
    );
  }
  return <ConnectedAddFunds owner={owner} />;
}

function ConnectedAddFunds({ owner }: { owner: Address }) {
  const [qr, setQr] = useState<{ address: string; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ address: string; balances?: Balances; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Plain address: understood by every wallet scanner. Network and token are stated next to it.
    QRCode.toDataURL(owner, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (!cancelled) setQr({ address: owner, dataUrl });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/wallet-tools/balances?address=${owner}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to load balances.");
        if (!cancelled) setResult({ address: owner, balances: { ...data.balances.arc, gasReserve: data.gasReserve } });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setResult({ address: owner, error: cause instanceof Error ? cause.message : "Unable to load balances." });
      });
    return () => {
      cancelled = true;
    };
  }, [owner]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(owner);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const current = result?.address === owner ? result : null;
  const balances = current?.balances;
  const usdc = balances ? parseUnits(balances.USDC, 6) : null;
  const reserve = balances ? parseUnits(balances.gasReserve, 6) : null;
  const available = usdc !== null && reserve !== null ? (usdc > reserve ? usdc - reserve : BigInt(0)) : null;

  return (
    <Panel
      title="Add USDC on Arc"
      subtitle="ShowUp payments and network fees are paid in USDC on Arc mainnet. Receive it at your address below, or bridge it in."
    >
      <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="mx-auto flex h-[176px] w-[176px] items-center justify-center rounded-2xl bg-white p-2">
          {qr?.address === owner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.dataUrl} alt={`QR code of your address ${owner}`} width={160} height={160} />
          ) : (
            <span className="text-xs text-[#050817]/50">QR…</span>
          )}
        </div>

        <div className="min-w-0">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/45">Network</dt>
              <dd className="mt-1 text-white">
                {ARC_NETWORK_LABEL} mainnet <span className="text-white/45">(chain ID {ARC_CHAIN_ID})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/45">Token</dt>
              <dd className="mt-1 text-white">
                USDC <span className="break-all font-mono text-xs text-white/45">{ARC_USDC_ADDRESS}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-white/45">Your receiving address</dt>
              <dd className="mt-1 break-all font-mono text-sm text-white">{owner}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <SecondaryButton onClick={copyAddress}>{copied ? "Copied" : "Copy address"}</SecondaryButton>
            <a
              href={explorerAddressUrl(owner)}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-white/70 transition hover:border-[#73d8ff]/40"
            >
              View on explorer
            </a>
          </div>
        </div>
      </div>

      <Notice tone="warn">
        Send only <strong>USDC on {ARC_NETWORK_LABEL} mainnet</strong> to this address. USDC sent on another network
        (Ethereum, Base, …) does not arrive on Arc; use the bridge instead. If you withdraw from an exchange, choose
        the Arc network only if the exchange offers it.
      </Notice>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Balance label="USDC" value={balances?.USDC} loading={!current} />
        <Balance label="Available for payments" value={available === null ? undefined : formatUnits(available, 6)} loading={!current} />
        <Balance label="EURC" value={balances?.EURC} loading={!current} />
      </div>
      {balances ? (
        <p className="mt-3 text-sm leading-6 text-white/45">
          About {balances.gasReserve} USDC (estimated from current network fees) is kept aside for network fees.
        </p>
      ) : null}
      {current?.error ? <Notice tone="error">{current.error}</Notice> : null}

      {FEATURES.mainnetBridge ? (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[#79b7ff]/14 bg-[#070c1d] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-white/65">Have USDC on Ethereum or Base? Bridge it to this address on Arc.</p>
          <Link
            href={WALLET_TOOL_ROUTES.bridge}
            className="shrink-0 rounded-2xl bg-gradient-to-r from-[#3d8bff] to-[#5fd0ff] px-5 py-3 text-center text-sm font-semibold text-[#03101f] transition hover:brightness-110"
          >
            Bridge USDC to Arc
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

function Balance({ label, value, loading }: { label: string; value: string | undefined; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-[#79b7ff]/12 bg-[#070c1d] p-4">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{loading && value === undefined ? "…" : value ?? "—"}</p>
    </div>
  );
}
