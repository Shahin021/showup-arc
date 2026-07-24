import { NextResponse } from "next/server";
import {
  getEventDetails,
  getReservation,
  getReservationStatusLabel,
  getUsdcAccountState,
  parseAttendeeAddress,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function hasLockedReservation(
  status: number,
) {
  return (
    status === 1 ||
    status === 3 ||
    status === 4 ||
    status === 7 ||
    status === 8 ||
    status === 9
  );
}

export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const {
      id,
    } = await context.params;

    const eventId =
      parseEventId(id);

    const attendee =
      parseAttendeeAddress(
        new URL(
          request.url,
        ).searchParams.get(
          "attendee",
        ),
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
        attendee,
      ),

      getUsdcAccountState(
        attendee,
      ),
    ]);

    const status =
      Number(
        reservation.status,
      );

    const eventType =
      Number(
        eventDetails.eventType,
      );

    const isPaidEvent =
      eventType === 1;

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    const capacityAvailable =
      eventDetails.capacity ===
        BigInt(0) ||
      eventDetails.reservedSeats <
        eventDetails.capacity;

    const reservationReusable =
      status === 0 ||
      status === 2;

    const eventOpen =
      !eventDetails.cancelled &&
      now <
        eventDetails.eventStart;

    const baseReservationAvailable =
      eventOpen &&
      capacityAvailable &&
      reservationReusable;

    const canClaimCancelledEventRefund =
      eventDetails.cancelled &&
      status === 1;

    const canClaimFallbackRefund =
      !eventDetails.cancelled &&
      status === 1 &&
      now >
        eventDetails.resolutionDeadline;

    const enoughDepositBalance =
      accountState.balance >=
      eventDetails.depositAmount;

    const enoughDepositAllowance =
      accountState.allowance >=
      eventDetails.depositAmount;

    const upfrontReservationsOpen =
      !isPaidEvent ||
      (
        eventDetails.paymentDeadline >
          BigInt(0) &&
        now <=
          eventDetails.paymentDeadline
      );

    const canReserveUpfront =
      baseReservationAvailable &&
      upfrontReservationsOpen &&
      enoughDepositBalance;

    const fullPaymentAmount =
      isPaidEvent
        ? eventDetails.totalPrice
        : BigInt(0);

    const enoughFullPaymentBalance =
      accountState.balance >=
      fullPaymentAmount;

    const enoughFullPaymentAllowance =
      accountState.allowance >=
      fullPaymentAmount;

    const canReserveFullPayment =
      baseReservationAvailable &&
      isPaidEvent &&
      fullPaymentAmount >
        BigInt(0) &&
      enoughFullPaymentBalance;

    const remainingBalance =
      isPaidEvent &&
      eventDetails.totalPrice >
        eventDetails.depositAmount
        ? eventDetails.totalPrice -
          eventDetails.depositAmount
        : BigInt(0);

    const paymentDeadline =
      reservation.paymentDeadline;

    const paymentWindowOpen =
      isPaidEvent &&
      status === 7 &&
      !eventDetails.cancelled &&
      paymentDeadline >
        BigInt(0) &&
      now <= paymentDeadline;

    const paymentDeadlinePassed =
      isPaidEvent &&
      status === 7 &&
      paymentDeadline >
        BigInt(0) &&
      now > paymentDeadline;

    const enoughRemainingBalance =
      accountState.balance >=
      remainingBalance;

    const enoughRemainingAllowance =
      accountState.allowance >=
      remainingBalance;

    const canPayRemainingBalance =
      paymentWindowOpen &&
      remainingBalance >
        BigInt(0) &&
      enoughRemainingBalance;

    return NextResponse.json(
      {
        eventId:
          eventId.toString(),

        attendee,

        eventType,

        eventTypeLabel:
          isPaidEvent
            ? "Paid"
            : "Free",

        reservation: {
          status,

          label:
            getReservationStatusLabel(
              status,
            ),

          reservedAt:
            reservation.reservedAt.toString(),

          updatedAt:
            reservation.updatedAt.toString(),

          paymentDeadline:
            paymentDeadline.toString(),

          active:
            hasLockedReservation(
              status,
            ),

          paymentDue:
            status === 7,

          completed:
            status === 8,

          paymentDefaulted:
            status === 9,
        },

        deposit: {
          amount:
            eventDetails.depositAmount.toString(),

          formatted:
            serializeUsdc(
              eventDetails.depositAmount,
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

        remainingBalance: {
          amount:
            remainingBalance.toString(),

          formatted:
            serializeUsdc(
              remainingBalance,
            ),
        },

        usdc: {
          balance:
            accountState.balance.toString(),

          balanceFormatted:
            serializeUsdc(
              accountState.balance,
            ),

          allowance:
            accountState.allowance.toString(),

          allowanceFormatted:
            serializeUsdc(
              accountState.allowance,
            ),

          enoughBalance:
            enoughDepositBalance,

          enoughAllowance:
            enoughDepositAllowance,

          needsApproval:
            eventDetails.depositAmount >
              BigInt(0) &&
            !enoughDepositAllowance,
        },

        fullPayment: {
          amount:
            fullPaymentAmount.toString(),

          formatted:
            serializeUsdc(
              fullPaymentAmount,
            ),

          balance:
            accountState.balance.toString(),

          balanceFormatted:
            serializeUsdc(
              accountState.balance,
            ),

          allowance:
            accountState.allowance.toString(),

          allowanceFormatted:
            serializeUsdc(
              accountState.allowance,
            ),

          enoughBalance:
            enoughFullPaymentBalance,

          enoughAllowance:
            enoughFullPaymentAllowance,

          needsApproval:
            fullPaymentAmount >
              BigInt(0) &&
            !enoughFullPaymentAllowance,

          canReserve:
            canReserveFullPayment,
        },

        remainingPayment: {
          amount:
            remainingBalance.toString(),

          formatted:
            serializeUsdc(
              remainingBalance,
            ),

          paymentDeadline:
            paymentDeadline.toString(),

          paymentWindowOpen,

          paymentDeadlinePassed,

          balance:
            accountState.balance.toString(),

          balanceFormatted:
            serializeUsdc(
              accountState.balance,
            ),

          allowance:
            accountState.allowance.toString(),

          allowanceFormatted:
            serializeUsdc(
              accountState.allowance,
            ),

          enoughBalance:
            enoughRemainingBalance,

          enoughAllowance:
            enoughRemainingAllowance,

          needsApproval:
            remainingBalance >
              BigInt(0) &&
            !enoughRemainingAllowance,

          canPay:
            canPayRemainingBalance,
        },

        event: {
          open:
            eventOpen,

          cancelled:
            eventDetails.cancelled,

          eventType,

          eventTypeLabel:
            isPaidEvent
              ? "Paid"
              : "Free",

          capacityAvailable,

          capacity:
            eventDetails.capacity.toString(),

          reservedSeats:
            eventDetails.reservedSeats.toString(),

          eventStart:
            eventDetails.eventStart.toString(),

          eventEnd:
            eventDetails.eventEnd.toString(),

          resolutionDeadline:
            eventDetails.resolutionDeadline.toString(),

          paymentDeadline:
            eventDetails.paymentDeadline.toString(),

          upfrontReservationsOpen,

          canClaimCancelledEventRefund,

          canClaimFallbackRefund,
        },

        canReserveUpfront,

        canReserveFullPayment,

        canReserve:
          isPaidEvent
            ? canReserveUpfront ||
              canReserveFullPayment
            : canReserveUpfront,
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
      "ShowUp reservation-status request failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to check reservation status.",
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
