import { NextResponse } from "next/server";
import {
  createCircleChallenge,
  getEventDetails,
  getReservation,
  getShowUpAddress,
  getUsdcAccountState,
  getUsdcAddress,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApproveRequest = {
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
        )) as ApproveRequest;

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
      accountState,
    ] = await Promise.all([
      getEventDetails(eventId),
      getReservation(
        eventId,
        wallet.address,
      ),
      getUsdcAccountState(
        wallet.address,
      ),
    ]);

    const reservationStatus =
      Number(
        reservation.status,
      );

    if (
      reservationStatus !== 0 &&
      reservationStatus !== 2
    ) {
      throw new ShowUpApiError(
        "This wallet already has a non-cancelled reservation for the event.",
      );
    }

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (
      eventDetails.cancelled ||
      now >=
        eventDetails.eventStart
    ) {
      throw new ShowUpApiError(
        "Reservations are closed for this event.",
      );
    }

    if (
      eventDetails.capacity !==
        BigInt(0) &&
      eventDetails.reservedSeats >=
        eventDetails.capacity
    ) {
      throw new ShowUpApiError(
        "This event has reached capacity.",
      );
    }

    if (
      accountState.balance <
      eventDetails.depositAmount
    ) {
      throw new ShowUpApiError(
        `Insufficient USDC balance. This reservation requires ${serializeUsdc(
          eventDetails.depositAmount,
        )} USDC.`,
      );
    }

    if (
      accountState.allowance >=
      eventDetails.depositAmount
    ) {
      return NextResponse.json(
        {
          alreadyApproved: true,
          approvedAmount:
            eventDetails.depositAmount.toString(),
          approvedAmountFormatted:
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
    }

    const challenge =
      await createCircleChallenge({
        userToken:
          wallet.userToken,
        walletId:
          wallet.walletId,
        contractAddress:
          getUsdcAddress(),
        abiFunctionSignature:
          "approve(address,uint256)",
        abiParameters: [
          getShowUpAddress(),
          eventDetails.depositAmount.toString(),
        ],
        refPrefix:
          `showup-approve-event-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,
        alreadyApproved: false,
        approvedAmount:
          eventDetails.depositAmount.toString(),
        approvedAmountFormatted:
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
      "ShowUp USDC approval challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare USDC approval.",
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
