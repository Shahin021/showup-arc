import { NextResponse } from "next/server";
import {
  createCircleChallenge,
  getEventDetails,
  getReservation,
  getShowUpAddress,
  getUsdcAccountState,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReserveFullRequest = {
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
        )) as ReserveFullRequest;

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
      getEventDetails(
        eventId,
      ),

      getReservation(
        eventId,
        wallet.address,
      ),

      getUsdcAccountState(
        wallet.address,
      ),
    ]);

    if (
      Number(
        eventDetails.eventType,
      ) !== 1
    ) {
      throw new ShowUpApiError(
        "Full payment only applies to paid events.",
      );
    }

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
      eventDetails.totalPrice <=
      BigInt(0)
    ) {
      throw new ShowUpApiError(
        "This paid event does not have a valid total price.",
        500,
      );
    }

    if (
      accountState.balance <
      eventDetails.totalPrice
    ) {
      throw new ShowUpApiError(
        `Insufficient USDC balance. Full payment requires ${serializeUsdc(
          eventDetails.totalPrice,
        )} USDC.`,
      );
    }

    if (
      accountState.allowance <
      eventDetails.totalPrice
    ) {
      throw new ShowUpApiError(
        "Approve the full event price before reserving the seat.",
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
          "reserveSeatAndPayFull(uint256)",
        abiParameters: [
          eventId.toString(),
        ],
        refPrefix:
          `showup-reserve-full-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,
        eventId:
          eventId.toString(),
        totalPrice:
          eventDetails.totalPrice.toString(),
        totalPriceFormatted:
          serializeUsdc(
            eventDetails.totalPrice,
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
      "ShowUp full-payment reservation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the full-payment reservation.",
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
