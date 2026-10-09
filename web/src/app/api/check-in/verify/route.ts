import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  canCheckIn,
  parseCheckInCode,
  requireCheckInWindow,
  validateCheckInCode,
} from "@/lib/showup-checkin-server";
import {
  getEventDetails,
  getReservation,
  parseEventId,
  ShowUpApiError,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checks a check-in code (and optionally a wallet's reservation) without
 * sending a transaction. Used by the organizer panel and the attendee page.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      eventId?: unknown;
      code?: unknown;
      wallet?: unknown;
    };

    const eventId = parseEventId(body.eventId);
    const code = parseCheckInCode(eventId, body.code);
    const event = await getEventDetails(eventId);

    const wallet =
      typeof body.wallet === "string" && isAddress(body.wallet.trim())
        ? getAddress(body.wallet.trim())
        : undefined;

    await validateCheckInCode(code, event, { submitter: wallet });

    let reservationStatus: number | null = null;
    let eligible: boolean | null = null;

    if (wallet) {
      const reservation = await getReservation(eventId, wallet);
      reservationStatus = Number(reservation.status);
      eligible = canCheckIn(Number(event.eventType), reservationStatus);
    }

    let windowOpen = true;
    let windowMessage = "";
    try {
      requireCheckInWindow(event);
    } catch (error) {
      windowOpen = false;
      windowMessage = error instanceof Error ? error.message : "";
    }

    return NextResponse.json(
      {
        valid: true,
        windowOpen,
        windowMessage,
        expiry: code.expiry.toString(),
        personal: code.attendee !== "0x0000000000000000000000000000000000000000",
        reservationStatus,
        eligible,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof ShowUpApiError ? error.status : 500;
    return NextResponse.json(
      {
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify the check-in code.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
