import { formatUnits } from "viem";

import { arcPublicClient } from "@/lib/arc-public-client";
import { SHOWUP_ABI } from "@/lib/showup-abi";
import { SHOWUP_CONTRACT_ADDRESS } from "@/lib/showup-network";

/** Reads ShowUpV6.maxReservationAmount (6-decimal USDC units). */
export async function readMaxReservationAmount() {
  return arcPublicClient.readContract({
    address: SHOWUP_CONTRACT_ADDRESS,
    abi: SHOWUP_ABI,
    functionName: "maxReservationAmount",
  });
}

/**
 * Rejects pricing above the contract's per-reservation cap before a
 * transaction is sent, with a clear message instead of a revert.
 * Free events lock the deposit; paid events lock up to the full price.
 */
export async function assertWithinReservationCap(
  eventType: number,
  depositUnits: bigint,
  totalPriceUnits: bigint,
) {
  const cap = await readMaxReservationAmount();
  const locked = eventType === 0 ? depositUnits : totalPriceUnits;

  if (locked > cap) {
    throw new Error(
      `${eventType === 0 ? "The deposit" : "The ticket price"} is above the ${formatUnits(
        cap,
        6,
      )} USDC limit per reservation.`,
    );
  }
}
