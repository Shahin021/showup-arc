"use client";

import Link from "next/link";
import CircleWalletButton from "@/components/circle-wallet-button";
import PendingTransactionNotice from "@/components/pending-transaction-notice";
import {
  ARC_NETWORK_LABEL,
  FEATURES,
  IS_MAINNET,
} from "@/lib/showup-network";

const fiatOnrampEnabled = process.env.NEXT_PUBLIC_ENABLE_FIAT_ONRAMP === "true";
const fiatOnrampUrl = process.env.NEXT_PUBLIC_FIAT_ONRAMP_URL ?? "";
const fiatOnrampReady =
  FEATURES.fiatOnramp && fiatOnrampEnabled && Boolean(fiatOnrampUrl);

export default function ShowUpHeader() {
  return (
    <header className="sticky top-0 z-[100] overflow-visible border-b border-[#73baff]/15 bg-[#050817]/85 backdrop-blur-xl">
      {IS_MAINNET ? (
        <div className="border-b border-amber-300/20 bg-amber-300/10 px-6 py-2 text-center text-xs font-medium text-amber-100">
          Arc mainnet: transactions move real USDC and cannot be undone. Only reserve what you are willing to lock.
        </div>
      ) : (
        <div className="border-b border-[#73d8ff]/15 bg-[#73d8ff]/5 px-6 py-2 text-center text-xs font-medium text-[#9bddff]">
          {ARC_NETWORK_LABEL}: test USDC only, no real value.
        </div>
      )}
      <PendingTransactionNotice />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#73d8ff] to-[#9285ff] text-lg font-black text-[#050817] shadow-lg shadow-[#4b9cff]/20">S</div>
          <div>
            <p className="text-lg font-semibold tracking-tight">ShowUp</p>
            <p className="text-xs text-white/45">Programmable commitment on Arc</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-white/60 md:flex">
          <Link href="/#how-it-works" className="transition hover:text-[#8fd8ff]">How it works</Link>
          <Link href="/events" className="transition hover:text-[#8fd8ff]">Explore</Link>
          <Link href="/wallet-tools" className="transition hover:text-[#8fd8ff]">{FEATURES.testnetBridgeAndSwap ? "Bridge & Swap" : "Wallet"}</Link>
          <Link href="/#infrastructure" className="transition hover:text-[#8fd8ff]">Infrastructure</Link>
        </nav>

        <div className="flex items-center gap-3">
          {fiatOnrampReady ? (
            <a href={fiatOnrampUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-2 rounded-full border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-2 text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15 lg:inline-flex">Add Funds</a>
          ) : FEATURES.faucet ? (
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="hidden items-center gap-2 rounded-full border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-2 text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15 lg:inline-flex">Get test USDC</a>
          ) : (
            <Link href="/wallet-tools" className="hidden items-center gap-2 rounded-full border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-2 text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15 lg:inline-flex">Add Funds</Link>
          )}
          <CircleWalletButton />
        </div>
      </div>
    </header>
  );
}
