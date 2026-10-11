import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SHOWUP_NETWORK = "mainnet";
process.env.NEXT_PUBLIC_SHOWUP_CHAIN_ID = "5042";
process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS = "0x6108613878E4FA3531f3CB478D12AC49147d7366";

const messages = await import("../src/app/api/bridge/cctp/messages/route");
const fees = await import("../src/app/api/bridge/cctp/fees/route");
const reattest = await import("../src/app/api/bridge/cctp/reattest/route");
const swapProxy = await import("../src/app/api/swap/circle/[...path]/route");

const HASH = `0x${"c".repeat(64)}`;
const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    seen.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return seen;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the attestation proxy validates input and only calls Circle's mainnet Iris API", async () => {
  const seen = mockFetch(() => Response.json({ messages: [{ status: "pending_confirmations" }] }));
  const bad = await messages.GET(new Request(`http://app/api/bridge/cctp/messages?sourceDomain=7&transactionHash=${HASH}`));
  assert.equal(bad.status, 400, "domains outside Arc/Ethereum/Base are rejected");
  assert.equal((await messages.GET(new Request("http://app/api/bridge/cctp/messages?sourceDomain=0&transactionHash=0x12"))).status, 400);
  assert.equal(seen.length, 0);

  const ok = await messages.GET(new Request(`http://app/api/bridge/cctp/messages?sourceDomain=26&transactionHash=${HASH}`));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, `https://iris-api.circle.com/v2/messages/26?transactionHash=${HASH}`);
});

test("a not-yet-indexed burn returns 404 so the client keeps waiting", async () => {
  mockFetch(() => new Response("{}", { status: 404 }));
  const hash = `0x${"d".repeat(64)}`;
  const response = await messages.GET(new Request(`http://app/api/bridge/cctp/messages?sourceDomain=0&transactionHash=${hash}`));
  assert.equal(response.status, 404);
});

test("fees are only served for supported routes and validated", async () => {
  const seen = mockFetch(() => Response.json([{ finalityThreshold: 1000, minimumFee: 1 }, { finalityThreshold: 2000, minimumFee: 0 }]));
  assert.equal((await fees.GET(new Request("http://app/api/bridge/cctp/fees?sourceDomain=0&destinationDomain=6"))).status, 400);
  const ok = await fees.GET(new Request("http://app/api/bridge/cctp/fees?sourceDomain=0&destinationDomain=26&forward=true"));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, "https://iris-api.circle.com/v2/burn/USDC/fees/0/26?forward=true");

  mockFetch(() => Response.json({ unexpected: true }));
  assert.equal((await fees.GET(new Request("http://app/api/bridge/cctp/fees?sourceDomain=6&destinationDomain=26"))).status, 502);
});

test("re-attestation requires a nonce", async () => {
  const seen = mockFetch(() => Response.json({}));
  const bad = await reattest.POST(new Request("http://app/api/bridge/cctp/reattest", { method: "POST", body: JSON.stringify({ nonce: "1" }) }));
  assert.equal(bad.status, 400);
  assert.equal(seen.length, 0);
  const nonce = `0x${"e".repeat(64)}`;
  const ok = await reattest.POST(new Request("http://app/api/bridge/cctp/reattest", { method: "POST", body: JSON.stringify({ nonce }) }));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, `https://iris-api.circle.com/v2/reattest/${nonce}`);
  assert.equal(seen[0].init?.method, "POST");
});

test("a 429 from Circle pauses upstream calls instead of extending the block", async () => {
  const seen = mockFetch(() => new Response("{}", { status: 429 }));
  const first = await messages.GET(new Request(`http://app/api/bridge/cctp/messages?sourceDomain=6&transactionHash=0x${"f".repeat(64)}`));
  assert.equal(first.status, 503);
  const second = await messages.GET(new Request(`http://app/api/bridge/cctp/messages?sourceDomain=6&transactionHash=0x${"1".repeat(64)}`));
  assert.equal(second.status, 503);
  assert.equal(seen.length, 1, "no further upstream request during the backoff");
});

test("the swap proxy needs a server key, rejects other origins and unknown endpoints", async () => {
  const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
  delete process.env.CIRCLE_SWAP_API_KEY;
  assert.equal((await swapProxy.GET(new Request("http://app/api/swap/circle/quote"), context(["quote"]))).status, 503);

  process.env.CIRCLE_SWAP_API_KEY = "TEST_API_KEY:id:secret";
  const seen = mockFetch(() => Response.json({ ok: true }));
  const crossSite = await swapProxy.GET(
    new Request("http://app/api/swap/circle/quote", { headers: { origin: "https://evil.example" } }),
    context(["quote"]),
  );
  assert.equal(crossSite.status, 403);
  assert.equal((await swapProxy.GET(new Request("http://app/api/swap/circle/admin"), context(["admin"]))).status, 404);
  assert.equal((await swapProxy.GET(new Request("http://app/api/swap/circle/swap"), context(["swap"]))).status, 404, "swap is POST-only");
  assert.equal(seen.length, 0);

  // Same-origin headers alone are not authentication (see tests/swap-proxy-auth.test.mts).
  const unauthenticated = await swapProxy.GET(
    new Request("http://app/api/swap/circle/quote?tokenIn=USDC", { headers: { origin: "http://app", "sec-fetch-site": "same-origin" } }),
    context(["quote"]),
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal(seen.length, 0);
  delete process.env.CIRCLE_SWAP_API_KEY;
});
