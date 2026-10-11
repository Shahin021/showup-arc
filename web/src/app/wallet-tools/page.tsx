import { redirect } from "next/navigation";

import { FEATURES } from "@/lib/showup-network";
import { WALLET_TOOL_ROUTES } from "@/lib/site-nav";

import TestnetWalletTools from "./testnet-wallet-tools";

/** Testnet keeps its combined tools page; on mainnet each tool has its own route. */
export default function WalletToolsPage() {
  if (FEATURES.testnetBridgeAndSwap) {
    return <TestnetWalletTools />;
  }
  redirect(WALLET_TOOL_ROUTES.addFunds);
}
