import type { Address, Hex } from "viem";

/** RPC/wallet boundary for the multi-transaction payment flow. */
export type BrowserActionRuntime = {
  connect: () => Promise<Address>;
  funds: () => Promise<{ balance: bigint; allowance: bigint; reserve: bigint }>;
  submit: (account: Address, approval: boolean) => Promise<Hex>;
  receipt: (hash: Hex) => Promise<{ status: "success" | "reverted" }>;
  track: (hash: Hex, approval: boolean) => void;
};

export async function runBrowserAction(runtime: BrowserActionRuntime, expected: Address, amount: bigint) {
  async function send(approval: boolean) {
    const account = await runtime.connect();
    if (account.toLowerCase() !== expected.toLowerCase()) throw new Error("The wallet account changed. Reconnect the expected account.");
    const hash = await runtime.submit(account, approval);
    runtime.track(hash, approval);
    if ((await runtime.receipt(hash)).status !== "success") throw new Error(`${approval ? "USDC approval" : "Transaction"} reverted. See the transaction receipt.`);
    return hash;
  }
  if (amount > BigInt(0)) {
    const { balance, allowance, reserve } = await runtime.funds();
    if (balance < amount + reserve) throw new Error("Insufficient USDC for this payment and estimated network fees.");
    if (allowance < amount) await send(true);
  }
  return send(false);
}
