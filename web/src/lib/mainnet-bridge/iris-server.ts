import "server-only";

import { NextResponse } from "next/server";

import { FEATURES } from "@/lib/showup-network";

import { BRIDGE_CHAINS, CCTP_IRIS_API_BASE_URL } from "./cctp-routes";

/**
 * Server-side access to Circle's mainnet attestation service (Iris).
 *
 * Iris allows 40 requests per second and blocks the caller for five minutes
 * when that is exceeded. All users share the deployment's egress IPs, so
 * responses are cached briefly and a 429 pauses upstream calls instead of
 * extending the block.
 */

const ALLOWED_DOMAINS = new Set(Object.values(BRIDGE_CHAINS).map((chain) => chain.domain));
const UPSTREAM_TIMEOUT_MS = 10_000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000;

let blockedUntil = 0;
const cache = new Map<string, { expires: number; status: number; body: unknown }>();

export function bridgeDisabledResponse() {
  if (FEATURES.mainnetBridge) return null;
  return NextResponse.json(
    { error: "The CCTP bridge is not enabled on this deployment." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

export function readDomain(value: string | null): number | null {
  if (!value || !/^\d{1,3}$/.test(value)) return null;
  const domain = Number(value);
  return ALLOWED_DOMAINS.has(domain) ? domain : null;
}

export function isTxHash(value: string | null): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export async function irisRequest(
  path: string,
  { method = "GET", cacheMs = 0 }: { method?: "GET" | "POST"; cacheMs?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const now = Date.now();
  const key = `${method} ${path}`;
  const cached = method === "GET" ? cache.get(key) : undefined;
  if (cached && cached.expires > now) {
    return { status: cached.status, body: cached.body };
  }
  if (blockedUntil > now) {
    return { status: 503, body: { error: "Circle's attestation service is rate limited. Try again in a few minutes." } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${CCTP_IRIS_API_BASE_URL}${path}`, {
      method,
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 429) {
      blockedUntil = now + RATE_LIMIT_BACKOFF_MS;
      return { status: 503, body: { error: "Circle's attestation service is rate limited. Try again in a few minutes." } };
    }
    const body: unknown = await response.json().catch(() => null);
    const result = { status: response.status, body };
    if (method === "GET" && cacheMs > 0 && (response.ok || response.status === 404)) {
      cache.set(key, { ...result, expires: now + cacheMs });
      if (cache.size > 500) {
        for (const [entryKey, entry] of cache) {
          if (entry.expires <= now) cache.delete(entryKey);
        }
      }
    }
    return result;
  } catch {
    return { status: 502, body: { error: "Circle's attestation service did not respond." } };
  } finally {
    clearTimeout(timer);
  }
}
