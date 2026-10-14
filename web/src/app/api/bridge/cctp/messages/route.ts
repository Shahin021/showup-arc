import { bridgeDisabledResponse, irisRequest, isTxHash, json, readDomain } from "@/lib/mainnet-bridge/iris-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bridge/cctp/messages?sourceDomain=26&transactionHash=0x...
 * Proxies Circle's GET /v2/messages/{sourceDomain}. The client validates the
 * returned message against its own transfer record before using it.
 */
export async function GET(request: Request) {
  const disabled = bridgeDisabledResponse();
  if (disabled) return disabled;

  const url = new URL(request.url);
  const sourceDomain = readDomain(url.searchParams.get("sourceDomain"));
  const transactionHash = url.searchParams.get("transactionHash");
  if (sourceDomain === null || !isTxHash(transactionHash)) {
    return json({ error: "A supported source domain and a transaction hash are required." }, 400);
  }

  const { status, body } = await irisRequest(
    `/v2/messages/${sourceDomain}?transactionHash=${transactionHash.toLowerCase()}`,
    { cacheMs: 4_000 },
  );
  if (status === 404) {
    return json({ error: "Circle has not indexed this burn yet." }, 404);
  }
  if (status !== 200) {
    return json(
      { error: (body as { error?: string })?.error ?? "Circle's attestation service returned an error." },
      status >= 500 ? status : 502,
    );
  }
  return json(body);
}
