"use client";

import { AppKit, SwapChain } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { type Address, type Hex } from "viem";

import { arcPublicClient } from "@/lib/arc-public-client";
import { ensureArcNetwork, findBrowserWalletProvider, getArcFeeOverrides } from "@/lib/browser-wallet";
import { authorizeBrowserWallet } from "@/lib/browser-wallet-auth";
import { ARC_CHAIN_ID, IS_MAINNET } from "@/lib/showup-network";

import { createGuardedSwapProvider, type TxListener } from "./guarded-provider";
import {
  ARC_MAINNET_CHAIN_ID,
  SWAP_TOKENS,
  evaluateSwapReceipt,
  formatTokenUnits,
  isQuoteExpired,
  parseTokenAmount,
  quoteFromEstimate,
  validateSlippage,
  type SwapGuardContext,
  type SwapOutcome,
  type SwapQuote,
  type SwapTokenSymbol,
} from "./swap-logic";

const CIRCLE_ORIGIN = "https://api.circle.com";
const CIRCLE_PATH = "/v1/stablecoinKits/";
/** With an API key configured on the server, Circle requests go through /api/swap/circle. */
const USE_SERVER_PROXY = process.env.NEXT_PUBLIC_SHOWUP_SWAP_PROXY === "true";

function circleUrl(input: RequestInfo | URL): URL | null {
  try {
    const url = new URL(input instanceof Request ? input.url : input.toString(), window.location.href);
    return url.origin === CIRCLE_ORIGIN && url.pathname.startsWith(CIRCLE_PATH) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Runs `operation` with Circle Stablecoin Service requests adjusted for the
 * browser: the SDK's custom user-agent header (which fails CORS preflight)
 * is removed, and with the server proxy enabled the request is sent to
 * /api/swap/circle so the API key never reaches the browser. The proxy
 * requires a signed wallet session; on 401 the wallet is asked to sign the
 * ShowUp login message once and the request is retried.
 */
async function withSwapFetch<T>(operation: () => Promise<T>, authorize: () => Promise<void>): Promise<T> {
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = circleUrl(input);
    if (!url) return originalFetch.call(window, input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.delete("x-user-agent");
    headers.delete("authorization");
    const target = USE_SERVER_PROXY
      ? `/api/swap/circle/${url.pathname.slice(CIRCLE_PATH.length)}${url.search}`
      : url.toString();
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ?? (input instanceof Request && method !== "GET" ? await input.clone().text() : undefined);
    const send = () =>
      originalFetch.call(window, target, {
        method,
        headers,
        body,
        cache: "no-store",
        credentials: USE_SERVER_PROXY ? "same-origin" : "omit",
      });
    const response = await send();
    if (USE_SERVER_PROXY && response.status === 401) {
      await authorize();
      return send();
    }
    return response;
  };
  try {
    return await operation();
  } finally {
    window.fetch = originalFetch;
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" && short ? short : error.message;
  }
  return String(error);
}

export function describeSwapError(error: unknown) {
  const text = errorText(error);
  if (/user (rejected|denied|cancel)/i.test(text) || (error as { code?: unknown })?.code === 4001) {
    return "The request was rejected in the wallet. Nothing was swapped.";
  }
  if (/slippage|stop.?limit|minimum.?output/i.test(text)) {
    return "The price moved past your minimum. Nothing was swapped; get a new quote.";
  }
  if (/rate.?limit|429/i.test(text)) {
    return "Circle's swap service is busy (rate limited). Try again shortly.";
  }
  if (/unsupported route|no route|liquidity/i.test(text)) {
    return "Circle has no route for this swap right now (no liquidity for this pair or amount).";
  }
  return text;
}

/** Verifies a swap transaction from its Arc receipt; works without a wallet (e.g. after a refresh). */
export async function checkSwapTransaction(
  owner: Address,
  txHash: Hex,
  expected: { tokenOut: SwapTokenSymbol; minimumOut: bigint },
  timeoutMs = 90_000,
): Promise<SwapOutcome> {
  let receipt = null;
  try {
    const raw = await arcPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: timeoutMs });
    receipt = { status: raw.status, logs: raw.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) };
  } catch {
    receipt = null;
  }
  return evaluateSwapReceipt(receipt, { owner, ...expected });
}

export type SwapSession = {
  quote(request: { tokenIn: SwapTokenSymbol; tokenOut: SwapTokenSymbol; amountText: string; slippageBps: number }): Promise<SwapQuote>;
  execute(quote: SwapQuote, onTx: TxListener): Promise<{ txHash: Hex; outcome: SwapOutcome }>;
  checkTransaction(txHash: Hex, expected: { tokenOut: SwapTokenSymbol; minimumOut: bigint }): Promise<SwapOutcome>;
  /**
   * Invalidates the quote being confirmed (e.g. the wallet switched account or
   * network). Any pending execute() is refused at its next wallet request.
   */
  cancel(): void;
};

