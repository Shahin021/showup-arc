import { bridgeDisabledResponse, irisRequest, json } from "@/lib/mainnet-bridge/iris-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bridge/cctp/reattest { nonce }
 * Proxies Circle's POST /v2/reattest/{nonce} for an expired Fast Transfer
 * attestation. Re-attestation never burns again; it only re-signs the
 * existing burn message.
 */
export async function POST(request: Request) {
  const disabled = bridgeDisabledResponse();
  if (disabled) return disabled;

  const body = (await request.json().catch(() => ({}))) as { nonce?: unknown };
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    return json({ error: "A valid CCTP nonce is required." }, 400);
  }

  const { status, body: upstream } = await irisRequest(`/v2/reattest/${nonce.toLowerCase()}`, { method: "POST" });
  if (status < 200 || status >= 300) {
    return json(
      { error: (upstream as { message?: string; error?: string })?.message ?? "Circle could not re-attest this transfer." },
      status === 404 || status === 400 ? status : 502,
    );
  }
  return json({ ok: true });
}
