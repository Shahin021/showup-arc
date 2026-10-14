import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import {
  CIRCLE_SWAP_ADAPTER,
  QUOTE_TTL_MS,
  SWAP_TOKENS,
  assertAllowedSwapRequest,
  evaluateSwapReceipt,
  isQuoteExpired,
  loadSwaps,
  parseTokenAmount,
  quoteFromEstimate,
  quoteSecondsLeft,
  saveSwap,
  swapStorageKey,
  validateSlippage,
  type SwapGuardContext,
} from "../src/lib/mainnet-swap/swap-logic";

const owner: Address = "0x1111111111111111111111111111111111111111";
const attacker: Address = "0x9999999999999999999999999999999999999999";
const ONE = BigInt(1_000_000);
const approveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

const NOW = Math.floor(Date.now() / 1000);
const usdcContext: SwapGuardContext = { owner, tokenIn: "USDC", tokenOut: "EURC", amountIn: BigInt(10) * ONE, minimumOut: BigInt(8_557_000), nowSeconds: NOW };
const eurcContext: SwapGuardContext = { owner, tokenIn: "EURC", tokenOut: "USDC", amountIn: BigInt(10) * ONE, minimumOut: BigInt(11_000_000), nowSeconds: NOW };

function approveTx(token: Address, spender: Address, amount: bigint) {
  return [{ from: owner, to: token, data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [spender, amount] }) }];
}

function permit(overrides: Record<string, unknown> = {}, domain: Record<string, unknown> = {}) {
  return [
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
      domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: SWAP_TOKENS.USDC.address, ...domain },
      message: { owner, spender: CIRCLE_SWAP_ADAPTER, value: (BigInt(10) * ONE).toString(), nonce: "0", deadline: String(NOW + 3600), ...overrides },
    }),
  ];
}

function transferLog(token: Address, to: Address, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from: CIRCLE_SWAP_ADAPTER, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

const estimate = {
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "10",
  estimatedOutput: { token: "EURC", amount: "8.6" },
  stopLimit: { token: "EURC", amount: "8.557" },
  fees: [{ type: "provider", token: "USDC", amount: "0.002" }],
};
const request = { owner, tokenIn: "USDC" as const, tokenOut: "EURC" as const, amountIn: BigInt(10) * ONE, slippageBps: 50 };

// --- Wallet request guard -----------------------------------------------------

test("only exact-amount approvals to the Circle adapter are allowed", () => {
  assert.equal(assertAllowedSwapRequest("eth_sendTransaction", approveTx(SWAP_TOKENS.EURC.address, CIRCLE_SWAP_ADAPTER, BigInt(10) * ONE), eurcContext), "approve");
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", approveTx(SWAP_TOKENS.EURC.address, attacker, BigInt(10) * ONE), eurcContext), /unknown spender/);
  assert.throws(
    () => assertAllowedSwapRequest("eth_sendTransaction", approveTx(SWAP_TOKENS.EURC.address, CIRCLE_SWAP_ADAPTER, BigInt(2) ** BigInt(256) - BigInt(1)), eurcContext),
    /different amount/,
  );
  // Approving a different token than tokenIn is refused.
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", approveTx(SWAP_TOKENS.USDC.address, CIRCLE_SWAP_ADAPTER, BigInt(10) * ONE), eurcContext), /unexpected contract/);
});

test("swap transactions may only call the Circle adapter from the owner without value", () => {
  // Call data is decoded and matched in tests/swap-hardening.test.mts; here the envelope checks.
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: owner, to: CIRCLE_SWAP_ADAPTER, data: "0x1234" }], usdcContext), /not a valid execute/);
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: owner, to: attacker, data: "0x" }], usdcContext), /unexpected contract/);
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: attacker, to: CIRCLE_SWAP_ADAPTER, data: "0x" }], usdcContext), /sender/);
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: owner, to: CIRCLE_SWAP_ADAPTER, data: "0x", value: "0x1" }], usdcContext), /native value/);
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: owner, to: CIRCLE_SWAP_ADAPTER, data: "0x", chainId: "0x1" }], usdcContext), /wrong network/);
  // No signing at all without a confirmed quote.
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: owner, to: CIRCLE_SWAP_ADAPTER, data: "0x" }], null), /no swap is being confirmed/);
});

test("permits must be exact, for tokenIn, on Arc, to the Circle adapter", () => {
  assert.equal(assertAllowedSwapRequest("eth_signTypedData_v4", permit(), usdcContext), "permit");
  assert.throws(() => assertAllowedSwapRequest("eth_signTypedData_v4", permit({ spender: attacker }), usdcContext), /not Circle.s adapter/);
  assert.throws(() => assertAllowedSwapRequest("eth_signTypedData_v4", permit({ value: (BigInt(11) * ONE).toString() }), usdcContext), /different amount/);
  assert.throws(() => assertAllowedSwapRequest("eth_signTypedData_v4", permit({}, { chainId: 1 }), usdcContext), /wrong network/);
  assert.throws(() => assertAllowedSwapRequest("eth_signTypedData_v4", permit({}, { verifyingContract: SWAP_TOKENS.EURC.address }), usdcContext), /unexpected token/);
});

