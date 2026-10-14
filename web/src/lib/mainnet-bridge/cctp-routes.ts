import { getAddress, isAddress, padHex, type Address, type Hex } from "viem";

/**
 * CCTP V2 mainnet configuration for the ShowUp bridge.
 *
 * This module has no environment dependencies so it can be unit tested.
 *
 * Sources (checked October 2026):
 * - Contract addresses and domains:
 *   https://developers.circle.com/cctp/references/contract-addresses
 *   https://docs.arc.io/arc/references/contract-addresses
 * - Supported routes (Arc: standard transfer only, Fast Transfer N/A):
 *   https://developers.circle.com/cctp/concepts/supported-chains-and-domains
 * - Arc mainnet added to CCTP on 2026-09-16:
 *   https://developers.circle.com/release-notes/cctp-2026
 * - USDC addresses:
 *   https://developers.circle.com/stablecoins/usdc-contract-addresses
 */

/** TokenMessengerV2 and MessageTransmitterV2 share these addresses on every EVM mainnet. */
export const CCTP_V2_TOKEN_MESSENGER: Address = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
export const CCTP_V2_MESSAGE_TRANSMITTER: Address = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

/** Mainnet attestation service (Iris). */
export const CCTP_IRIS_API_BASE_URL = "https://iris-api.circle.com";

/** Finality thresholds defined by CCTP V2. */
export const CCTP_FINALITY_FAST = 1000;
export const CCTP_FINALITY_STANDARD = 2000;

export type BridgeChainKey = "arc" | "ethereum" | "base";
export type BridgeSpeed = "standard" | "fast";

export type BridgeChainConfig = {
  key: BridgeChainKey;
  label: string;
  chainId: number;
  domain: number;
  usdc: Address;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Arc pays gas in USDC: the native balance and the ERC-20 balance are the same funds. */
  gasIsUsdc: boolean;
  /** Fast Transfer is only offered by Circle on these source chains. */
  fastTransferAsSource: boolean;
  explorerUrl: string;
  defaultRpcUrls: readonly string[];
  /** Typical wait for a standard attestation, shown to the user. */
  standardWaitLabel: string;
};

export const BRIDGE_CHAINS: Record<BridgeChainKey, BridgeChainConfig> = {
  arc: {
    key: "arc",
    label: "Arc",
    chainId: 5042,
    domain: 26,
    usdc: "0x3600000000000000000000000000000000000000",
    nativeSymbol: "USDC",
    nativeDecimals: 18,
    gasIsUsdc: true,
    fastTransferAsSource: false,
    explorerUrl: "https://explorer.arc.io",
    defaultRpcUrls: [
      "https://rpc.mainnet.arc.io",
      "https://rpc.blockdaemon.mainnet.arc.io",
      "https://rpc.drpc.mainnet.arc.io",
      "https://rpc.quicknode.mainnet.arc.io",
    ],
    standardWaitLabel: "usually under a minute",
  },
  ethereum: {
    key: "ethereum",
    label: "Ethereum",
    chainId: 1,
    domain: 0,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    gasIsUsdc: false,
    fastTransferAsSource: true,
    explorerUrl: "https://etherscan.io",
    defaultRpcUrls: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
    standardWaitLabel: "about 15–20 minutes (Ethereum finality)",
  },
  base: {
    key: "base",
    label: "Base",
    chainId: 8453,
    domain: 6,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    gasIsUsdc: false,
    fastTransferAsSource: true,
    explorerUrl: "https://basescan.org",
    defaultRpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    standardWaitLabel: "about 15–20 minutes (Ethereum finality)",
  },
};

export type BridgeRoute = { from: BridgeChainKey; to: BridgeChainKey };

/** Only routes with Arc on one side are offered. */
export const BRIDGE_ROUTES: readonly BridgeRoute[] = [
  { from: "ethereum", to: "arc" },
  { from: "base", to: "arc" },
  { from: "arc", to: "ethereum" },
  { from: "arc", to: "base" },
];

export function isBridgeChainKey(value: unknown): value is BridgeChainKey {
  return value === "arc" || value === "ethereum" || value === "base";
}

export function isSupportedRoute(from: BridgeChainKey, to: BridgeChainKey) {
  return BRIDGE_ROUTES.some((route) => route.from === from && route.to === to);
}

export function chainByDomain(domain: number): BridgeChainConfig | undefined {
  return Object.values(BRIDGE_CHAINS).find((chain) => chain.domain === domain);
}

export function chainById(chainId: number): BridgeChainConfig | undefined {
  return Object.values(BRIDGE_CHAINS).find((chain) => chain.chainId === chainId);
}

export function supportedSpeeds(from: BridgeChainKey): BridgeSpeed[] {
  return BRIDGE_CHAINS[from].fastTransferAsSource ? ["standard", "fast"] : ["standard"];
}

export function finalityThreshold(speed: BridgeSpeed) {
  return speed === "fast" ? CCTP_FINALITY_FAST : CCTP_FINALITY_STANDARD;
}

export function explorerTx(chain: BridgeChainKey, hash: string) {
  return `${BRIDGE_CHAINS[chain].explorerUrl}/tx/${hash}`;
}

export function addressToBytes32(value: string): Hex {
  if (!isAddress(value)) {
    throw new Error("The CCTP recipient address is invalid.");
  }
  return padHex(getAddress(value), { size: 32, dir: "left" });
}

