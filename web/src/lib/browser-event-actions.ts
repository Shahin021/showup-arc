"use client";

import { erc20Abi, type Abi, type Hex } from "viem";
import { runBrowserAction } from "@/lib/browser-action-runner";
import { arcPublicClient } from "@/lib/arc-public-client";
import { connectBrowserWallet, findBrowserWalletProvider, getArcFeeOverrides } from "@/lib/browser-wallet";
import { estimateGasReserveUsdc } from "@/lib/gas-reserve";
import { markPendingBrowserTransaction } from "@/lib/pending-transactions";
import { SHOWUP_ABI } from "@/lib/showup-abi";
import { ARC_USDC_ADDRESS, SHOWUP_CONTRACT_ADDRESS } from "@/lib/showup-network";
import type { ShowUpWallet } from "@/lib/showup-wallet";

export type BrowserAction = "reserveSeat" | "reserveSeatAndPayFull" |
  "reserveSeatWithInvitation" | "reserveSeatAndPayFullWithInvitation" |
  "payRemainingBalance" | "cancelReservation" | "claimFallbackRefund" |
  "claimCancelledEventRefund" | "cancelEvent" | "confirmAttendance" |
  "settleNoShow" | "markPaymentDefault" | "revokeInvitation";

/** Every step reconnects and checks the expected account, including after approval. */
export async function executeBrowserEventAction(
  wallet: Extract<ShowUpWallet, { kind: "browser" }>,
  functionName: BrowserAction,
  args: readonly unknown[],
  amount: bigint,
  label: string,
  onHash: (hash: Hex) => void,
) {
  async function connect() {
    const provider = await findBrowserWalletProvider(wallet.providerRdns);
    const connection = await connectBrowserWallet(provider.provider);
    if (connection.address.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("The wallet account changed. Reconnect the expected account.");
    }
    return connection;
  }
  await connect();
  return runBrowserAction({
    connect: async () => (await connect()).address,
    funds: async () => {
      const [balance, allowance, reserve] = await Promise.all([
        arcPublicClient.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] }),
        arcPublicClient.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "allowance", args: [wallet.address, SHOWUP_CONTRACT_ADDRESS] }),
        estimateGasReserveUsdc(),
      ]);
      return { balance, allowance, reserve };
    },
    submit: async (account, approval) => {
      // Reconnect immediately before signing; simulation and submission share account and chain.
      const connection = await connect();
      if (connection.address.toLowerCase() !== account.toLowerCase()) throw new Error("The wallet account changed.");
      const fees = await getArcFeeOverrides(() => arcPublicClient.estimateFeesPerGas());
      const { request } = await arcPublicClient.simulateContract({
        account, address: approval ? ARC_USDC_ADDRESS : SHOWUP_CONTRACT_ADDRESS,
        abi: (approval ? erc20Abi : SHOWUP_ABI) as Abi,
        functionName: approval ? "approve" : functionName,
        args: approval ? [SHOWUP_CONTRACT_ADDRESS, amount] : args,
        ...fees,
      });
      return connection.walletClient.writeContract(request);
    },
    receipt: (hash) => arcPublicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }),
    track: (hash, approval) => {
      markPendingBrowserTransaction(wallet.address, approval ? "USDC approval" : label, hash);
      onHash(hash);
    },
  }, wallet.address, amount);
}
