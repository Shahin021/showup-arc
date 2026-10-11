"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from "viem";
import { base, mainnet } from "viem/chains";

import { findBrowserWalletProvider, getArcFeeOverrides } from "@/lib/browser-wallet";
import { ARC_CHAIN, ARC_RPC_URLS, IS_MAINNET } from "@/lib/showup-network";

import { ERC20_ABI, MESSAGE_TRANSMITTER_V2_ABI, TOKEN_MESSENGER_V2_ABI } from "./cctp-abi";
import { BRIDGE_CHAINS, CCTP_V2_MESSAGE_TRANSMITTER, CCTP_V2_TOKEN_MESSENGER, isBurnFeeTiers, type BridgeChainKey } from "./cctp-routes";
import type { BridgeRuntime, TxReceipt } from "./bridge-engine";

const RECEIPT_TIMEOUT_MS = 180_000;

function rpcOverrides(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^https:\/\//.test(url));
}

// Public RPCs are rate limited; a dedicated endpoint can be configured.
const ETHEREUM_RPC_OVERRIDES = rpcOverrides(process.env.NEXT_PUBLIC_SHOWUP_ETHEREUM_RPC_URLS);
const BASE_RPC_OVERRIDES = rpcOverrides(process.env.NEXT_PUBLIC_SHOWUP_BASE_RPC_URLS);

function viemChain(key: BridgeChainKey): Chain {
  if (key === "arc") {
    if (!IS_MAINNET || ARC_CHAIN.id !== BRIDGE_CHAINS.arc.chainId) {
      throw new Error("The mainnet bridge requires NEXT_PUBLIC_SHOWUP_NETWORK=mainnet.");
    }
    return ARC_CHAIN;
  }
  return key === "ethereum" ? mainnet : base;
}

function rpcUrls(key: BridgeChainKey): string[] {
  if (key === "arc") return [...ARC_RPC_URLS];
  const overrides = key === "ethereum" ? ETHEREUM_RPC_OVERRIDES : BASE_RPC_OVERRIDES;
  return [...overrides, ...BRIDGE_CHAINS[key].defaultRpcUrls];
}

const publicClients = new Map<BridgeChainKey, PublicClient>();

export function bridgePublicClient(key: BridgeChainKey): PublicClient {
  let client = publicClients.get(key);
  if (!client) {
    client = createPublicClient({
      chain: viemChain(key),
      transport: fallback(
        rpcUrls(key).map((url) => http(url, { timeout: 20_000, retryCount: 0 })),
        { retryCount: 2, retryDelay: 400 },
      ),
    }) as PublicClient;
    publicClients.set(key, client);
  }
  return client;
}

function providerErrorCode(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "number" ? code : undefined;
}

/** Switches the browser wallet to `key`, adding the network if the wallet does not know it. */
export async function switchWalletChain(provider: EIP1193Provider, key: BridgeChainKey) {
  const chain = viemChain(key);
  const chainIdHex = `0x${chain.id.toString(16)}` as const;
  const current = await provider.request({ method: "eth_chainId", params: undefined });
  if (typeof current === "string" && current.toLowerCase() === chainIdHex) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (error) {
    if (providerErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: rpcUrls(key),
          blockExplorerUrls: [BRIDGE_CHAINS[key].explorerUrl],
        },
      ],
    });
  }
  const after = await provider.request({ method: "eth_chainId", params: undefined });
  if (typeof after !== "string" || after.toLowerCase() !== chainIdHex) {
    throw new Error(`Switch your wallet to ${BRIDGE_CHAINS[key].label} to continue.`);
  }
}