export function bytes32ToAddress(value: string): Address {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Invalid bytes32 address.");
  }
  if (!/^0x0{24}/i.test(value)) {
    throw new Error("The bytes32 value is not an EVM address.");
  }
  return getAddress(`0x${value.slice(26)}`);
}

/** Parses a positive decimal USDC amount into 6-decimal base units, rejecting malformed input. */
export function parseUsdcAmount(input: string): bigint {
  const value = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter a USDC amount with at most 6 decimals.");
  }
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (units <= BigInt(0)) {
    throw new Error("Enter an amount greater than zero.");
  }
  return units;
}

export function formatUsdcUnits(units: bigint): string {
  const negative = units < BigInt(0);
  const abs = negative ? -units : units;
  const whole = abs / BigInt(1_000_000);
  const fraction = (abs % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Fee tiers returned by GET /v2/burn/USDC/fees/{source}/{destination}[?forward=true].
 * `minimumFee` is in basis points and may be fractional (e.g. "1.3").
 * With `forward=true`, `forwardFee` gives Circle's Forwarding Service fee in
 * USDC base units (low / med / high).
 */
export type ForwardFee = { low: number | string; med: number | string; high: number | string };
export type BurnFeeTier = {
  finalityThreshold: number;
  minimumFee: number | string;
  forwardFee?: ForwardFee;
};

function isNumeric(value: unknown) {
  return typeof value === "number" || typeof value === "string";
}

export function isBurnFeeTiers(value: unknown): value is BurnFeeTier[] {
  return (
    Array.isArray(value) &&
    value.every((tier) => {
      if (typeof tier !== "object" || tier === null) return false;
      const t = tier as BurnFeeTier;
      if (typeof t.finalityThreshold !== "number" || !isNumeric(t.minimumFee)) return false;
      if (t.forwardFee === undefined) return true;
      return (
        typeof t.forwardFee === "object" &&
        t.forwardFee !== null &&
        isNumeric(t.forwardFee.low) &&
        isNumeric(t.forwardFee.med) &&
        isNumeric(t.forwardFee.high)
      );
    })
  );
}

function findTier(tiers: BurnFeeTier[], threshold: number) {
  const tier = tiers.find((entry) => entry.finalityThreshold === threshold);
  if (!tier) {
    throw new Error(`Circle returned no fee tier for finality threshold ${threshold}.`);
  }
  return tier;
}

/** Basis points scaled by 100 (1.3 bps -> 130) so fractional fees stay exact. */
export function feeTierScaledBps(tiers: BurnFeeTier[], threshold: number): bigint {
  const bps = Number.parseFloat(String(findTier(tiers, threshold).minimumFee));
  if (!Number.isFinite(bps) || bps < 0) {
    throw new Error("Circle returned an invalid CCTP fee.");
  }
  return BigInt(Math.round(bps * 100));
}

function toUnits(value: number | string, label: string) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`Circle returned an invalid ${label}.`);
  }
  return BigInt(text);
}

/** Forwarding fee in USDC base units. Circle recommends `med` or higher. */
export function forwardFeeFor(tiers: BurnFeeTier[], threshold: number) {
  const forwardFee = findTier(tiers, threshold).forwardFee;
  if (!forwardFee) {
    throw new Error("Circle did not return a Forwarding Service fee for this route.");
  }
  const med = toUnits(forwardFee.med, "forwarding fee");
  const high = toUnits(forwardFee.high, "forwarding fee");
  return { med, high: high > med ? high : med };
}

export type TransferFees = {
  /** Estimated CCTP protocol fee (Fast Transfer only). */
  protocolFee: bigint;
  /** Expected Forwarding Service fee (med tier), 0 without forwarding. */
  forwardFee: bigint;
  /** Value passed as maxFee; the burn reverts if Circle's fee would exceed it. */
  maxFee: bigint;
  /** Guaranteed minimum USDC minted to the recipient. */
  minimumReceived: bigint;
  /** Expected USDC minted (amount - protocol fee - forwarding fee at med). */
  expectedReceived: bigint;
};

/**
 * Computes the fees and the maxFee to pass to depositForBurn.
 * The protocol fee gets a 20% buffer as recommended by Circle, and the
 * forwarding part of maxFee uses the `high` tier. If the actual fee exceeds
 * maxFee the burn reverts on the source chain and nothing is burned; the fee
 * charged at mint is the actual fee, never more than maxFee.
 */
export function computeTransferFees({
  amount,
  scaledBps,
  forward,
}: {
  amount: bigint;
  scaledBps: bigint;
  forward?: { med: bigint; high: bigint };
}): TransferFees {
  const denominator = BigInt(1_000_000);
  // Round up so the estimate never understates the fee.
  const protocolFee = (amount * scaledBps + denominator - BigInt(1)) / denominator;
  const protocolMax = protocolFee === BigInt(0) ? BigInt(0) : (protocolFee * BigInt(120) + BigInt(99)) / BigInt(100);
  const forwardFee = forward?.med ?? BigInt(0);
  const maxFee = protocolMax + (forward?.high ?? BigInt(0));
  if (maxFee >= amount) {
    throw new Error("The amount is too small to cover the transfer fees.");
  }
  return {
    protocolFee,
    forwardFee,
    maxFee,
    minimumReceived: amount - maxFee,
    expectedReceived: amount - protocolFee - forwardFee,
  };
}

/** Static hookData that asks Circle's Forwarding Service to submit the destination mint. */
export const CCTP_FORWARDING_HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;
