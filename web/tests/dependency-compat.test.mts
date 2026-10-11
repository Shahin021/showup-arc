import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/**
 * Runtime checks for the dependency overrides in package.json. They exercise
 * the real packages the way the SDKs that pull them in call them:
 * - @solana/web3.js -> jayson 5.0.0 (browser JSON-RPC client)
 * - @coral-xyz/anchor -> toml 4.2.0 (Anchor.toml parser)
 * - @circle-fin/w3s-pw-web-sdk -> uuid 11.1.1 (CommonJS require of v4)
 * - @circle-fin/app-kit + @circle-fin/adapter-viem-v2 load and run the
 *   Arc swap estimate path up to Circle's quote request.
 */

const requireFrom = (pkg: string) => createRequire(createRequire(import.meta.url).resolve(`${pkg}/package.json`));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("overrides resolve to the reviewed versions for their parents", () => {
  assert.equal(requireFrom("@solana/web3.js")("jayson/package.json").version, "5.0.0");
  assert.equal(requireFrom("@coral-xyz/anchor")("toml/package.json").version, "4.2.0");
  assert.equal(requireFrom("@circle-fin/w3s-pw-web-sdk")("uuid/package.json").version, "11.1.1");
  assert.throws(() => requireFrom("@solana/web3.js")("stream-json/package.json"), /Cannot find module/);
});

test("@solana/web3.js JSON-RPC calls work through jayson 5 with UUID request ids", async () => {
  const { Connection } = await import("@solana/web3.js");
  const ids: unknown[] = [];
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    const request = JSON.parse(init.body);
    ids.push(request.id);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { "solana-core": "1.18.0", "feature-set": 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const connection = new Connection("https://rpc.invalid", { fetch: fakeFetch });
  const version = await connection.getVersion();
  assert.equal(version["solana-core"], "1.18.0");
  assert.equal(ids.length, 1);
  assert.match(String(ids[0]), UUID);
});

test("Anchor's toml parses Anchor.toml content as before", () => {
  const toml = requireFrom("@coral-xyz/anchor")("toml");
  const parsed = toml.parse(
    Buffer.from('[provider]\ncluster = "localnet"\nwallet = "~/.config/solana/id.json"\n\n[programs.localnet]\nshowup = "11111111111111111111111111111111"\n'),
  );
  assert.equal(parsed.provider.cluster, "localnet");
  assert.equal(parsed.programs.localnet.showup, "11111111111111111111111111111111");
  // Sanity check only: these simple __proto__ inputs did not pollute toml 3.0.0 either,
  // so this does not demonstrate GHSA-v5mp-jgw5-2x6j; it guards against regressions.
  try {
    toml.parse('[__proto__]\npolluted = "yes"\n[a.__proto__]\npolluted2 = "yes"\n');
  } catch {
    // Rejecting the input is also acceptable.
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted2, undefined);
});

test("deeply nested TOML is rejected with a controlled error instead of exhausting the stack (GHSA-82x6-q7mm-w9cf)", () => {
  const toml = requireFrom("@coral-xyz/anchor")("toml");
  const depth = 5000; // toml 3.0.0 throws "RangeError: Maximum call stack size exceeded" here
  const input = "a = " + "[".repeat(depth) + "]".repeat(depth);
  assert.throws(
    () => toml.parse(input),
    (error: unknown) => error instanceof Error && !(error instanceof RangeError) && /nesting depth/i.test(error.message),
  );
});

test("the Circle PIN SDK's CommonJS require('uuid').v4 works with uuid 11 and buffers are bounds-checked", () => {
  const uuid = requireFrom("@circle-fin/w3s-pw-web-sdk")("uuid");
  assert.match(uuid.v4(), UUID);
  assert.throws(() => uuid.v4(undefined, new Uint8Array(8), 0), RangeError);
});

test("App Kit and the viem adapter load and run the Arc swap estimate up to Circle's quote request", async () => {
  const { AppKit, SwapChain } = await import("@circle-fin/app-kit");
  const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
  const { createPublicClient, custom } = await import("viem");
  const owner = "0x1111111111111111111111111111111111111111";

  const rpc = async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return "0x13b2";
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [owner];
    if (method === "eth_blockNumber") return "0x1";
    throw Object.assign(new Error(`unexpected ${method}`), { code: 4200 });
  };
  const provider = { request: rpc, on() {}, removeListener() {} };
  const adapter = await createViemAdapterFromProvider({
    provider: provider as never,
    getPublicClient: ({ chain }) => createPublicClient({ chain, transport: custom({ request: rpc }) }),
    capabilities: { addressContext: "user-controlled" },
  });
  const kit = new AppKit();

  const requests: { url: URL; method: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    } catch {
      body = {};
    }
    requests.push({ url, method, body });
    return new Response(JSON.stringify({ message: "test stop" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await assert.rejects(
      kit.estimateSwap({
        from: { adapter, chain: SwapChain.Arc },
        tokenIn: "USDC",
        tokenOut: "EURC",
        amountIn: "1",
        config: { slippageBps: 50, allowanceStrategy: "permit" },
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  // App Kit 1.16 estimates Arc swaps through POST /v1/stablecoinKits/swap.
  // The server proxy (tests/swap-proxy-auth.test.mts) binds that body's
  // fromAddress to the signed-in wallet, so it must carry the owner.
  const serviceCall = requests.find(
    (entry) => entry.url.pathname === "/v1/stablecoinKits/swap" || entry.url.pathname === "/v1/stablecoinKits/quote",
  );
  assert.ok(serviceCall, `App Kit called Circle's Stablecoin Service (saw: ${requests.map((e) => `${e.method} ${e.url.pathname}`).join(", ")})`);
  assert.equal(serviceCall.url.origin, "https://api.circle.com");
  const fromAddress = String(serviceCall.body.fromAddress ?? serviceCall.url.searchParams.get("fromAddress") ?? "");
  assert.equal(fromAddress.toLowerCase(), owner);
  assert.equal(String(serviceCall.body.tokenInAddress ?? serviceCall.url.searchParams.get("tokenInAddress")).toLowerCase(), "0x3600000000000000000000000000000000000000");
});
