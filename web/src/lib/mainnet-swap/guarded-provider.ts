import type { Address, EIP1193Provider, Hex } from "viem";

import {
  ARC_MAINNET_CHAIN_ID,
  applyArcFeesToTransaction,
  assertAllowedSwapRequest,
  type ArcFees,
  type SwapGuardContext,
} from "./swap-logic";

const ARC_CHAIN_ID_HEX = `0x${ARC_MAINNET_CHAIN_ID.toString(16)}`;

export type TxListener = (hash: Hex, kind: "swap" | "approve") => void;

/**
 * Wraps the browser wallet for the swap SDK. Every request goes through
 * assertAllowedSwapRequest (only what the confirmed quote needs).
 * Order for every signature or transaction:
 * 1. validate the request against the confirmed quote (context);
 * 2. transactions: fetch Arc's EIP-1559 fees (like the event payment path)
 *    and fix chainId to Arc mainnet;
 * 3. the same context object must still be active and the final request
 *    must still be allowed (early exit);
 * 4. the wallet must still be on Arc mainnet with the expected account;
 * 5. the same context and final request are checked once more, and the
 *    wallet is called immediately after, with no await in between.
 * Any cancellation or replacement of the quote during steps 2 or 4 therefore
 * stops the request before it reaches the wallet.
 *
 * Kept free of app imports so it can be unit tested with a fake wallet.
 */
export function createGuardedSwapProvider({
  provider,
  owner,
  getContext,
  onTx,
  getFees,
}: {
  provider: EIP1193Provider;
  owner: Address;
  getContext: () => SwapGuardContext | null;
  onTx: TxListener;
  getFees: () => Promise<ArcFees>;
}): EIP1193Provider {
  async function assertWalletState() {
    const [chainId, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId", params: undefined }),
      provider.request({ method: "eth_accounts", params: undefined }),
    ]);
    if (typeof chainId !== "string" || Number(BigInt(chainId)) !== ARC_MAINNET_CHAIN_ID) {
      throw new Error("The wallet switched away from Arc mainnet during the swap. Nothing more was signed.");
    }
    const active = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof active !== "string" || active.toLowerCase() !== owner.toLowerCase()) {
      throw new Error("The wallet account changed during the swap. Nothing more was signed.");
    }
  }

  /**
   * Synchronous: the exact context object captured at the start of the
   * request must still be the active one, and the final request (with fees
   * and chainId applied) must still be allowed for it.
   */
  function assertStillConfirming(context: SwapGuardContext | null, method: string, params: unknown) {
    const current = getContext();
    if (!context || current !== context) {
      throw new Error("Refused wallet request: this quote is no longer being confirmed.");
    }
    assertAllowedSwapRequest(method, params, current);
  }

  async function request(args: { method: string; params?: unknown }) {
    const context = getContext();
    const kind = assertAllowedSwapRequest(args.method, args.params, context);
    // Report no EIP-5792 batching so the SDK uses the sequential approve/permit
    // path, where every request can be checked individually.
    if (args.method === "wallet_getCapabilities") {
      return {};
    }
    if (kind === "read") {
      return provider.request(args as Parameters<EIP1193Provider["request"]>[0]);
    }

    let params = args.params;
    if (args.method === "eth_sendTransaction" && Array.isArray(params)) {
      // Fetch fees first; everything that can change while waiting is checked afterwards.
      const fees = await getFees();
      params = [
        {
          ...applyArcFeesToTransaction(params[0] as Record<string, unknown>, fees),
          // Bind the transaction to Arc mainnet so a wallet on another network cannot send it.
          chainId: ARC_CHAIN_ID_HEX,
        },
        ...params.slice(1),
      ];
    }

    // Fail early if the quote was cancelled or replaced while fees were fetched.
    assertStillConfirming(context, args.method, params);
    // The wallet must still be on Arc mainnet with the expected account.
    await assertWalletState();
    // The wallet-state read above awaits the wallet, so the quote may have
    // been cancelled or replaced meanwhile: check again. This is the final
    // check, and it is synchronous and immediately followed by the wallet
    // call: there is no await between them.
    assertStillConfirming(context, args.method, params);
    const sent = provider.request({ ...args, params } as Parameters<EIP1193Provider["request"]>[0]);

    const result = await sent;
    if (args.method === "eth_sendTransaction" && typeof result === "string" && (kind === "swap" || kind === "approve")) {
      onTx(result as Hex, kind);
    }
    return result;
  }

  // A Proxy keeps the provider's own methods (on/removeListener) bound to it.
  return new Proxy(provider, {
    get(target, property) {
      if (property === "request") return request;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
