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

type ApproveFullPaymentRequest = {
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
        )) as ApproveFullPaymentRequest;

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
      accountState.allowance >=
      eventDetails.totalPrice
    ) {
      return NextResponse.json(
        {
          alreadyApproved: true,
          approvedAmount:
            eventDetails.totalPrice.toString(),
          approvedAmountFormatted:
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
          eventDetails.totalPrice.toString(),
        ],
        refPrefix:
          `showup-approve-full-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,
        alreadyApproved: false,
        approvedAmount:
          eventDetails.totalPrice.toString(),
        approvedAmountFormatted:
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
      "ShowUp full-payment approval failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the full-payment approval.",
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
