import { NextResponse } from "next/server";

import { FEATURES } from "@/lib/showup-network";
import { readWalletSession, SHOWUP_WALLET_SESSION_COOKIE } from "@/lib/showup-wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional server proxy for Circle's Stablecoin Service (App Kit Swap).
 *
 * Swap works without an API key: the browser then calls Circle directly in
 * its shared, rate-limited permissionless mode and this route is unused.
 * With CIRCLE_SWAP_API_KEY on the server and NEXT_PUBLIC_SHOWUP_SWAP_PROXY=true
 * in the build, quote/swap requests come here and are forwarded with the key.
 *
 * The key is only used when:
 * - the request carries a valid ShowUp wallet session (HttpOnly cookie
 *   issued after the wallet signed the ShowUp login message) for this host;
 * - every address in the request (fromAddress / toAddress) is that wallet;
 * - the wallet and the client IP are under their rate limits.
 * Origin and sec-fetch-site are checked as well, but only as supplementary
 * browser hints, not as authentication. The key never leaves the server.
 */

const UPSTREAM = "https://api.circle.com/v1/stablecoinKits/";
const ALLOWED = new Map<string, "GET" | "POST">([
  ["quote", "GET"],
  ["rates", "GET"],
  ["swap", "POST"],
  ["swap/status", "GET"],
]);
/** Endpoints that act for a wallet and must name it. */
const ADDRESS_REQUIRED = new Set(["quote", "swap"]);
const MAX_BODY_BYTES = 64 * 1024;

/** Per-instance sliding-window limits. */
const RATE_WINDOW_MS = 60_000;
const MAX_PER_WALLET = 30;
const MAX_PER_IP = 60;
const hits = new Map<string, number[]>();

function overLimit(key: string, max: number, now: number) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  const limited = recent.length >= max;
  if (!limited) recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    for (const [entryKey, times] of hits) {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) hits.delete(entryKey);
    }
  }
  return limited;
}

type Context = { params: Promise<{ path?: string[] }> };

function reply(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

function publicHost(request: Request) {
  return (
    firstHeaderValue(request.headers.get("x-forwarded-host")) ||
    request.headers.get("host")?.trim() ||
    new URL(request.url).host
  ).toLowerCase();
}

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function clientIp(request: Request) {
  return firstHeaderValue(request.headers.get("x-forwarded-for")) || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function addressesIn(source: { get(name: string): unknown }) {
  return ["fromAddress", "toAddress"]
    .map((name) => source.get(name))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function forward(request: Request, context: Context, method: "GET" | "POST") {
  if (!FEATURES.mainnetSwap) {
    return reply({ error: "Swap is not enabled on this deployment." }, 404);
  }
  const apiKey = process.env.CIRCLE_SWAP_API_KEY?.trim();
  if (!apiKey) {
    return reply({ error: "The swap service is not available right now." }, 503);
  }

  const url = new URL(request.url);
  const host = publicHost(request);

  // Supplementary browser hints only.
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && new URL(origin).host.toLowerCase() !== host) || (fetchSite && fetchSite !== "same-origin")) {
    return reply({ error: "Cross-origin requests are not allowed." }, 403);
  }

  const { path = [] } = await context.params;
  const endpoint = path.join("/");
  if (endpoint === "logs") {
    // SDK telemetry is not forwarded.
    return new NextResponse(null, { status: 204 });
  }
  if (ALLOWED.get(endpoint) !== method) {
    return reply({ error: "Unsupported swap endpoint." }, 404);
  }

  // Authentication: a signed ShowUp wallet session for this host.
  let session;
  try {
    session = readWalletSession(readCookie(request, SHOWUP_WALLET_SESSION_COOKIE));
  } catch {
    return reply({ error: "Wallet sessions are not configured on this server." }, 503);
  }
  if (!session || session.domain !== host) {
    return reply({ error: "Sign in with your wallet to use the swap service." }, 401);
  }
  const wallet = session.address.toLowerCase();

  const now = Date.now();
  if (overLimit(`wallet:${wallet}`, MAX_PER_WALLET, now) || overLimit(`ip:${clientIp(request)}`, MAX_PER_IP, now)) {
    return reply({ error: "Too many swap requests. Wait a minute and try again." }, 429, { "Retry-After": "60" });
  }

  let body: string | undefined;
  let addresses: string[];
  if (method === "POST") {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return reply({ error: "Request too large." }, 413);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return reply({ error: "Invalid request body." }, 400);
    }
    addresses = addressesIn({ get: (name) => parsed?.[name] });
  } else {
    addresses = addressesIn(url.searchParams);
  }
  if (ADDRESS_REQUIRED.has(endpoint) && addresses.length === 0) {
    return reply({ error: "The request must name the signed-in wallet." }, 400);
  }
  if (addresses.some((address) => address.toLowerCase() !== wallet)) {
    return reply({ error: "The swap service may only be used for your own wallet." }, 403);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (method === "POST") headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(`${UPSTREAM}${endpoint}${url.search}`, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return reply({ error: "Circle's swap service did not respond." }, 502);
  } finally {
    clearTimeout(timer);
  }
}

export function GET(request: Request, context: Context) {
  return forward(request, context, "GET");
}

export function POST(request: Request, context: Context) {
  return forward(request, context, "POST");
}
