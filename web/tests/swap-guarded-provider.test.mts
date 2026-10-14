import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, type Address, type EIP1193Provider, type Hex } from "viem";

import { createGuardedSwapProvider } from "../src/lib/mainnet-swap/guarded-provider";
import { CIRCLE_SWAP_ADAPTER, SWAP_TOKENS, type SwapGuardContext } from "../src/lib/mainnet-swap/swap-logic";

const owner: Address = "0x1111111111111111111111111111111111111111";
const other: Address = "0x2222222222222222222222222222222222222222";
const ONE = BigInt(1_000_000);
const HASH: Hex = `0x${"a".repeat(64)}`;
const approveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

const context: SwapGuardContext = {
  owner,
  tokenIn: "EURC",
  tokenOut: "USDC",
  amountIn: BigInt(10) * ONE,
  minimumOut: BigInt(11) * ONE,
};

const approveTx = {
  from: owner,
  to: SWAP_TOKENS.EURC.address,
  data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [CIRCLE_SWAP_ADAPTER, BigInt(10) * ONE] }),
  gasPrice: "0x1",
};

function setup(overrides: { chainId?: string; account?: Address; reject?: boolean; withContext?: boolean } = {}) {
  const sent: { method: string; params?: unknown }[] = [];
  const hashes: string[] = [];
  const wallet = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === "eth_chainId") return overrides.chainId ?? "0x13b2";
      if (method === "eth_accounts") return [overrides.account ?? owner];
      sent.push({ method, params });
      if (overrides.reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      return HASH;
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider;
  const guarded = createGuardedSwapProvider({
    provider: wallet,
    owner,
    getContext: () => (overrides.withContext === false ? null : context),
    onTx: (hash) => hashes.push(hash),
    getFees: async () => ({ maxFeePerGas: BigInt(20_000_000_000), maxPriorityFeePerGas: BigInt(1_000_000) }),
  });
  return { guarded, sent, hashes };
}

const sendApprove = (guarded: EIP1193Provider) =>
  guarded.request({ method: "eth_sendTransaction", params: [approveTx] } as never) as Promise<unknown>;

test("an allowed transaction is sent with Arc fees and its hash is recorded", async () => {
  const { guarded, sent, hashes } = setup();
  assert.equal(await sendApprove(guarded), HASH);
  const tx = (sent[0].params as Record<string, unknown>[])[0];
  assert.equal(tx.gasPrice, undefined);
  assert.equal(BigInt(tx.maxFeePerGas as string), BigInt(20_000_000_000));
  assert.deepEqual(hashes, [HASH]);
});

test("an account change during the swap stops it before the wallet is asked to sign", async () => {
  const { guarded, sent, hashes } = setup({ account: other });
  await assert.rejects(sendApprove(guarded), /account changed/);
  assert.equal(sent.length, 0);
  assert.equal(hashes.length, 0);
});

test("a network change during the swap stops it before the wallet is asked to sign", async () => {
  const { guarded, sent } = setup({ chainId: "0x2105" });
  await assert.rejects(sendApprove(guarded), /switched away from Arc/);
  assert.equal(sent.length, 0);
});

test("a rejected signature records nothing", async () => {
  const { guarded, hashes } = setup({ reject: true });
  await assert.rejects(sendApprove(guarded), /rejected/);
  assert.equal(hashes.length, 0);
});

test("without a confirmed quote no signing request reaches the wallet", async () => {
  const { guarded, sent } = setup({ withContext: false });
  await assert.rejects(sendApprove(guarded), /no swap is being confirmed/);
  await assert.rejects(guarded.request({ method: "eth_signTypedData_v3", params: [owner, "{}"] } as never) as Promise<unknown>, /unsupported method/);
  assert.equal(sent.length, 0);
});

test("batching is reported as unavailable so every step is checked", async () => {
  const { guarded, sent } = setup();
  assert.deepEqual(await (guarded.request({ method: "wallet_getCapabilities", params: [owner] } as never) as Promise<unknown>), {});
  assert.equal(sent.length, 0);
});

