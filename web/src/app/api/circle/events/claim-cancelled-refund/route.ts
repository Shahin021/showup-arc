import { NextResponse } from "next/server";
import {
  createCircleChallenge,
  getEventDetails,
  getReservation,
  getShowUpAddress,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimCancelledRefundRequest = {
  userToken?: unknown;
  walletId?: unknown;
  eventId?: unknown;
};

export async function POST(request: Request) {
  try {
    const body =
      (await request.json().catch(() => ({}))) as ClaimCancelledRefundRequest;

    const eventId = parseEventId(body.eventId);

    const wallet = await verifyCircleArcWallet(
      body.userToken,
      body.walletId,
    );

    const [eventDetails, reservation] = await Promise.all([
      getEventDetails(eventId),
      getReservation(eventId, wallet.address),
    ]);

    if (!eventDetails.cancelled) {
      throw new ShowUpApiError(
        "This event has not been cancelled.",
      );
    }

    if (Number(reservation.status) !== 1) {
      throw new ShowUpApiError(
        "This wallet does not have an active reservation refund to claim.",
      );
    }

    const challenge = await createCircleChallenge({
      userToken: wallet.userToken,
      walletId: wallet.walletId,
      contractAddress: getShowUpAddress(),
      abiFunctionSignature: "claimCancelledEventRefund(uint256)",
      abiParameters: [eventId.toString()],
      refPrefix:
        `showup-cancelrefund-${eventId.toString()}`,
    });

    return NextResponse.json(
      {
        ...challenge,
        eventId: eventId.toString(),
        attendee: wallet.address,
        depositAmount: eventDetails.depositAmount.toString(),
        depositFormatted: serializeUsdc(eventDetails.depositAmount),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof ShowUpApiError
        ? error.status
        : 500;

    console.error(
      "ShowUp cancelled-event refund challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the cancelled-event refund.",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
