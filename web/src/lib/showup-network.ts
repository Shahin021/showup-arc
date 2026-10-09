import {
  defineChain,
  getAddress,
  isAddress,
  type Chain,
} from "viem";

/**
 * Single source of truth for everything that differs between Arc Testnet
 * and Arc Mainnet. Safe to import from both server and client code.
 *
 * Values come from the Arc docs:
 * - https://docs.arc.io/arc/references/connect-to-arc
 * - https://docs.arc.io/arc/references/contract-addresses
 *
 * The app refuses to start with an incomplete or inconsistent configuration
 * instead of silently falling back to testnet values.
 */

export type ShowUpNetworkId = "testnet" | "mainnet";

/** Circle Wallets blockchain codes for Arc. */
export type CircleArcBlockchain = "ARC" | "ARC-TESTNET";

type NetworkDefinition = {
  id: ShowUpNetworkId;
  label: string;
  chain: Chain;
  rpcUrls: readonly string[];
  explorerUrl: string;
  usdcAddress: `0x${string}`;
  eurcAddress: `0x${string}`;
  circleBlockchain: CircleArcBlockchain;
  isMainnet: boolean;
};

// USDC's ERC-20 interface (6 decimals) has the same address on both networks.
// The native gas balance is the same USDC with 18 decimals; never add the two.
const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

const TESTNET_RPC_URLS = [
  "https://rpc.testnet.arc.io",
  "https://rpc.blockdaemon.testnet.arc.io",
  "https://rpc.drpc.testnet.arc.io",
  "https://rpc.quicknode.testnet.arc.io",
] as const;

const MAINNET_RPC_URLS = [
  "https://rpc.mainnet.arc.io",
  "https://rpc.blockdaemon.mainnet.arc.io",
  "https://rpc.drpc.mainnet.arc.io",
  "https://rpc.quicknode.mainnet.arc.io",
] as const;

const NETWORKS: Record<ShowUpNetworkId, NetworkDefinition> = {
  testnet: {
    id: "testnet",
    label: "Arc Testnet",
    rpcUrls: TESTNET_RPC_URLS,
    explorerUrl: "https://explorer.testnet.arc.io",
    usdcAddress: ARC_USDC,
    eurcAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    circleBlockchain: "ARC-TESTNET",
    isMainnet: false,
    chain: defineChain({
      id: 5042002,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [...TESTNET_RPC_URLS] } },
      blockExplorers: {
        default: {
          name: "Arc Testnet Explorer",
          url: "https://explorer.testnet.arc.io",
        },
      },
      contracts: {
        multicall3: {
          address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        },
      },
      testnet: true,
    }),
  },
  mainnet: {
    id: "mainnet",
    label: "Arc",
    rpcUrls: MAINNET_RPC_URLS,
    explorerUrl: "https://explorer.arc.io",
    usdcAddress: ARC_USDC,
    eurcAddress: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    circleBlockchain: "ARC",
    isMainnet: true,
    chain: defineChain({
      id: 5042,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [...MAINNET_RPC_URLS] } },
      blockExplorers: {
        default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
      },
      contracts: {
        multicall3: {
          address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        },
      },
    }),
  },
};

export class ShowUpConfigError extends Error {
  constructor(message: string) {
    super(`ShowUp configuration error: ${message}`);
    this.name = "ShowUpConfigError";
  }
}

// NEXT_PUBLIC_* values must be read with literal property access so Next.js
// can inline them into the client bundle.
const rawNetwork = process.env.NEXT_PUBLIC_SHOWUP_NETWORK?.trim();
const rawContractAddress =
  process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS?.trim();
const rawChainId = process.env.NEXT_PUBLIC_SHOWUP_CHAIN_ID?.trim();

