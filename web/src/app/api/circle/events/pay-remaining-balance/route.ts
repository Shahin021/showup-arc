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

type PayRemainingBalanceRequest = {
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
        )) as PayRemainingBalanceRequest;

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
      eventDetails.cancelled
    ) {
      throw new ShowUpApiError(
        "The remaining balance cannot be paid for a cancelled event.",
      );
    }

    if (
      Number(
        eventDetails.eventType,
      ) !== 1
    ) {
      throw new ShowUpApiError(
        "Remaining-balance payment only applies to paid events.",
      );
    }

    if (
      Number(
        reservation.status,
      ) !== 7
    ) {
      throw new ShowUpApiError(
        "This reservation does not currently have a remaining payment due.",
      );
    }

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (
      reservation.paymentDeadline ===
        BigInt(0) ||
      now >
        reservation.paymentDeadline
    ) {
      throw new ShowUpApiError(
        "The remaining-payment window has closed.",
      );
    }

    if (
      eventDetails.totalPrice <=
      eventDetails.depositAmount
    ) {
      throw new ShowUpApiError(
        "The event does not have a valid remaining balance.",
        500,
      );
    }

    const remainingBalance =
      eventDetails.totalPrice -
      eventDetails.depositAmount;

    if (
      accountState.balance <
      remainingBalance
    ) {
      throw new ShowUpApiError(
        `Insufficient USDC balance. The remaining payment is ${serializeUsdc(
          remainingBalance,
        )} USDC.`,
      );
    }

    if (
      accountState.allowance <
      remainingBalance
    ) {
      throw new ShowUpApiError(
        "Approve the remaining USDC balance before completing the payment.",
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
          "payRemainingBalance(uint256)",

        abiParameters: [
          eventId.toString(),
        ],

        refPrefix:
          `showup-pay-remaining-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,

        eventId:
          eventId.toString(),

        attendee:
          wallet.address,

        remainingBalance: {
          amount:
            remainingBalance.toString(),

          formatted:
            serializeUsdc(
              remainingBalance,
            ),
        },

        totalPrice: {
          amount:
            eventDetails.totalPrice.toString(),

          formatted:
            serializeUsdc(
              eventDetails.totalPrice,
            ),
        },

        paymentDeadline:
          reservation.paymentDeadline.toString(),
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
      "ShowUp remaining-balance payment failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the remaining-balance payment.",
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
