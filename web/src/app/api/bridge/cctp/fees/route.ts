import { isBurnFeeTiers, isSupportedRoute, chainByDomain } from "@/lib/mainnet-bridge/cctp-routes";
import { bridgeDisabledResponse, irisRequest, json, readDomain } from "@/lib/mainnet-bridge/iris-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bridge/cctp/fees?sourceDomain=0&destinationDomain=26&forward=true
 * Proxies Circle's GET /v2/burn/USDC/fees/{source}/{destination}.
 */
export async function GET(request: Request) {
  const disabled = bridgeDisabledResponse();
  if (disabled) return disabled;

  const url = new URL(request.url);
  const sourceDomain = readDomain(url.searchParams.get("sourceDomain"));
  const destinationDomain = readDomain(url.searchParams.get("destinationDomain"));
  const forward = url.searchParams.get("forward") === "true";
  const source = sourceDomain === null ? undefined : chainByDomain(sourceDomain);
  const destination = destinationDomain === null ? undefined : chainByDomain(destinationDomain);
  if (!source || !destination || !isSupportedRoute(source.key, destination.key)) {
    return json({ error: "Unsupported CCTP route." }, 400);
  }

  const { status, body } = await irisRequest(
    `/v2/burn/USDC/fees/${source.domain}/${destination.domain}${forward ? "?forward=true" : ""}`,
    // Gas-based forwarding fees move quickly; protocol fees rarely change.
    { cacheMs: forward ? 10_000 : 60_000 },
  );
  if (status !== 200 || !isBurnFeeTiers(body)) {
    return json({ error: "Unable to load CCTP fees from Circle." }, status >= 500 ? status : 502);
  }
  return json({ tiers: body });
}
