import { NextResponse } from "next/server";
import {
  createCircleChallenge,
  getEventDetails,
  getReservation,
  getShowUpAddress,
  parseAttendeeAddress,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarkPaymentDefaultRequest = {
  userToken?: unknown;
  walletId?: unknown;
  eventId?: unknown;
  attendee?: unknown;
};

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as MarkPaymentDefaultRequest;

    const eventId =
      parseEventId(
        body.eventId,
      );

    const attendee =
      parseAttendeeAddress(
        body.attendee,
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
        attendee,
      ),
    ]);

    if (
      wallet.address.toLowerCase() !==
      eventDetails.organizer.toLowerCase()
    ) {
      throw new ShowUpApiError(
        "Only the event organizer can mark a payment default.",
        403,
      );
    }

    if (
      eventDetails.cancelled
    ) {
      throw new ShowUpApiError(
        "Payment default is unavailable for a cancelled event.",
      );
    }

    if (
      Number(
        eventDetails.eventType,
      ) !== 1
    ) {
      throw new ShowUpApiError(
        "Payment default only applies to paid events.",
      );
    }

    if (
      Number(
        reservation.status,
      ) !== 7
    ) {
      throw new ShowUpApiError(
        "This attendee does not currently have a payment due.",
      );
    }

    const paymentDeadline =
      reservation.paymentDeadline;

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (
      paymentDeadline === BigInt(0) ||
      now <= paymentDeadline
    ) {
      throw new ShowUpApiError(
        "The attendee's payment deadline has not passed yet.",
      );
    }

    const remainingBalance =
      eventDetails.totalPrice >
      eventDetails.depositAmount
        ? eventDetails.totalPrice -
          eventDetails.depositAmount
        : BigInt(0);

    const challenge =
      await createCircleChallenge({
        userToken:
          wallet.userToken,
        walletId:
          wallet.walletId,
        contractAddress:
          getShowUpAddress(),
        abiFunctionSignature:
          "markPaymentDefault(uint256,address)",
        abiParameters: [
          eventId.toString(),
          attendee,
        ],
        refPrefix:
          `showup-payment-default-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,

        eventId:
          eventId.toString(),

        attendee,

        paymentDeadline:
          paymentDeadline.toString(),

        upfrontPayment: {
          amount:
            eventDetails.depositAmount.toString(),

          formatted:
            serializeUsdc(
              eventDetails.depositAmount,
            ),
        },

        remainingBalance: {
          amount:
            remainingBalance.toString(),

          formatted:
            serializeUsdc(
              remainingBalance,
            ),
        },
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
      "ShowUp payment-default challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the payment-default transaction.",
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
