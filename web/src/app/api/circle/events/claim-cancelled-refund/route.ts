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

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as ClaimCancelledRefundRequest;

    const eventId =
      parseEventId(
        body.eventId,
      );

    const wallet =
      await verifyCircleArcWallet(
        body.userToken,
        body.walletId,
      );

    const [
      eventDetails,
      reservation,
    ] = await Promise.all([
      getEventDetails(
        eventId,
      ),
      getReservation(
        eventId,
        wallet.address,
      ),
    ]);

    if (
      !eventDetails.cancelled
    ) {
      throw new ShowUpApiError(
        "This event has not been cancelled.",
      );
    }

    const eventType =
      Number(
        eventDetails.eventType,
      );

    const reservationStatus =
      Number(
        reservation.status,
      );

    const isFreeEventRefund =
      eventType === 0 &&
      reservationStatus === 1;

    const isPaidDepositRefund =
      eventType === 1 &&
      reservationStatus === 7;

    const isPaidFullRefund =
      eventType === 1 &&
      reservationStatus === 8;

    const canClaimRefund =
      isFreeEventRefund ||
      isPaidDepositRefund ||
      isPaidFullRefund;

    if (
      !canClaimRefund
    ) {
      throw new ShowUpApiError(
        "This wallet does not have an active reservation refund to claim.",
      );
    }

    const refundAmount =
      isPaidFullRefund
        ? eventDetails.totalPrice
        : eventDetails.depositAmount;

    const challenge =
      await createCircleChallenge({
        userToken:
          wallet.userToken,

        walletId:
          wallet.walletId,

        contractAddress:
          getShowUpAddress(),

        abiFunctionSignature:
          "claimCancelledEventRefund(uint256)",

        abiParameters: [
          eventId.toString(),
        ],

        refPrefix:
          `showup-cancelrefund-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,

        eventId:
          eventId.toString(),

        attendee:
          wallet.address,

        refundAmount:
          refundAmount.toString(),

        refundFormatted:
          serializeUsdc(
            refundAmount,
          ),

        depositAmount:
          eventDetails.depositAmount.toString(),

        depositFormatted:
          serializeUsdc(
            eventDetails.depositAmount,
          ),
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store",
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
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}
