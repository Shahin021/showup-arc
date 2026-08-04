import {
  createWalletClient,
  custom,
  type EIP1193Provider,
} from "viem";
import { arcTestnet } from "viem/chains";

export type BrowserWalletProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type BrowserWalletProviderDetail = {
  info: BrowserWalletProviderInfo;
  provider: EIP1193Provider;
};

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<BrowserWalletProviderDetail>;
  }

  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function isWalletAddress(
  value: unknown,
): value is `0x${string}` {
  return (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value)
  );
}

function getProviderErrorCode(
  error: unknown,
): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return undefined;
}

export async function discoverBrowserWallets(
  waitMilliseconds = 250,
): Promise<BrowserWalletProviderDetail[]> {
  if (typeof window === "undefined") {
    return [];
  }

  const providers =
    new Map<string, BrowserWalletProviderDetail>();

  const handleProviderAnnouncement = (
    event: WindowEventMap["eip6963:announceProvider"],
  ) => {
    providers.set(
      event.detail.info.uuid,
      event.detail,
    );
  };

  window.addEventListener(
    "eip6963:announceProvider",
    handleProviderAnnouncement,
  );

  window.dispatchEvent(
    new Event("eip6963:requestProvider"),
  );

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, waitMilliseconds);
  });

  window.removeEventListener(
    "eip6963:announceProvider",
    handleProviderAnnouncement,
  );

  if (
    providers.size === 0 &&
    window.ethereum
  ) {
    providers.set("legacy-injected-wallet", {
      info: {
        uuid: "legacy-injected-wallet",
        name: "Browser wallet",
        icon: "",
        rdns: "legacy.injected",
      },
      provider: window.ethereum,
    });
  }

  return [...providers.values()];
}

export async function ensureArcTestnet(
  provider: EIP1193Provider,
) {
  const requiredChainId =
    `0x${arcTestnet.id.toString(16)}`;

  const currentChainId =
    await provider.request({
      method: "eth_chainId",
      params: undefined,
    });

  if (
    typeof currentChainId === "string" &&
    currentChainId.toLowerCase() ===
      requiredChainId.toLowerCase()
  ) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [
        {
          chainId: requiredChainId,
        },
      ],
    });
  } catch (error) {
    if (getProviderErrorCode(error) !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: requiredChainId,
          chainName: arcTestnet.name,
          nativeCurrency:
            arcTestnet.nativeCurrency,
          rpcUrls: [
            ...arcTestnet.rpcUrls.default.http,
          ],
          blockExplorerUrls:
            arcTestnet.blockExplorers
              ? [
                  arcTestnet.blockExplorers
                    .default.url,
                ]
              : [],
        },
      ],
    });
  }
}

export async function connectBrowserWallet(
  provider: EIP1193Provider,
) {
  await provider.request({
    method: "eth_requestAccounts",
    params: undefined,
  });

  await ensureArcTestnet(provider);

  const accounts =
    await provider.request({
      method: "eth_accounts",
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

  const walletClient =
    createWalletClient({
      account: address,
      chain: arcTestnet,
      transport: custom(provider),
    });

  return {
    address,
    walletClient,
  };
}
