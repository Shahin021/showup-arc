import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Finding 4: the server key may only be used for an authenticated wallet
 * session, for that wallet's own address, and under a rate limit. Origin and
 * sec-fetch-site are only supplementary checks.
 */

process.env.NEXT_PUBLIC_SHOWUP_NETWORK = "mainnet";
process.env.NEXT_PUBLIC_SHOWUP_CHAIN_ID = "5042";
process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS = "0x6108613878E4FA3531f3CB478D12AC49147d7366";
process.env.SHOWUP_WALLET_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.CIRCLE_SWAP_API_KEY = "TEST_API_KEY:id:secret";

const { createWalletSession, SHOWUP_WALLET_SESSION_COOKIE } = await import("../src/lib/showup-wallet-auth");
const proxy = await import("../src/app/api/swap/circle/[...path]/route");

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const realFetch = globalThis.fetch;
let upstreamCalls: { url: string; init?: RequestInit }[] = [];

test.beforeEach(() => {
  upstreamCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    upstreamCalls.push({ url: input.toString(), init });
    return Response.json({ ok: true });
  }) as typeof fetch;
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function sessionCookie(address: string, domain = "app.example") {
  return `${SHOWUP_WALLET_SESSION_COOKIE}=${createWalletSession({ address, domain }).token}`;
}

function quoteRequest(cookie?: string, from = owner, extraHeaders: Record<string, string> = {}) {
  return new Request(`https://app.example/api/swap/circle/quote?fromAddress=${from}&tokenInAddress=x`, {
    headers: {
      host: "app.example",
      origin: "https://app.example",
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
  });
}

test("a same-origin request without a wallet session is refused before the key is used", async () => {
  const response = await proxy.GET(quoteRequest(), context(["quote"]));
  assert.equal(response.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test("forged or expired sessions are refused", async () => {
  const forged = `${SHOWUP_WALLET_SESSION_COOKIE}=eyJmb28iOiJiYXIifQ.c2lnbmF0dXJl`;
  assert.equal((await proxy.GET(quoteRequest(forged), context(["quote"]))).status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test("a session for another domain is refused", async () => {
  const response = await proxy.GET(quoteRequest(sessionCookie(owner, "evil.example")), context(["quote"]));
  assert.equal(response.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test("the key is only used for the session's own wallet address", async () => {
  const mismatch = await proxy.GET(quoteRequest(sessionCookie(owner), other), context(["quote"]));
  assert.equal(mismatch.status, 403);

  const post = new Request("https://app.example/api/swap/circle/swap", {
    method: "POST",
    headers: { host: "app.example", origin: "https://app.example", cookie: sessionCookie(owner), "content-type": "application/json" },
    body: JSON.stringify({ fromAddress: owner, toAddress: other }),
  });
  assert.equal((await proxy.POST(post, context(["swap"]))).status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test("an authenticated request is forwarded with the server key", async () => {
  const response = await proxy.GET(quoteRequest(sessionCookie(owner)), context(["quote"]));
  assert.equal(response.status, 200);
  assert.equal(upstreamCalls.length, 1);
  assert.equal((upstreamCalls[0].init?.headers as Record<string, string>).Authorization, "Bearer TEST_API_KEY:id:secret");
  // The browser never receives the key.
  assert.doesNotMatch(await response.text(), /TEST_API_KEY/);
});

test("requests are rate limited per wallet", async () => {
  const cookie = sessionCookie("0x3333333333333333333333333333333333333333");
  const from = "0x3333333333333333333333333333333333333333";
  let limited = 0;
  for (let i = 0; i < 80; i++) {
    const response = await proxy.GET(quoteRequest(cookie, from), context(["quote"]));
    if (response.status === 429) limited++;
  }
  assert.ok(limited > 0, "some requests are rejected with 429");
  assert.ok(upstreamCalls.length < 80);
});

test("without CIRCLE_SWAP_API_KEY the proxy is off and the browser uses Circle directly", async () => {
  const key = process.env.CIRCLE_SWAP_API_KEY;
  delete process.env.CIRCLE_SWAP_API_KEY;
  try {
    const response = await proxy.GET(quoteRequest(sessionCookie(owner)), context(["quote"]));
    assert.equal(response.status, 503);
    assert.equal(upstreamCalls.length, 0);
  } finally {
    process.env.CIRCLE_SWAP_API_KEY = key;
  }
});
