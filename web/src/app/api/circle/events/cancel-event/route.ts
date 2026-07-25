import { NextResponse } from "next/server";
import {
  createCircleChallenge,
  getEventDetails,
  getShowUpAddress,
  parseEventId,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelEventRequest = {
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
        )) as CancelEventRequest;

    const eventId =
      parseEventId(
        body.eventId,
      );

    const wallet =
      await verifyCircleArcWallet(
        body.userToken,
        body.walletId,
      );

    const eventDetails =
      await getEventDetails(
        eventId,
      );

    if (
      wallet.address.toLowerCase() !==
      eventDetails.organizer.toLowerCase()
    ) {
      throw new ShowUpApiError(
        "Only the event organizer can cancel this event.",
        403,
      );
    }

    if (
      eventDetails.cancelled
    ) {
      throw new ShowUpApiError(
        "This event has already been cancelled.",
      );
    }

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (
      now >=
      eventDetails.eventStart
    ) {
      throw new ShowUpApiError(
        "The event cannot be cancelled after it has started.",
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
          "cancelEvent(uint256)",
        abiParameters: [
          eventId.toString(),
        ],
        refPrefix:
          `showup-cancel-event-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,
        eventId:
          eventId.toString(),
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
      "ShowUp event cancellation challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare event cancellation.",
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
