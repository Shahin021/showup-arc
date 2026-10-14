"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ShowUpHeader from "@/components/showup-header";
import SiteFooter from "@/components/site-footer";
import { FEATURES } from "@/lib/showup-network";
import { readActiveWallet, SHOWUP_WALLET_CHANGED_EVENT, type ShowUpWallet } from "@/lib/showup-wallet";
import { WALLET_TOOL_ROUTES, openWalletChooser, type WalletToolSection } from "@/lib/site-nav";

import AddFundsPanel from "./add-funds-panel";
import MainnetBridgePanel from "./mainnet-bridge-panel";
import MainnetSwapPanel from "./mainnet-swap-panel";
import { Notice, Panel, PrimaryButton } from "./wallet-tools-ui";

const SECTIONS: { key: WalletToolSection; label: string; enabled: boolean }[] = [
  { key: "addFunds", label: "Add Funds", enabled: true },
  { key: "bridge", label: "Bridge", enabled: FEATURES.mainnetBridge },
  { key: "swap", label: "Swap", enabled: FEATURES.mainnetSwap },
];

const INTRO: Record<WalletToolSection, { title: string; text: string }> = {
  addFunds: { title: "Add funds", text: "Buy USDC on Arc through Arc Portal for reservations, payments and network fees." },
  bridge: { title: "Bridge USDC", text: "Move USDC between Arc and Ethereum or Base." },
  swap: { title: "Swap on Arc", text: "Exchange USDC and EURC on Arc mainnet." },
};

/** Mainnet wallet tools. Each section is its own route, so direct links, refresh and Back/Forward keep it. */
export default function WalletToolsShell({ section }: { section: WalletToolSection }) {
  const [wallet, setWallet] = useState<ShowUpWallet | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setWallet(readActiveWallet());
      setReady(true);
    };
    const initial = window.setTimeout(sync, 0);
    window.addEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    };
  }, []);

  const browserWallet = wallet?.kind === "browser" ? wallet : null;
  const intro = INTRO[section];

  return (
    <main className="flex min-h-screen flex-col bg-[#050817] text-white">
      <ShowUpHeader />
      <section className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-[28%] top-[-280px] h-[700px] w-[700px] rounded-full bg-[#288cff]/15 blur-[180px]" />
        <div className="relative mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 lg:px-10 lg:pt-14">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{intro.title}</h1>
          <p className="mt-2 text-base leading-7 text-white/50">{intro.text}</p>

          <nav aria-label="Wallet tools" className="mt-6 flex gap-2 overflow-x-auto">
            {SECTIONS.filter((entry) => entry.enabled).map((entry) => {
              const active = entry.key === section;
              return (
                <Link
                  key={entry.key}
                  href={WALLET_TOOL_ROUTES[entry.key]}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? "border-[#73d8ff]/60 bg-[#73d8ff]/15 text-white"
                      : "border-[#79b7ff]/14 text-white/60 hover:border-[#79b7ff]/35 hover:text-white"
                  }`}
                >
                  {entry.label}
                </Link>
              );
            })}
          </nav>

          {section === "addFunds" ? (
            <AddFundsPanel key={browserWallet?.address ?? "none"} owner={browserWallet?.address ?? null} />
          ) : !ready ? null : !wallet ? (
            <ConnectFirst section={section} />
          ) : !browserWallet ? (
            <WrongWalletKind />
          ) : section === "bridge" ? (
            <MainnetBridgePanel key={`bridge-${browserWallet.address}`} owner={browserWallet.address} providerRdns={browserWallet.providerRdns} />
          ) : (
            <MainnetSwapPanel key={`swap-${browserWallet.address}`} owner={browserWallet.address} providerRdns={browserWallet.providerRdns} />
          )}
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}

function ConnectFirst({ section }: { section: WalletToolSection }) {
  return (
    <Panel
      title={section === "bridge" ? "Connect a wallet to bridge" : "Connect a wallet to swap"}
      subtitle={
        section === "bridge"
          ? "Your browser wallet signs the transfer on each network. Nothing is sent until you review and confirm."
          : "Your browser wallet signs the swap on Arc. Nothing is sent until you review and confirm a quote."
      }
    >
      <PrimaryButton onClick={openWalletChooser}>Connect wallet</PrimaryButton>
    </Panel>
  );
}

function WrongWalletKind() {
  return <Notice tone="info">These tools need a browser wallet. Connect one from the wallet button at the top.</Notice>;
}