export async function createSwapSession({ providerRdns, owner }: { providerRdns: string; owner: Address }): Promise<SwapSession> {
  if (!IS_MAINNET || ARC_CHAIN_ID !== ARC_MAINNET_CHAIN_ID) {
    throw new Error("The mainnet swap requires NEXT_PUBLIC_SHOWUP_NETWORK=mainnet.");
  }
  const { provider } = await findBrowserWalletProvider(providerRdns);
  let context: SwapGuardContext | null = null;
  let listener: TxListener = () => {};
  const guarded = createGuardedSwapProvider({
    provider,
    owner,
    getContext: () => context,
    onTx: (hash, kind) => listener(hash, kind),
    getFees: () => getArcFeeOverrides(() => arcPublicClient.estimateFeesPerGas()),
  });
  const authorize = async () => {
    await authorizeBrowserWallet({ providerRdns, expectedAddress: owner });
  };

  const adapter = await createViemAdapterFromProvider({
    provider: guarded,
    getPublicClient: ({ chain }) => {
      if (chain.id !== ARC_MAINNET_CHAIN_ID) {
        throw new Error("The swap may only use Arc mainnet.");
      }
      return arcPublicClient;
    },
    capabilities: { addressContext: "user-controlled" },
  });
  const kit = new AppKit();

  async function assertAccount() {
    const accounts = await provider.request({ method: "eth_accounts", params: undefined });
    const active = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof active !== "string" || active.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(`The wallet account changed. Switch back to ${owner} to swap.`);
    }
  }

  const checkTransaction = (txHash: Hex, expected: { tokenOut: SwapTokenSymbol; minimumOut: bigint }) =>
    checkSwapTransaction(owner, txHash, expected);

  return {
    async quote({ tokenIn, tokenOut, amountText, slippageBps }) {
      if (tokenIn === tokenOut) throw new Error("Choose two different tokens.");
      validateSlippage(slippageBps);
      const amountIn = parseTokenAmount(amountText, SWAP_TOKENS[tokenIn].decimals);
      const estimate = await withSwapFetch(() =>
        kit.estimateSwap({
          from: { adapter, chain: SwapChain.Arc },
          tokenIn,
          tokenOut,
          amountIn: formatTokenUnits(amountIn, SWAP_TOKENS[tokenIn].decimals),
          config: { slippageBps, allowanceStrategy: "permit" },
        }),
        authorize,
      );
      return quoteFromEstimate(estimate, { owner, tokenIn, tokenOut, amountIn, slippageBps }, Date.now());
    },

    async execute(quote, onTx) {
      if (isQuoteExpired(quote, Date.now())) {
        throw new Error("This quote has expired. Get a new quote before confirming.");
      }
      await assertAccount();
      await ensureArcNetwork(provider);

      let swapHash: Hex | null = null;
      context = {
        owner,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        minimumOut: quote.minimumOut,
      };
      listener = (hash, kind) => {
        if (kind === "swap") swapHash = hash;
        onTx(hash, kind);
      };
      try {
        const result = await withSwapFetch(
          () =>
            kit.swap({
              from: { adapter, chain: SwapChain.Arc },
              tokenIn: quote.tokenIn,
              tokenOut: quote.tokenOut,
              amountIn: formatTokenUnits(quote.amountIn, SWAP_TOKENS[quote.tokenIn].decimals),
              config: {
                slippageBps: quote.slippageBps,
                // The minimum shown to the user is enforced on-chain.
                stopLimit: formatTokenUnits(quote.minimumOut, SWAP_TOKENS[quote.tokenOut].decimals),
                allowanceStrategy: "permit",
              },
            }),
          authorize,
        );
        // The hash observed at the wallet is authoritative; the SDK's is only a fallback.
        const txHash = (swapHash ?? result.txHash) as Hex | null;
        if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
          throw new Error("Circle did not return a swap transaction hash.");
        }
        // Success is decided from the Arc receipt only, never from the SDK's status.
        const outcome = await checkTransaction(txHash, { tokenOut: quote.tokenOut, minimumOut: quote.minimumOut });
        return { txHash, outcome };
      } catch (error) {
        // If the swap transaction was broadcast, report its real state instead of the SDK error.
        if (swapHash) {
          const outcome = await checkTransaction(swapHash, { tokenOut: quote.tokenOut, minimumOut: quote.minimumOut });
          return { txHash: swapHash, outcome };
        }
        throw new Error(describeSwapError(error));
      } finally {
        context = null;
        listener = () => {};
      }
    },

    checkTransaction: (txHash, expected) => checkTransaction(txHash, expected),

    cancel() {
      context = null;
      listener = () => {};
    },
  };
}
