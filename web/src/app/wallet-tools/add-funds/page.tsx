import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IS_MAINNET } from "@/lib/showup-network";

import WalletToolsShell from "../wallet-tools-shell";

export const metadata: Metadata = { title: "Add funds · ShowUp" };

export default function AddFundsPage() {
  if (!IS_MAINNET) redirect("/wallet-tools");
  return <WalletToolsShell section="addFunds" />;
}
