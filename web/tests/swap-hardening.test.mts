import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import * as swap from "../src/lib/mainnet-swap/swap-logic";

/**
 * Regression tests for the review findings on the first bridge/swap patch:
 * 1. the wallet guard must decode and match adapter calldata, refuse
 *    unsupported signing methods and fully validate permits;
 * 2. swap success needs on-chain evidence (no SDK "DONE" fallback);
 * 3. Arc fee parameters must be enforced on SDK transactions.
 */

const { CIRCLE_SWAP_ADAPTER, SWAP_TOKENS, assertAllowedSwapRequest, evaluateSwapReceipt } = swap;
const owner: Address = "0x1111111111111111111111111111111111111111";
const attacker: Address = "0x9999999999999999999999999999999999999999";
const pool: Address = "0x5555555555555555555555555555555555555555";
const ONE = BigInt(1_000_000);
const NOW = 1_800_000_000; // seconds
const amountIn = BigInt(10) * ONE;
const minimumOut = BigInt(8_557_000);

const context = {
  owner,
  tokenIn: "USDC" as const,
  tokenOut: "EURC" as const,
  amountIn,
  minimumOut,
  nowSeconds: NOW,
};

const adapterAbi = parseAbi([
  "function execute(((address target, bytes data, uint256 value, address tokenIn, uint256 amountToApprove, address tokenOut, uint256 minTokenOut)[] instructions, (address token, address beneficiary)[] tokens, uint256 execId, uint256 deadline, bytes metadata) params, (uint8 permitType, address token, uint256 amount, bytes permitCalldata)[] tokenInputs, bytes signature)",
]);

function permitCalldata(value: bigint, deadline: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }],
    [value, deadline, 27, `0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`],
  );
}

type ExecOverrides = {
  tokenIn?: Address;
  tokenOut?: Address;
  minTokenOut?: bigint;
  instructionValue?: bigint;
  beneficiary?: Address;
  deadline?: bigint;
  inputToken?: Address;
  inputAmount?: bigint;
  permitType?: number;
  permitValue?: bigint;
  permitDeadline?: bigint;
  extraInputs?: boolean;
};

function executeData(o: ExecOverrides = {}): Hex {
  const permitType = o.permitType ?? 1;
  return encodeFunctionData({
    abi: adapterAbi,
    functionName: "execute",
    args: [
      {
        instructions: [
          {
            target: pool,
            data: "0x1234",
            value: o.instructionValue ?? BigInt(0),
            tokenIn: o.tokenIn ?? SWAP_TOKENS.USDC.address,
            amountToApprove: amountIn,
            tokenOut: o.tokenOut ?? SWAP_TOKENS.EURC.address,
            minTokenOut: o.minTokenOut ?? minimumOut,
          },
        ],
        tokens: [
          { token: SWAP_TOKENS.EURC.address, beneficiary: o.beneficiary ?? owner },
          { token: SWAP_TOKENS.USDC.address, beneficiary: owner },
        ],
        execId: BigInt(7),
        deadline: o.deadline ?? BigInt(NOW + 300),
        metadata: "0x",
      },
      [
        {
          permitType,
          token: o.inputToken ?? SWAP_TOKENS.USDC.address,
          amount: o.inputAmount ?? amountIn,
          permitCalldata: permitType === 1 ? permitCalldata(o.permitValue ?? amountIn, o.permitDeadline ?? BigInt(NOW + 3600)) : "0x",
        },
        ...(o.extraInputs ? [{ permitType: 0, token: SWAP_TOKENS.EURC.address, amount: amountIn, permitCalldata: "0x" as Hex }] : []),
      ],
      `0x${"ab".repeat(65)}`,
    ],
  });
}

function swapTx(data: Hex) {
  return [{ from: owner, to: CIRCLE_SWAP_ADAPTER, data }];
}

function permit(message: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return [
    owner,
    JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: SWAP_TOKENS.USDC.address },
      message: { owner, spender: CIRCLE_SWAP_ADAPTER, value: amountIn.toString(), nonce: "0", deadline: String(NOW + 3600), ...message },
      ...extra,
    }),
  ];
}

// --- Finding 1: adapter calldata ---------------------------------------------------

test("arbitrary data to the adapter (0xdeadbeef) is refused", () => {
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", swapTx("0xdeadbeef"), context));
  assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", [{ from: owner, to: CIRCLE_SWAP_ADAPTER }], context));
});

test("a well-formed execute call matching the confirmed quote is allowed", () => {
  assert.equal(assertAllowedSwapRequest("eth_sendTransaction", swapTx(executeData()), context), "swap");
  // On-chain approval path: no permit input.
  assert.equal(assertAllowedSwapRequest("eth_sendTransaction", swapTx(executeData({ permitType: 0 })), context), "swap");
});

