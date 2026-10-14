import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FEATURES, IS_MAINNET } from "@/lib/showup-network";
import { WALLET_TOOL_ROUTES } from "@/lib/site-nav";

import WalletToolsShell from "../wallet-tools-shell";

export const metadata: Metadata = { title: "Swap · ShowUp" };

export default function SwapPage() {
  if (!IS_MAINNET) redirect("/wallet-tools");
  if (!FEATURES.mainnetSwap) redirect(WALLET_TOOL_ROUTES.addFunds);
  return <WalletToolsShell section="swap" />;
}