// --- Changes while the fee estimate is pending (review finding) -------------------------

type WalletState = { chainId: string; account: Address; context: SwapGuardContext | null };

/** A guarded provider whose getFees() stays pending until release() is called. */
function setupWithPendingFees() {
  const state: WalletState = { chainId: "0x13b2", account: owner, context };
  const sent: { method: string; params?: unknown }[] = [];
  let release: () => void = () => {};
  let markFeesRequested: () => void = () => {};
  const feesRequested = new Promise<void>((resolve) => {
    markFeesRequested = resolve;
  });
  const wallet = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === "eth_chainId") return state.chainId;
      if (method === "eth_accounts") return [state.account];
      sent.push({ method, params });
      return HASH;
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider;
  const guarded = createGuardedSwapProvider({
    provider: wallet,
    owner,
    getContext: () => state.context,
    onTx: () => {},
    getFees: () =>
      new Promise((resolve) => {
        release = () => resolve({ maxFeePerGas: BigInt(20_000_000_000), maxPriorityFeePerGas: BigInt(1) });
        markFeesRequested();
      }),
  });
  return { guarded, state, sent, feesRequested, release: () => release() };
}

async function changeWhileFeesPending(change: (state: WalletState) => void, expected: RegExp) {
  const env = setupWithPendingFees();
  const sending = sendApprove(env.guarded);
  await env.feesRequested; // the guard is now waiting for the fee estimate
  change(env.state);
  env.release();
  await assert.rejects(sending, expected);
  assert.equal(env.sent.filter((entry) => entry.method === "eth_sendTransaction").length, 0, "no transaction reached the wallet");
}

test("an account change while fees are being estimated stops the transaction", async () => {
  await changeWhileFeesPending((state) => {
    state.account = other;
  }, /account changed/);
});

test("a network change while fees are being estimated stops the transaction", async () => {
  await changeWhileFeesPending((state) => {
    state.chainId = "0x2105";
  }, /switched away from Arc/);
});

test("a quote reset while fees are being estimated stops the transaction", async () => {
  await changeWhileFeesPending((state) => {
    state.context = null;
  }, /no longer being confirmed/);
});

test("a different quote confirmed while fees are being estimated stops the transaction", async () => {
  await changeWhileFeesPending((state) => {
    state.context = { ...context };
  }, /no longer being confirmed/);
});

test("transactions are bound to Arc mainnet's chainId", async () => {
  const { guarded, sent } = setup();
  await sendApprove(guarded);
  assert.equal((sent[0].params as Record<string, unknown>[])[0].chainId, "0x13b2");
});

// --- Changes while the wallet state is being read (review finding on v2) ----------------

/**
 * A guarded provider whose eth_chainId / eth_accounts answers stay pending
 * until release() is called; they then return a valid Arc mainnet account.
 */
function setupWithPendingWalletState() {
  const state: { context: SwapGuardContext | null } = { context };
  const sent: { method: string; params?: unknown }[] = [];
  const contextAtSend: (SwapGuardContext | null)[] = [];
  const waiters: (() => void)[] = [];
  let markStateRequested: () => void = () => {};
  const stateRequested = new Promise<void>((resolve) => {
    markStateRequested = resolve;
  });
  const hold = <T,>(value: T) =>
    new Promise<T>((resolve) => {
      waiters.push(() => resolve(value));
      markStateRequested();
    });
  const wallet = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === "eth_chainId") return hold("0x13b2");
      if (method === "eth_accounts") return hold([owner]);
      sent.push({ method, params });
      contextAtSend.push(state.context);
      return HASH;
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider;
  const guarded = createGuardedSwapProvider({
    provider: wallet,
    owner,
    getContext: () => state.context,
    onTx: () => {},
    getFees: async () => ({ maxFeePerGas: BigInt(20_000_000_000), maxPriorityFeePerGas: BigInt(1) }),
  });
  return {
    guarded,
    state,
    sent,
    contextAtSend,
    stateRequested,
    release: () => waiters.splice(0).forEach((resolve) => resolve()),
  };
}

