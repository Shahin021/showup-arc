import {
  AppKit,
  BridgeChain,
  SwapChain,
} from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import {
  createPublicClient,
  fallback,
  http,
  type Chain,
  type EIP1193Provider,
} from "viem";
import {
  arcTestnet,
  sepolia,
} from "viem/chains";

import { findBrowserWalletProvider } from "./browser-wallet";
import {
  readActiveWallet,
  type ShowUpWallet,
} from "./showup-wallet";
import {
  type CircleToolSession,
  type CircleToolWallet,
} from "./circle-wallet-tools";
import {
  createCircleSwapProvider,
} from "./circle-swap-provider";

type ShowUpBrowserWallet = Extract<
  ShowUpWallet,
  {
    kind: "browser";
  }
>;

export const SHOWUP_BRIDGE_CHAINS = {
  arcTestnet: BridgeChain.Arc_Testnet,
  ethereumSepolia: BridgeChain.Ethereum_Sepolia,
} as const;

export const SHOWUP_SWAP_CHAIN =
  SwapChain.Arc_Testnet;

const ARC_TESTNET_RPC_URLS = [
  "https://rpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
] as const;

const ETHEREUM_SEPOLIA_RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
] as const;

function createShowUpPublicClient(
  chain: Chain,
) {
  const rpcUrls =
    chain.id === arcTestnet.id
      ? ARC_TESTNET_RPC_URLS
      : chain.id === sepolia.id
        ? ETHEREUM_SEPOLIA_RPC_URLS
        : chain.rpcUrls.default.http;

  return createPublicClient({
    chain,
    transport: fallback(
      rpcUrls.map((url) =>
        http(url, {
          timeout: 20_000,
          retryCount: 0,
        }),
      ),
      {
        retryCount: 2,
        retryDelay: 300,
      },
    ),
  });
}

export type ShowUpAppKitContext = {
  wallet: ShowUpBrowserWallet;
  provider: EIP1193Provider;
  adapter: Awaited<
    ReturnType<
      typeof createViemAdapterFromProvider
    >
  >;
  kit: AppKit;
};

function isWalletAddress(
  value: unknown,
): value is `0x${string}` {
  return (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value)
  );
}

async function requestActiveAddress(
  provider: EIP1193Provider,
): Promise<`0x${string}`> {
  const accounts = await provider.request({
    method: "eth_requestAccounts",
    params: undefined,
  });

  const address =
    Array.isArray(accounts)
      ? accounts[0]
      : undefined;

  if (!isWalletAddress(address)) {
    throw new Error(
      "The browser wallet did not return a valid account.",
    );
  }

  return address;
}

export async function createShowUpAppKitContext():
  Promise<ShowUpAppKitContext> {
  const wallet = readActiveWallet();

  if (!wallet) {
    throw new Error(
      "Connect a browser wallet before using Bridge or Swap.",
    );
  }

  if (wallet.kind !== "browser") {
    throw new Error(
      "Bridge and Swap currently require a browser wallet.",
    );
  }

  const walletProvider =
    await findBrowserWalletProvider(
      wallet.providerRdns,
    );

  const activeAddress =
    await requestActiveAddress(
      walletProvider.provider,
    );

  if (
    activeAddress.toLowerCase() !==
    wallet.address.toLowerCase()
  ) {
    throw new Error(
      "The active browser wallet account has changed. Reconnect the expected account and try again.",
    );
  }

  const adapter =
    await createViemAdapterFromProvider({
      provider: walletProvider.provider,
      getPublicClient: ({ chain }) =>
        createShowUpPublicClient(chain),
      capabilities: {
        addressContext: "user-controlled",
      },
    });

  return {
    wallet,
    provider: walletProvider.provider,
    adapter,
    kit: new AppKit(),
  };
}

export async function createShowUpCircleSwapAppKitContext({
  wallet,
  session,
}: {
  wallet: CircleToolWallet;
  session: CircleToolSession;
}) {
  const provider =
    createCircleSwapProvider({
      wallet,
      session,
    });

  const adapter =
    await createViemAdapterFromProvider({
      provider,
      getPublicClient: ({ chain }) =>
        createShowUpPublicClient(chain),
      capabilities: {
        addressContext: "user-controlled",
      },
    });

  return {
    provider,
    adapter,
    kit: new AppKit(),
  };
}
