import {
  AppKit,
  BridgeChain,
  SwapChain,
} from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import type { EIP1193Provider } from "viem";

import { findBrowserWalletProvider } from "./browser-wallet";
import {
  readActiveWallet,
  type ShowUpWallet,
} from "./showup-wallet";

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
