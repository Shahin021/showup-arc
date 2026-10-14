import {
  createWalletClient,
  custom,
  type EIP1193Provider,
} from "viem";
import {
  ARC_CHAIN,
  ARC_EXPLORER_URL,
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_RPC_URLS,
} from "@/lib/showup-network";

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

/** Switches the browser wallet to the configured Arc network (adding it if needed). */
export async function ensureArcNetwork(
  provider: EIP1193Provider,
) {
  const requiredChainId =
    `0x${ARC_CHAIN.id.toString(16)}`;

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
          chainName: ARC_CHAIN.name,
          nativeCurrency:
            ARC_CHAIN.nativeCurrency,
          rpcUrls: [...ARC_RPC_URLS],
          blockExplorerUrls: [ARC_EXPLORER_URL],
        },
      ],
    });
  }
}

export async function connectBrowserWallet(
  provider: EIP1193Provider,
) {
  const authorizedAccounts = await provider.request({
    method: "eth_accounts",
    params: undefined,
  });

  // Reuse existing access, including the second state check before login signing.
  // Request permissions only when this site no longer has an authorized account.
  if (!Array.isArray(authorizedAccounts) || !isWalletAddress(authorizedAccounts[0])) {
    await provider.request({
      method: "eth_requestAccounts",
      params: undefined,
    });
  }

  await ensureArcNetwork(provider);

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
      chain: ARC_CHAIN,
      transport: custom(provider),
    });

  return {
    address,
    walletClient,
  };
}

export async function findBrowserWalletProvider(
  providerRdns: string,
): Promise<BrowserWalletProviderDetail> {
  const normalizedRdns =
    providerRdns.trim().toLowerCase();

  if (!normalizedRdns) {
    throw new Error(
      "The browser wallet provider is missing.",
    );
  }

  const providers =
    await discoverBrowserWallets();

  const walletProvider =
    providers.find(
      (provider) =>
        provider.info.rdns
          .trim()
          .toLowerCase() === normalizedRdns,
    );

  if (!walletProvider) {
    throw new Error(
      "The selected browser wallet extension could not be found.",
    );
  }

  return walletProvider;
}

export async function signBrowserWalletMessage({
  providerRdns,
  expectedAddress,
  message,
}: {
  providerRdns: string;
  expectedAddress: `0x${string}`;
  message: string;
}) {
  const normalizedMessage =
    message.trim();

  if (!normalizedMessage) {
    throw new Error(
      "The wallet authorization message is empty.",
    );
  }

  const walletProvider =
    await findBrowserWalletProvider(
      providerRdns,
    );

  const connection =
    await connectBrowserWallet(
      walletProvider.provider,
    );

  if (
    connection.address.toLowerCase() !==
    expectedAddress.toLowerCase()
  ) {
    throw new Error(
      "The active browser wallet account has changed. Reconnect the expected account and try again.",
    );
  }

  const signature =
    await connection.walletClient.signMessage({
      account: connection.address,
      message: normalizedMessage,
    });

  return {
    address: connection.address,
    signature,
    providerName:
      walletProvider.info.name,
    providerRdns:
      walletProvider.info.rdns,
  };
}

/**
 * Fee parameters for browser-wallet transactions on Arc. Wallet fee
 * estimates can fall below Arc's 20 gwei mempool floor, and such
 * transactions are dropped without an error, so the floor is enforced here.
 */
export async function getArcFeeOverrides(
  estimate: () => Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>,
) {
  let estimated: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};

  try {
    estimated = await estimate();
  } catch {
    // Fall back to the floor below.
  }

  const maxFeePerGas =
    estimated.maxFeePerGas !== undefined &&
    estimated.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS
      ? estimated.maxFeePerGas
      : ARC_MIN_MAX_FEE_PER_GAS;

  const maxPriorityFeePerGas =
    estimated.maxPriorityFeePerGas !== undefined &&
    estimated.maxPriorityFeePerGas <= maxFeePerGas
      ? estimated.maxPriorityFeePerGas
      : BigInt(0);

  return { maxFeePerGas, maxPriorityFeePerGas };
}
