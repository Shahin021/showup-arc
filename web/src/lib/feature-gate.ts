import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/showup-network";

/**
 * The Sepolia <-> Arc Testnet bridge and the testnet swap are testnet-only
 * wallet utilities. On mainnet their routes are not served at all.
 */
export function testnetToolsDisabledResponse() {
  if (FEATURES.testnetBridgeAndSwap) {
    return null;
  }

  return NextResponse.json(
    { error: "This wallet tool is only available on Arc Testnet." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