const usdcPermit = () => [
  owner,
  JSON.stringify({
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    domain: { name: "EURC", version: "2", chainId: 5042, verifyingContract: SWAP_TOKENS.EURC.address },
    message: {
      owner,
      spender: CIRCLE_SWAP_ADAPTER,
      value: (BigInt(10) * ONE).toString(),
      nonce: "0",
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    },
  }),
];

async function changeWhileWalletStatePending(
  method: "eth_sendTransaction" | "eth_signTypedData_v4",
  change: (state: { context: SwapGuardContext | null }) => void,
) {
  const env = setupWithPendingWalletState();
  const params = method === "eth_sendTransaction" ? [approveTx] : usdcPermit();
  const sending = env.guarded.request({ method, params } as never) as Promise<unknown>;
  await env.stateRequested; // the guard is waiting for eth_chainId / eth_accounts
  change(env.state);
  env.release(); // the wallet answers: Arc mainnet, expected account
  await assert.rejects(sending, /no longer being confirmed/);
  assert.equal(env.sent.filter((entry) => entry.method === method).length, 0, `no ${method} reached the wallet`);
}

test("a quote cancelled while the wallet state is read stops the transaction", async () => {
  await changeWhileWalletStatePending("eth_sendTransaction", (state) => {
    state.context = null;
  });
});

test("a quote replaced while the wallet state is read stops the transaction", async () => {
  await changeWhileWalletStatePending("eth_sendTransaction", (state) => {
    state.context = { ...context };
  });
});

test("a quote replaced by one for a different amount while the wallet state is read stops the transaction", async () => {
  await changeWhileWalletStatePending("eth_sendTransaction", (state) => {
    state.context = { ...context, amountIn: BigInt(20) * ONE };
  });
});

test("a quote cancelled while the wallet state is read stops the permit signature", async () => {
  await changeWhileWalletStatePending("eth_signTypedData_v4", (state) => {
    state.context = null;
  });
});

test("when nothing changes, the request is sent with the same context that was checked", async () => {
  const env = setupWithPendingWalletState();
  const sending = sendApprove(env.guarded);
  await env.stateRequested;
  env.release();
  assert.equal(await sending, HASH);
  assert.equal(env.sent.length, 1);
  assert.equal(env.contextAtSend[0], context, "the context active at send time is the one validated");
  assert.equal((env.sent[0].params as Record<string, unknown>[])[0].chainId, "0x13b2");
});

test("nothing is awaited between the final check and the wallet call", async () => {
  // After the wallet answers, every getContext() call schedules a cancellation
  // in the next microtask. The wallet must still see the validated context when
  // it receives the request; any await before the wallet call would let the
  // cancellation run first.
  const state: { context: SwapGuardContext | null; armed: boolean } = { context, armed: false };
  const contextAtSend: (SwapGuardContext | null)[] = [];
  let release: () => void = () => {};
  let markRequested: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  const walletAnswer = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wallet = {
    request: async ({ method }: { method: string }) => {
      if (method === "eth_chainId" || method === "eth_accounts") {
        markRequested();
        await walletAnswer;
        state.armed = true;
        return method === "eth_chainId" ? "0x13b2" : [owner];
      }
      contextAtSend.push(state.context);
      return HASH;
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider;
  const guarded = createGuardedSwapProvider({
    provider: wallet,
    owner,
    getContext: () => {
      const current = state.context;
      if (state.armed) {
        queueMicrotask(() => {
          state.context = null;
        });
      }
      return current;
    },
    onTx: () => {},
    getFees: async () => ({ maxFeePerGas: BigInt(20_000_000_000), maxPriorityFeePerGas: BigInt(1) }),
  });
  const sending = sendApprove(guarded);
  await requested;
  release();
  assert.equal(await sending, HASH);
  assert.equal(contextAtSend.length, 1);
  assert.equal(contextAtSend[0], context, "the wallet was called before any later microtask could change the quote");
});
