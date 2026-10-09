"use client";

import ShowUpHeader from "@/components/showup-header";
import { FEATURES } from "@/lib/showup-network";

import MainnetWalletOverview from "./mainnet-wallet-overview";
import TestnetWalletTools from "./testnet-wallet-tools";

export default function WalletToolsPage() {
  if (FEATURES.testnetBridgeAndSwap) {
    return <TestnetWalletTools />;
  }

  return (
    <main className="min-h-screen bg-[#050817] text-white">
      <ShowUpHeader />
      <MainnetWalletOverview />
    </main>
  );
}