function resolveNetwork(): NetworkDefinition {
  if (rawNetwork !== "testnet" && rawNetwork !== "mainnet") {
    throw new ShowUpConfigError(
      'NEXT_PUBLIC_SHOWUP_NETWORK must be set to "testnet" or "mainnet".',
    );
  }

  const network = NETWORKS[rawNetwork];

  // Optional belt-and-braces check: if a chain ID is configured it must
  // match the selected network, which catches copy-pasted env files.
  if (rawChainId && Number(rawChainId) !== network.chain.id) {
    throw new ShowUpConfigError(
      `NEXT_PUBLIC_SHOWUP_CHAIN_ID (${rawChainId}) does not match the ${network.label} chain ID (${network.chain.id}).`,
    );
  }

  return network;
}

function resolveContractAddress(): `0x${string}` {
  if (!rawContractAddress || !isAddress(rawContractAddress)) {
    throw new ShowUpConfigError(
      "NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS must be the deployed ShowUpV6 address for the selected network.",
    );
  }

  return getAddress(rawContractAddress);
}

const network = resolveNetwork();

export const SHOWUP_NETWORK: ShowUpNetworkId = network.id;
export const IS_MAINNET = network.isMainnet;
export const ARC_NETWORK_LABEL = network.label;
export const ARC_CHAIN = network.chain;
export const ARC_CHAIN_ID = network.chain.id;
export const ARC_RPC_URLS = network.rpcUrls;
export const ARC_EXPLORER_URL = network.explorerUrl;
export const ARC_USDC_ADDRESS = network.usdcAddress;
export const ARC_EURC_ADDRESS = network.eurcAddress;
export const CIRCLE_ARC_BLOCKCHAIN = network.circleBlockchain;
export const SHOWUP_CONTRACT_ADDRESS = resolveContractAddress();

/** EIP-712 domain used by ShowUpV6 for invitations and check-in codes. */
export const SHOWUP_EIP712_DOMAIN = {
  name: "ShowUp",
  version: "6",
  chainId: ARC_CHAIN_ID,
  verifyingContract: SHOWUP_CONTRACT_ADDRESS,
} as const;

/**
 * Minimum maxFeePerGas accepted by the Arc mempool. Transactions below it
 * are dropped silently, so browser-wallet transactions set it explicitly.
 */
export const ARC_MIN_MAX_FEE_PER_GAS = BigInt(20_000_000_000); // 20 gwei


/** Arc on the configured network, or Ethereum Sepolia for the testnet bridge. */
export type CircleWalletBlockchain = CircleArcBlockchain | "ETH-SEPOLIA";

/**
 * Blockchains the app creates Circle wallets on. Testnet keeps a Sepolia
 * wallet for the bridge; mainnet only needs Arc.
 */
export const CIRCLE_WALLET_BLOCKCHAINS: readonly CircleWalletBlockchain[] =
  network.isMainnet ? ["ARC"] : ["ARC-TESTNET", "ETH-SEPOLIA"];

export function isSupportedCircleBlockchain(
  value: unknown,
): value is CircleWalletBlockchain {
  return (
    typeof value === "string" &&
    (CIRCLE_WALLET_BLOCKCHAINS as readonly string[]).includes(value)
  );
}

/** Features that only make sense on one of the networks. */
export const FEATURES = {
  /** Circle's testnet faucet. */
  faucet: !network.isMainnet,
  /** Sepolia <-> Arc Testnet bridge and USDC/EURC swap in Wallet tools. */
  testnetBridgeAndSwap: !network.isMainnet,
  /** Card on-ramp; only meaningful with real funds. */
  fiatOnramp: network.isMainnet,
} as const;

export function explorerTxUrl(hash: string) {
  return `${ARC_EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string) {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}

/**
 * Browser storage keys are scoped to the network (wallets, sessions) and,
 * where data refers to on-chain records, to the contract as well, so testnet
 * data can never leak into a mainnet session or vice versa.
 */
export function networkStorageKey(name: string) {
  return `showup:${SHOWUP_NETWORK}:${name}`;
}

export function contractStorageKey(name: string) {
  return `showup:${SHOWUP_NETWORK}:${SHOWUP_CONTRACT_ADDRESS.toLowerCase()}:${name}`;
}
