"use client";

import type { Hex } from "viem";

import { arcPublicClient } from "@/lib/arc-public-client";
import {
  connectBrowserWallet,
  findBrowserWalletProvider,
  getArcFeeOverrides,
} from "@/lib/browser-wallet";
import { markPendingBrowserTransaction } from "@/lib/pending-transactions";
import { SHOWUP_ABI } from "@/lib/showup-abi";
import {
  getViemCheckInTypedData,
  type CheckInPayload,
  type SignedCheckInCode,
} from "@/lib/showup-checkin";
import { SHOWUP_CONTRACT_ADDRESS } from "@/lib/showup-network";

async function connectExpected(providerRdns: string, expectedAddress: string) {
  const walletProvider = await findBrowserWalletProvider(providerRdns);
  const connection = await connectBrowserWallet(walletProvider.provider);

  if (connection.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      "The active browser wallet account has changed. Reconnect the expected account and try again.",
    );
  }

  return connection;
}

/** Organizer signs a check-in code with a browser wallet. */
export async function signCheckInWithBrowserWallet(
  providerRdns: string,
  expectedAddress: `0x${string}`,
  payload: CheckInPayload,
): Promise<Hex> {
  const connection = await connectExpected(providerRdns, expectedAddress);
  return connection.walletClient.signTypedData({
    account: connection.address,
    ...getViemCheckInTypedData(payload),
  });
}

/** Attendee submits checkIn from a browser wallet and waits for the receipt. */
export async function checkInWithBrowserWallet(
  providerRdns: string,
  expectedAddress: `0x${string}`,
  code: SignedCheckInCode,
) {
  const connection = await connectExpected(providerRdns, expectedAddress);
  const fees = await getArcFeeOverrides(() =>
    arcPublicClient.estimateFeesPerGas(),
  );

  markPendingBrowserTransaction(connection.address, "Check-in");

  const hash = await connection.walletClient.writeContract({
    account: connection.address,
    address: SHOWUP_CONTRACT_ADDRESS,
    abi: SHOWUP_ABI,
    functionName: "checkIn",
    args: [code.eventId, code.attendee, code.issuedAt, code.expiry, code.signature],
    ...fees,
  });

  markPendingBrowserTransaction(connection.address, "Check-in", hash);

  const receipt = await arcPublicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });

  if (receipt.status !== "success") {
    throw new Error("The check-in transaction reverted.");
  }

  return hash;
}
