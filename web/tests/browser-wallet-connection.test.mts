import { test } from "node:test";
import assert from "node:assert/strict";
import type { EIP1193Provider } from "viem";

process.env.NEXT_PUBLIC_SHOWUP_NETWORK = "mainnet";
process.env.NEXT_PUBLIC_SHOWUP_CHAIN_ID = "5042";
process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS = "0x6108613878E4FA3531f3CB478D12AC49147d7366";

const { connectBrowserWallet, signBrowserWalletMessage } = await import("../src/lib/browser-wallet");
const owner = "0x1111111111111111111111111111111111111111" as const;
const other = "0x2222222222222222222222222222222222222222" as const;
const signature = `0x${"11".repeat(65)}`;

function mockWallet(initialAccounts: string[] = [owner]) {
  let accounts = initialAccounts;
  let chain = "0x13b2";
  const calls: string[] = [];
  const provider = {
    async request({ method }: { method: string }) {
      calls.push(method);
      if (method === "eth_accounts") return accounts;
      if (method === "eth_requestAccounts") { accounts = [owner]; return accounts; }
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") { chain = "0x13b2"; return null; }
      if (method === "personal_sign") return signature;
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  } as unknown as EIP1193Provider;
  return { provider, calls, setAccounts(value: string[]) { accounts = value; }, setChain(value: string) { chain = value; } };
}

function installWalletWindow(t: { after(callback: () => void): void }, provider: EIP1193Provider) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browser = Object.assign(new EventTarget(), { ethereum: provider, setTimeout });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
}

test("an authorized wallet is read without another permission prompt", async () => {
  const wallet = mockWallet();
  const connection = await connectBrowserWallet(wallet.provider);
  assert.equal(connection.address, owner);
  assert.equal(wallet.calls.filter((method) => method === "eth_requestAccounts").length, 0);
  assert.ok(wallet.calls.includes("eth_chainId"), "Arc is still checked");
});

test("first connection followed by login signing requests account access once and signs once", async (t) => {
  const wallet = mockWallet([]);
  installWalletWindow(t, wallet.provider);
  await connectBrowserWallet(wallet.provider);
  const signed = await signBrowserWalletMessage({ providerRdns: "legacy.injected", expectedAddress: owner, message: "Prove ownership for ShowUp" });
  assert.equal(signed.address, owner);
  assert.equal(signed.signature, signature);
  assert.equal(wallet.calls.filter((method) => method === "eth_requestAccounts").length, 1);
  assert.equal(wallet.calls.filter((method) => method === "personal_sign").length, 1);
});

test("a changed account cannot sign a challenge for the original account", async (t) => {
  const wallet = mockWallet([other]);
  installWalletWindow(t, wallet.provider);
  await assert.rejects(signBrowserWalletMessage({ providerRdns: "legacy.injected", expectedAddress: owner, message: "Prove ownership for ShowUp" }), /account has changed/);
  assert.ok(!wallet.calls.includes("personal_sign"));
  assert.ok(!wallet.calls.includes("eth_requestAccounts"));
});

test("an authorized wallet on another network is still switched to Arc", async () => {
  const wallet = mockWallet();
  wallet.setChain("0x1");
  await connectBrowserWallet(wallet.provider);
  assert.ok(wallet.calls.includes("wallet_switchEthereumChain"));
  assert.ok(!wallet.calls.includes("eth_requestAccounts"));
});

test("rejected account access stops before switching networks or signing", async () => {
  const calls: string[] = [];
  const provider = {
    async request({ method }: { method: string }) {
      calls.push(method);
      if (method === "eth_accounts") return [];
      if (method === "eth_requestAccounts") throw Object.assign(new Error("User rejected access"), { code: 4001 });
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  } as unknown as EIP1193Provider;
  await assert.rejects(connectBrowserWallet(provider), /User rejected access/);
  assert.ok(!calls.includes("wallet_switchEthereumChain"));
  assert.ok(!calls.includes("personal_sign"));
});