test("execute calls that do not match the quote are refused", () => {
  const cases: [string, ExecOverrides][] = [
    ["output sent to another beneficiary", { beneficiary: attacker }],
    ["different output token", { tokenOut: attacker }],
    ["different input token", { tokenIn: SWAP_TOKENS.EURC.address, inputToken: SWAP_TOKENS.EURC.address }],
    ["minimum below the quote", { minTokenOut: minimumOut - BigInt(1) }],
    ["more input than confirmed", { inputAmount: amountIn + BigInt(1) }],
    ["permit for more than confirmed", { permitValue: amountIn + BigInt(1) }],
    ["expired permit", { permitDeadline: BigInt(NOW - 1) }],
    ["expired execution deadline", { deadline: BigInt(NOW - 1) }],
    ["execution deadline too far away", { deadline: BigInt(NOW + 24 * 3600) }],
    ["native value in an instruction", { instructionValue: BigInt(1) }],
    ["extra token input", { extraInputs: true }],
    ["unknown permit type", { permitType: 2 }],
  ];
  for (const [label, overrides] of cases) {
    assert.throws(() => assertAllowedSwapRequest("eth_sendTransaction", swapTx(executeData(overrides)), context), /Refused wallet request/, label);
  }
});

test("unsupported signing methods are refused, not treated as reads", () => {
  for (const method of ["eth_signTypedData_v3", "eth_signTypedData_v1", "eth_getEncryptionPublicKey", "eth_decrypt", "wallet_grantPermissions", "wallet_sendTransaction"]) {
    assert.throws(() => assertAllowedSwapRequest(method, [owner, "{}"], context), /Refused wallet request/, method);
  }
  // Ordinary reads still pass.
  for (const method of ["eth_chainId", "eth_accounts", "eth_call", "eth_estimateGas", "eth_getTransactionReceipt"]) {
    assert.equal(assertAllowedSwapRequest(method, [], context), "read", method);
  }
});

test("permits are checked for structure, network, token, owner, spender, amount and deadline", () => {
  assert.equal(assertAllowedSwapRequest("eth_signTypedData_v4", permit(), context), "permit");
  const bad: [string, unknown[]][] = [
    ["expired", permit({ deadline: String(NOW - 1) })],
    ["deadline too far", permit({ deadline: String(NOW + 30 * 24 * 3600) })],
    ["missing deadline", permit({ deadline: undefined })],
    ["wrong owner", permit({ owner: attacker })],
    ["extra message field", permit({ extra: "1" })],
    ["non-standard Permit type", permit({}, { types: { Permit: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] } })],
    ["not JSON", [owner, "not json"]],
  ];
  for (const [label, params] of bad) {
    assert.throws(() => assertAllowedSwapRequest("eth_signTypedData_v4", params, context), /Refused wallet request/, label);
  }
});

// --- Finding 2: outcome needs on-chain evidence ----------------------------------------

test("a successful receipt without an output transfer is not a success, even if the SDK says DONE", () => {
  const expected = { owner, tokenOut: "EURC" as const, minimumOut };
  // The first patch accepted a third "service status" argument; it must have no effect now.
  const outcome = Reflect.apply(evaluateSwapReceipt, undefined, [
    { status: "success", logs: [] },
    expected,
    { status: "DONE", amountOut: BigInt(9) * ONE },
  ]) as ReturnType<typeof evaluateSwapReceipt>;
  assert.notEqual(outcome.state, "success");
  const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  const log = {
    address: SWAP_TOKENS.EURC.address,
    topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from: CIRCLE_SWAP_ADAPTER, to: owner } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [minimumOut]),
  };
  assert.equal(evaluateSwapReceipt({ status: "success", logs: [log] }, expected).state, "success");
});

// --- Finding 3: Arc fees on SDK transactions --------------------------------------------

test("SDK transactions get Arc EIP-1559 fees at or above the mempool floor", () => {
  const floor = { maxFeePerGas: BigInt(20_000_000_000), maxPriorityFeePerGas: BigInt(1) };
  const fixed = swap.applyArcFeesToTransaction({ from: owner, to: CIRCLE_SWAP_ADAPTER, data: "0x", gasPrice: "0x1" }, floor);
  assert.equal(fixed.gasPrice, undefined, "legacy gasPrice removed");
  assert.equal(fixed.type, "0x2");
  assert.equal(BigInt(fixed.maxFeePerGas as string), floor.maxFeePerGas);
  assert.equal(BigInt(fixed.maxPriorityFeePerGas as string), BigInt(1));

  const low = swap.applyArcFeesToTransaction({ from: owner, maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00" }, floor);
  assert.equal(BigInt(low.maxFeePerGas as string), floor.maxFeePerGas, "raised to the floor");

  const high = swap.applyArcFeesToTransaction({ from: owner, maxFeePerGas: "0x174876e800" }, floor);
  assert.equal(BigInt(high.maxFeePerGas as string), BigInt("0x174876e800"), "a higher wallet/SDK fee is kept");
  assert.ok(BigInt(high.maxPriorityFeePerGas as string) <= BigInt(high.maxFeePerGas as string));
});
