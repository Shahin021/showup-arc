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

type SettleNoShowRequest = {
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
        .catch(
          () => ({}),
        )) as SettleNoShowRequest;

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
        "Only the event organizer can settle a no-show.",
        403,
      );
    }

    if (
      eventDetails.cancelled
    ) {
      throw new ShowUpApiError(
        "No-show settlement is unavailable for a cancelled event.",
      );
    }

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (
      now <
        eventDetails.eventEnd ||
      now >
        eventDetails.resolutionDeadline
    ) {
      throw new ShowUpApiError(
        "The no-show settlement window is closed.",
      );
    }

    if (
      Number(
        reservation.status,
      ) !== 1
    ) {
      throw new ShowUpApiError(
        "This attendee does not have an active reservation.",
      );
    }

    const challenge =
      await createCircleChallenge({
        userToken:
          wallet.userToken,
        walletId:
          wallet.walletId,
        contractAddress:
          getShowUpAddress(),
        abiFunctionSignature:
          "settleNoShow(uint256,address)",
        abiParameters: [
          eventId.toString(),
          attendee,
        ],
        refPrefix:
          `showup-settle-no-show-${eventId.toString()}-${attendee.toLowerCase()}`,
      });

    return NextResponse.json(
      {
        ...challenge,

        eventId:
          eventId.toString(),

        attendee,

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
      "ShowUp no-show settlement challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare no-show settlement.",
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
