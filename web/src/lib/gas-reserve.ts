import { arcPublicClient } from "@/lib/arc-public-client";
import { ARC_MIN_MAX_FEE_PER_GAS } from "@/lib/showup-network";

/**
 * USDC to keep aside for network fees when deciding whether a wallet can
 * afford a payment. On Arc the fee is paid from the same USDC balance.
 *
 * The reserve is estimated from the current fee level and a gas budget that
 * covers the transactions a reservation needs plus the one that follows it:
 * an approval (~46k gas), the payment itself (up to ~275k gas for the
 * largest reservation path), and a later check-in, cancellation or refund
 * claim (up to ~120k gas). Measured with `hardhat test --gas-stats`, then
 * doubled for headroom.
 *
 * It is an estimate, not a guarantee: fees can rise between the check and
 * the transaction. The minimum below keeps a small floor in any case.
 */
const GAS_BUDGET = BigInt(1_000_000);
const MIN_RESERVE_USDC = BigInt(20_000); // 0.02 USDC
const NATIVE_TO_USDC_UNITS = BigInt(1_000_000_000_000); // 18 -> 6 decimals

export async function estimateGasReserveUsdc() {
  let maxFeePerGas = ARC_MIN_MAX_FEE_PER_GAS;

  try {
    const fees = await arcPublicClient.estimateFeesPerGas();
    if (fees.maxFeePerGas !== undefined && fees.maxFeePerGas > maxFeePerGas) {
      maxFeePerGas = fees.maxFeePerGas;
    }
  } catch {
    // Use the mempool floor if the estimate is unavailable.
  }

  const costNative = maxFeePerGas * GAS_BUDGET;
  // Round up when converting the 18-decimal native amount to USDC units.
  const costUsdc =
    (costNative + NATIVE_TO_USDC_UNITS - BigInt(1)) / NATIVE_TO_USDC_UNITS;

  return costUsdc > MIN_RESERVE_USDC ? costUsdc : MIN_RESERVE_USDC;
}
