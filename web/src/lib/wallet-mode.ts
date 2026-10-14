/** Explicit deployment choice; Circle remains available on existing deployments. */
export const BROWSER_WALLET_ONLY =
  process.env.NEXT_PUBLIC_SHOWUP_WALLET_MODE === "browser";