test("other signing methods and foreign networks are refused; reads pass", () => {
  for (const method of ["personal_sign", "eth_sign", "wallet_sendCalls", "eth_sendRawTransaction"]) {
    assert.throws(() => assertAllowedSwapRequest(method, [], usdcContext), /Refused/);
  }
  assert.throws(() => assertAllowedSwapRequest("wallet_switchEthereumChain", [{ chainId: "0x1" }], usdcContext), /Arc mainnet/);
  assert.equal(assertAllowedSwapRequest("wallet_switchEthereumChain", [{ chainId: "0x13b2" }], usdcContext), "read");
  assert.equal(assertAllowedSwapRequest("eth_call", [], usdcContext), "read");
});

// --- Quotes ------------------------------------------------------------------------

test("a quote shows the estimate and enforces the minimum within slippage", () => {
  const quote = quoteFromEstimate(estimate, request, 1000);
  assert.equal(quote.estimatedOut, BigInt(8_600_000));
  assert.equal(quote.minimumOut, BigInt(8_557_000));
  assert.equal(quote.fees.length, 1);

  assert.throws(() => quoteFromEstimate({ ...estimate, stopLimit: { token: "EURC", amount: "8.0" } }, request, 1000), /below your slippage/);
  assert.throws(() => quoteFromEstimate({ ...estimate, stopLimit: { token: "EURC", amount: "9" } }, request, 1000), /inconsistent/);
  assert.throws(() => quoteFromEstimate({ ...estimate, tokenOut: "USDC" }, request, 1000), /different token pair/);
  assert.throws(() => quoteFromEstimate({ ...estimate, amountIn: "100" }, request, 1000), /different amount/);
});

test("quotes expire and must be refreshed before confirming", () => {
  const quote = quoteFromEstimate(estimate, request, 1000);
  assert.equal(isQuoteExpired(quote, 1000 + QUOTE_TTL_MS - 1), false);
  assert.equal(isQuoteExpired(quote, 1000 + QUOTE_TTL_MS), true);
  assert.equal(quoteSecondsLeft(quote, 1000), QUOTE_TTL_MS / 1000);
  assert.equal(quoteSecondsLeft(quote, 1000 + QUOTE_TTL_MS + 5000), 0);
});

test("slippage and amounts are validated", () => {
  assert.equal(validateSlippage(50), 50);
  for (const bad of [0, -1, 301, 1.5]) assert.throws(() => validateSlippage(bad));
  assert.equal(parseTokenAmount("1.25", 6), BigInt(1_250_000));
  for (const bad of ["0", "", "1.1234567", "1e2"]) assert.throws(() => parseTokenAmount(bad, 6));
});

// --- Outcome ---------------------------------------------------------------------------

test("success requires a successful receipt paying at least the minimum", () => {
  const expected = { owner, tokenOut: "EURC" as const, minimumOut: BigInt(8_557_000) };
  const paid = { status: "success" as const, logs: [transferLog(SWAP_TOKENS.EURC.address, owner, BigInt(8_590_000))] };
  assert.deepEqual(evaluateSwapReceipt(paid, expected), { state: "success", received: BigInt(8_590_000) });

  assert.equal(evaluateSwapReceipt(null, expected).state, "pending");
  assert.equal(evaluateSwapReceipt({ status: "reverted", logs: [] }, expected).state, "failed");
  // Paid to someone else, or less than the minimum: not a success.
  assert.equal(evaluateSwapReceipt({ status: "success", logs: [transferLog(SWAP_TOKENS.EURC.address, attacker, BigInt(9) * ONE)] }, expected).state, "unknown");
  assert.equal(evaluateSwapReceipt({ status: "success", logs: [transferLog(SWAP_TOKENS.EURC.address, owner, BigInt(1))] }, expected).state, "unknown");
  // A Transfer log emitted by a different contract is not evidence.
  assert.equal(evaluateSwapReceipt({ status: "success", logs: [{ ...transferLog(SWAP_TOKENS.EURC.address, owner, BigInt(9) * ONE), address: attacker }] }, expected).state, "unknown");
  assert.equal(evaluateSwapReceipt({ status: "success", logs: [] }, expected).state, "unknown");
});

test("swap transactions are stored per owner and malformed entries are ignored", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const swap = {
    version: 1 as const, owner, txHash: `0x${"a".repeat(64)}` as Hex, tokenIn: "USDC" as const, tokenOut: "EURC" as const,
    amountIn: "10000000", minimumOut: "8557000", createdAt: 5, status: "submitted" as const,
  };
  saveSwap(storage, swap);
  saveSwap(storage, { ...swap, status: "success", received: "8590000" });
  assert.equal(loadSwaps(storage, owner).length, 1);
  assert.equal(loadSwaps(storage, owner)[0].status, "success");
  data.set(swapStorageKey(owner), JSON.stringify([{ ...swap, txHash: "0x12" }, "junk"]));
  assert.deepEqual(loadSwaps(storage, owner), []);
});
