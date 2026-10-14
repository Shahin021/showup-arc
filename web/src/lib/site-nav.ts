import { FEATURES, IS_MAINNET } from "@/lib/showup-network";

/** Direct routes for the mainnet wallet tools. Each one is its own page, so links, refresh and Back/Forward keep the section. */
export const WALLET_TOOL_ROUTES = {
  addFunds: "/wallet-tools/add-funds",
  bridge: "/wallet-tools/bridge",
  swap: "/wallet-tools/swap",
} as const;

export type WalletToolSection = keyof typeof WALLET_TOOL_ROUTES;

export type NavItem = {
  href: string;
  label: string;
  /** Path prefixes that mark the item as the current page. Hash links have none. */
  activePrefixes: readonly string[];
};

/** Main navigation, in display order. */
export function primaryNavItems(): NavItem[] {
  const items: NavItem[] = [
    { href: "/#how-it-works", label: "How it works", activePrefixes: [] },
    { href: "/events", label: "Explore", activePrefixes: ["/events"] },
  ];
  if (IS_MAINNET) {
    if (FEATURES.mainnetBridge) {
      items.push({ href: WALLET_TOOL_ROUTES.bridge, label: "Bridge", activePrefixes: [WALLET_TOOL_ROUTES.bridge] });
    }
    if (FEATURES.mainnetSwap) {
      items.push({ href: WALLET_TOOL_ROUTES.swap, label: "Swap", activePrefixes: [WALLET_TOOL_ROUTES.swap] });
    }
    items.push({ href: WALLET_TOOL_ROUTES.addFunds, label: "Add Funds", activePrefixes: [WALLET_TOOL_ROUTES.addFunds] });
  } else if (FEATURES.testnetBridgeAndSwap) {
    items.push({ href: "/wallet-tools", label: "Bridge & Swap", activePrefixes: ["/wallet-tools"] });
  }
  return items;
}

/** Funding destination; mainnet uses a navigation link, testnet uses the faucet action. */
export function fundingAction(): { href: string; label: string; external: boolean; activePrefixes: readonly string[] } {
  if (IS_MAINNET) {
    return { href: WALLET_TOOL_ROUTES.addFunds, label: "Add Funds", external: false, activePrefixes: [WALLET_TOOL_ROUTES.addFunds] };
  }
  return { href: "https://faucet.circle.com", label: "Get test USDC", external: true, activePrefixes: [] };
}

export function isActivePath(pathname: string | null, prefixes: readonly string[]) {
  if (!pathname) return false;
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Window event that opens the wallet chooser in the header (used by "Connect wallet" buttons elsewhere). */
export const OPEN_WALLET_CHOOSER_EVENT = "showup:open-wallet-chooser";

export function openWalletChooser() {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.dispatchEvent(new Event(OPEN_WALLET_CHOOSER_EVENT));
  }
}
