export const SHOWUP_WALLET_KIND_KEY =
  "showup_wallet_kind";

export const SHOWUP_WALLET_ADDRESS_KEY =
  "showup_wallet_address";

export const SHOWUP_BROWSER_WALLET_RDNS_KEY =
  "showup_browser_wallet_rdns";

export const SHOWUP_BROWSER_WALLET_NAME_KEY =
  "showup_browser_wallet_name";

export const SHOWUP_WALLET_CHANGED_EVENT =
  "showup-wallet-changed";

const LEGACY_CIRCLE_WALLET_READY_KEY =
  "showup_circle_wallet_ready";

const LEGACY_CIRCLE_WALLET_ADDRESS_KEY =
  "showup_circle_wallet_address";

export type ShowUpWalletKind =
  | "circle"
  | "browser";

export type ShowUpWallet =
  | {
      kind: "circle";
      address: `0x${string}`;
    }
  | {
      kind: "browser";
      address: `0x${string}`;
      providerRdns: string;
      providerName: string;
    };

function isWalletAddress(
  value: string | null,
): value is `0x${string}` {
  return Boolean(
    value &&
      /^0x[a-fA-F0-9]{40}$/.test(value),
  );
}

export function readActiveWallet():
  | ShowUpWallet
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedKind =
    window.localStorage.getItem(
      SHOWUP_WALLET_KIND_KEY,
    );

  const savedAddress =
    window.localStorage.getItem(
      SHOWUP_WALLET_ADDRESS_KEY,
    );

  const savedProviderRdns =
    window.localStorage.getItem(
      SHOWUP_BROWSER_WALLET_RDNS_KEY,
    );

  const savedProviderName =
    window.localStorage.getItem(
      SHOWUP_BROWSER_WALLET_NAME_KEY,
    );

  if (
    savedKind === "circle" &&
    isWalletAddress(savedAddress)
  ) {
    return {
      kind: "circle",
      address: savedAddress,
    };
  }

  if (
    savedKind === "browser" &&
    isWalletAddress(savedAddress) &&
    savedProviderRdns &&
    savedProviderName
  ) {
    return {
      kind: "browser",
      address: savedAddress,
      providerRdns: savedProviderRdns,
      providerName: savedProviderName,
    };
  }

  const circleWalletReady =
    window.localStorage.getItem(
      LEGACY_CIRCLE_WALLET_READY_KEY,
    ) === "true";

  const circleWalletAddress =
    window.localStorage.getItem(
      LEGACY_CIRCLE_WALLET_ADDRESS_KEY,
    );

  if (
    circleWalletReady &&
    isWalletAddress(circleWalletAddress)
  ) {
    return {
      kind: "circle",
      address: circleWalletAddress,
    };
  }

  return null;
}

export function saveActiveWallet(
  wallet: ShowUpWallet,
) {
  window.localStorage.setItem(
    SHOWUP_WALLET_KIND_KEY,
    wallet.kind,
  );

  window.localStorage.setItem(
    SHOWUP_WALLET_ADDRESS_KEY,
    wallet.address,
  );

  if (wallet.kind === "browser") {
    window.localStorage.setItem(
      SHOWUP_BROWSER_WALLET_RDNS_KEY,
      wallet.providerRdns,
    );

    window.localStorage.setItem(
      SHOWUP_BROWSER_WALLET_NAME_KEY,
      wallet.providerName,
    );
  } else {
    window.localStorage.removeItem(
      SHOWUP_BROWSER_WALLET_RDNS_KEY,
    );

    window.localStorage.removeItem(
      SHOWUP_BROWSER_WALLET_NAME_KEY,
    );
  }

  window.dispatchEvent(
    new Event(
      SHOWUP_WALLET_CHANGED_EVENT,
    ),
  );
}

export function clearActiveWallet() {
  window.localStorage.removeItem(
    SHOWUP_WALLET_KIND_KEY,
  );

  window.localStorage.removeItem(
    SHOWUP_WALLET_ADDRESS_KEY,
  );

  window.localStorage.removeItem(
    SHOWUP_BROWSER_WALLET_RDNS_KEY,
  );

  window.localStorage.removeItem(
    SHOWUP_BROWSER_WALLET_NAME_KEY,
  );

  window.dispatchEvent(
    new Event(
      SHOWUP_WALLET_CHANGED_EVENT,
    ),
  );
}
