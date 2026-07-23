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

type ApproveRemainingBalanceRequest = {
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
        )) as ApproveRemainingBalanceRequest;

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
      accountState.allowance >=
      remainingBalance
    ) {
      return NextResponse.json(
        {
          alreadyApproved: true,

          eventId:
            eventId.toString(),

          remainingBalance: {
            amount:
              remainingBalance.toString(),

            formatted:
              serializeUsdc(
                remainingBalance,
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
          remainingBalance.toString(),
        ],

        refPrefix:
          `showup-approve-remaining-${eventId.toString()}`,
      });

    return NextResponse.json(
      {
        ...challenge,

        alreadyApproved: false,

        eventId:
          eventId.toString(),

        remainingBalance: {
          amount:
            remainingBalance.toString(),

          formatted:
            serializeUsdc(
              remainingBalance,
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
      "ShowUp remaining-balance approval failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare the remaining-balance approval.",
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
