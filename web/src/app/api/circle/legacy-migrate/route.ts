import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { NextResponse, type NextRequest } from "next/server";

import { setCircleUserCookie } from "@/lib/circle-user-binding";
import { SHOWUP_NETWORK } from "@/lib/showup-network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time migration for browsers that used the earlier testnet site, where
 * a Circle user ID in localStorage was the only credential. It binds that
 * ID to this browser with the new signed cookie, so existing testnet users
 * keep their wallets after the upgrade.
 *
 * Accepting a bare ID is exactly the weakness the cookie removes, so this
 * route only exists on testnet, only while SHOWUP_LEGACY_MIGRATION_UNTIL
 * (an ISO date) is in the future, and never on mainnet, which uses a new
 * production Circle app with no legacy users.
 */
function migrationOpen() {
  if (SHOWUP_NETWORK !== "testnet") {
    return false;
  }
  const until = Date.parse(process.env.SHOWUP_LEGACY_MIGRATION_UNTIL ?? "");
  return Number.isFinite(until) && Date.now() < until;
}

export async function POST(request: NextRequest) {
  if (!migrationOpen()) {
    return NextResponse.json(
      { error: "Legacy wallet migration is closed." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!/^[a-zA-Z0-9_-]{5,50}$/.test(userId)) {
    return NextResponse.json(
      { error: "Invalid Circle user ID." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CIRCLE_API_KEY is not configured." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    // Only IDs of real users of this Circle app can be migrated.
    await initiateUserControlledWalletsClient({ apiKey }).getUser({ userId });
  } catch {
    return NextResponse.json(
      { error: "Unknown Circle user." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { migrated: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  setCircleUserCookie(response, request, userId);
  return response;
}