async function feeOverrides(key: BridgeChainKey) {
  const client = bridgePublicClient(key);
  if (key === "arc") {
    return getArcFeeOverrides(() => client.estimateFeesPerGas());
  }
  const fees = await client.estimateFeesPerGas();
  return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

async function getJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

/** Wallet + RPC runtime for the CCTP engine, bound to one browser wallet extension. */
export async function createBrowserBridgeRuntime(providerRdns: string): Promise<BridgeRuntime & { provider: EIP1193Provider }> {
  const { provider } = await findBrowserWalletProvider(providerRdns);

  function walletClient(key: BridgeChainKey, account: Address) {
    return createWalletClient({ account, chain: viemChain(key), transport: custom(provider) });
  }

  type ContractCall = {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  };

  async function write(key: BridgeChainKey, account: Address, call: ContractCall): Promise<Hex> {
    const client = bridgePublicClient(key);
    // Simulate first so a revert is reported before the wallet prompt.
    await client.simulateContract({ ...call, account } as Parameters<PublicClient["simulateContract"]>[0]);
    const fees = await feeOverrides(key);
    const wallet = walletClient(key, account);
    return wallet.writeContract({
      ...call,
      ...fees,
      account,
      chain: viemChain(key),
    } as Parameters<typeof wallet.writeContract>[0]);
  }

  return {
    provider,
    storage: window.localStorage,
    now: () => Date.now(),

    async activeAccount() {
      const accounts = await provider.request({ method: "eth_accounts", params: undefined });
      const address = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error("The browser wallet is locked or disconnected. Unlock it and try again.");
      }
      return address as Address;
    },

    ensureChain: (key) => switchWalletChain(provider, key),

    usdcBalance: (key, owner) =>
      bridgePublicClient(key).readContract({
        address: BRIDGE_CHAINS[key].usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),

    nativeBalance: (key, owner) => bridgePublicClient(key).getBalance({ address: owner }),

    allowance: (key, owner) =>
      bridgePublicClient(key).readContract({
        address: BRIDGE_CHAINS[key].usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, CCTP_V2_TOKEN_MESSENGER],
      }),

    async gasPrice(key) {
      return (await feeOverrides(key)).maxFeePerGas ?? BigInt(0);
    },

    approve: (key, owner, amount) =>
      write(key, owner, {
        address: BRIDGE_CHAINS[key].usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        // Exact amount, only to the official TokenMessengerV2.
        args: [CCTP_V2_TOKEN_MESSENGER, amount],
      }),

    burn: (key, owner, args) =>
      args.hookData
        ? write(key, owner, {
            address: CCTP_V2_TOKEN_MESSENGER,
            abi: TOKEN_MESSENGER_V2_ABI,
            functionName: "depositForBurnWithHook",
            args: [
              args.amount,
              args.destinationDomain,
              args.mintRecipient,
              args.burnToken,
              `0x${"0".repeat(64)}`,
              args.maxFee,
              args.minFinalityThreshold,
              args.hookData,
            ],
          })
        : write(key, owner, {
            address: CCTP_V2_TOKEN_MESSENGER,
            abi: TOKEN_MESSENGER_V2_ABI,
            functionName: "depositForBurn",
            args: [
              args.amount,
              args.destinationDomain,
              args.mintRecipient,
              args.burnToken,
              `0x${"0".repeat(64)}`,
              args.maxFee,
              args.minFinalityThreshold,
            ],
          }),

    mint: (key, owner, message, attestation) =>
      write(key, owner, {
        address: CCTP_V2_MESSAGE_TRANSMITTER,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "receiveMessage",
        args: [message, attestation],
      }),

    async waitForReceipt(key, hash): Promise<TxReceipt | null> {
      try {
        const receipt = await bridgePublicClient(key).waitForTransactionReceipt({
          hash,
          timeout: RECEIPT_TIMEOUT_MS,
          pollingInterval: 4_000,
        });
        return {
          status: receipt.status,
          logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
        };
      } catch {
        return null;
      }
    },

    async fetchMessages(sourceDomain, burnTxHash) {
      const { response, body } = await getJson(
        `/api/bridge/cctp/messages?sourceDomain=${sourceDomain}&transactionHash=${burnTxHash}`,
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(body.error || "Unable to reach Circle's attestation service.");
      return body;
    },

    async fetchFeeTiers(sourceDomain, destinationDomain, forward) {
      const { response, body } = await getJson(
        `/api/bridge/cctp/fees?sourceDomain=${sourceDomain}&destinationDomain=${destinationDomain}&forward=${forward}`,
      );
      if (!response.ok) throw new Error(body.error || "Unable to load CCTP fees from Circle.");
      if (!isBurnFeeTiers(body.tiers)) throw new Error("Circle returned an unexpected fee response.");
      return body.tiers;
    },

    async isNonceUsed(key, nonce) {
      const used = await bridgePublicClient(key).readContract({
        address: CCTP_V2_MESSAGE_TRANSMITTER,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "usedNonces",
        args: [nonce],
      });
      return used !== BigInt(0);
    },

    blockNumber: (key) => bridgePublicClient(key).getBlockNumber(),

    async requestReattest(nonce) {
      const { response, body } = await getJson("/api/bridge/cctp/reattest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce }),
      });
      if (!response.ok) throw new Error(body.error || "Circle could not re-attest this transfer.");
    },
  };
}
