import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  createCheckInWindow,
  getCircleCheckInTypedData,
  ZERO_ADDRESS,
} from "@/lib/showup-checkin";
import {
  getEventDetails,
  parseEventId,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long before the start an organizer may prepare a code. */
const PREPARE_BEFORE_START_SECONDS = BigInt(30 * 60);

/**
 * Creates a Circle signature challenge for a check-in code. The organizer
 * confirms it with their PIN; the browser then receives the signature.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      userToken?: unknown;
      walletId?: unknown;
      eventId?: unknown;
      attendee?: unknown;
    };

    const eventId = parseEventId(body.eventId);
    const wallet = await verifyCircleArcWallet(body.userToken, body.walletId);
    const event = await getEventDetails(eventId);

    if (event.organizer.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new ShowUpApiError(
        "Only the event organizer can create check-in codes.",
        403,
      );
    }

    if (event.cancelled) {
      throw new ShowUpApiError("This event was cancelled.");
    }

    const now = BigInt(Math.floor(Date.now() / 1000));

    if (now + PREPARE_BEFORE_START_SECONDS < event.eventStart) {
      throw new ShowUpApiError(
        "Check-in codes can be created from 30 minutes before the start.",
      );
    }

    if (now >= event.eventEnd) {
      throw new ShowUpApiError("The event has ended; check-in is closed.");
    }

    const attendeeInput =
      typeof body.attendee === "string" ? body.attendee.trim() : "";
    if (attendeeInput && !isAddress(attendeeInput)) {
      throw new ShowUpApiError("The attendee wallet address is invalid.");
    }
    const attendee = attendeeInput ? getAddress(attendeeInput) : ZERO_ADDRESS;

    const { issuedAt, expiry } = createCheckInWindow(now, event.eventEnd);
    const payload = { eventId, attendee, issuedAt, expiry };

    const apiKey = process.env.CIRCLE_API_KEY;
    if (!apiKey) {
      throw new ShowUpApiError("CIRCLE_API_KEY is not configured.", 500);
    }

    const circleResponse = await initiateUserControlledWalletsClient({
      apiKey,
    }).signTypedData({
      userToken: wallet.userToken,
      walletId: wallet.walletId,
      data: JSON.stringify(getCircleCheckInTypedData(payload)),
    });

    const challengeId = (
      circleResponse.data as { challengeId?: string } | undefined
    )?.challengeId;

    if (!challengeId) {
      throw new ShowUpApiError(
        "Circle did not return a signature challenge.",
        502,
      );
    }

    return NextResponse.json(
      {
        challengeId,
        code: {
          attendee,
          issuedAt: issuedAt.toString(),
          expiry: expiry.toString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof ShowUpApiError ? error.status : 500;
    console.error("ShowUp check-in code challenge failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the check-in code.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
