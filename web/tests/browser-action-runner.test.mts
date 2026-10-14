import { test } from "node:test";
import assert from "node:assert/strict";
import { runBrowserAction, type BrowserActionRuntime } from "../src/lib/browser-action-runner";
import type { Address, Hex } from "viem";
const account: Address = "0x1111111111111111111111111111111111111111";
const other: Address = "0x2222222222222222222222222222222222222222";
const hash: Hex = `0x${"a".repeat(64)}`;
function setup(overrides: Partial<BrowserActionRuntime> = {}) {
  const calls: string[] = [];
  const runtime: BrowserActionRuntime = {
    connect: async () => account,
    funds: async () => ({ balance: BigInt(2000000), allowance: BigInt(0), reserve: BigInt(20000) }),
    submit: async (_, approval) => { calls.push(approval ? "approve" : "action"); return hash; },
    receipt: async () => ({ status: "success" }),
    track: (_, approval) => { calls.push(approval ? "track-approval" : "track-action"); },
    ...overrides,
  };
  return { calls, runtime };
}
test("approval receipt must succeed before the reservation is submitted", async () => {
  const { runtime, calls } = setup({ receipt: async () => ({ status: "reverted" }) });
  await assert.rejects(runBrowserAction(runtime, account, BigInt(1000000)), /approval reverted/);
  assert.deepEqual(calls, ["approve", "track-approval"]);
});
test("account changes after approval prevent the payment", async () => {
  let connections = 0;
  const { runtime, calls } = setup({ connect: async () => ++connections === 1 ? account : other });
  await assert.rejects(runBrowserAction(runtime, account, BigInt(1000000)), /account changed/);
  assert.deepEqual(calls, ["approve", "track-approval"]);
});
test("insufficient gas reserve prevents both transactions", async () => {
  const { runtime, calls } = setup();
  await assert.rejects(runBrowserAction(runtime, account, BigInt(2000000)), /Insufficient USDC/);
  assert.deepEqual(calls, []);
});
test("existing allowance skips approval and still tracks the payment", async () => {
  const { runtime, calls } = setup({ funds: async () => ({ balance: BigInt(2000000), allowance: BigInt(1000000), reserve: BigInt(20000) }) });
  assert.equal(await runBrowserAction(runtime, account, BigInt(1000000)), hash);
  assert.deepEqual(calls, ["action", "track-action"]);
});
test("failed or unknown payment receipts are never reported as success", async () => {
  for (const receipt of [async () => ({ status: "reverted" as const }), async () => { throw new Error("receipt timeout"); }]) {
    const { runtime, calls } = setup({ receipt });
    await assert.rejects(runBrowserAction(runtime, account, BigInt(0)));
    assert.deepEqual(calls, ["action", "track-action"]);
  }
});
test("wallet rejection submits no transaction and success waits for both receipts", async () => {
  const rejected = setup({ submit: async () => { throw new Error("User rejected"); } });
  await assert.rejects(runBrowserAction(rejected.runtime, account, BigInt(0)), /User rejected/);
  assert.deepEqual(rejected.calls, []);
  const success = setup();
  assert.equal(await runBrowserAction(success.runtime, account, BigInt(1000000)), hash);
  assert.deepEqual(success.calls, ["approve", "track-approval", "action", "track-action"]);
});
