import { NextResponse } from "next/server";

import {
  canCheckIn,
  parseCheckInCode,
  requireCheckInWindow,
  validateCheckInCode,
} from "@/lib/showup-checkin-server";
import {
  createCircleChallenge,
  getEventDetails,
  getReservation,
  getShowUpAddress,
  parseEventId,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prepares the attendee's checkIn transaction for Circle PIN approval. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      userToken?: unknown;
      walletId?: unknown;
      eventId?: unknown;
      code?: unknown;
    };

    const eventId = parseEventId(body.eventId);
    const wallet = await verifyCircleArcWallet(body.userToken, body.walletId);
    const code = parseCheckInCode(eventId, body.code);

    const [event, reservation] = await Promise.all([
      getEventDetails(eventId),
      getReservation(eventId, wallet.address),
    ]);

    requireCheckInWindow(event);
    await validateCheckInCode(code, event, { submitter: wallet.address });

    if (!canCheckIn(Number(event.eventType), Number(reservation.status))) {
      throw new ShowUpApiError(
        Number(event.eventType) === 1
          ? "This wallet does not have a fully paid reservation to check in."
          : "This wallet does not have an active reservation to check in.",
      );
    }

    const challenge = await createCircleChallenge({
      userToken: wallet.userToken,
      walletId: wallet.walletId,
      contractAddress: getShowUpAddress(),
      abiFunctionSignature: "checkIn(uint256,address,uint64,uint64,bytes)",
      abiParameters: [
        eventId.toString(),
        code.attendee,
        code.issuedAt.toString(),
        code.expiry.toString(),
        code.signature,
      ],
      refPrefix: `showup-checkin-${eventId.toString()}`,
    });

    return NextResponse.json(
      { ...challenge, eventId: eventId.toString(), attendee: wallet.address },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof ShowUpApiError ? error.status : 500;
    console.error("ShowUp check-in challenge failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the check-in.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
