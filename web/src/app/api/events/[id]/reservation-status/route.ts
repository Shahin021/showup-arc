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
      getEventDetails(eventId),
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

    const canClaimCancelledEventRefund =
      eventDetails.cancelled &&
      status === 1;

    const canClaimFallbackRefund =
      !eventDetails.cancelled &&
      status === 1 &&
      now >
        eventDetails.resolutionDeadline;

    const enoughBalance =
      accountState.balance >=
      eventDetails.depositAmount;

    const enoughAllowance =
      accountState.allowance >=
      eventDetails.depositAmount;

    return NextResponse.json(
      {
        eventId:
          eventId.toString(),
        attendee,

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
          active:
            status === 1,
        },

        deposit: {
          amount:
            eventDetails.depositAmount.toString(),
          formatted:
            serializeUsdc(
              eventDetails.depositAmount,
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
          enoughBalance,
          enoughAllowance,
          needsApproval:
            !enoughAllowance,
        },

        event: {
          open:
            eventOpen,
          cancelled:
            eventDetails.cancelled,
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
          canClaimCancelledEventRefund,
          canClaimFallbackRefund,
        },

        canReserve:
          eventOpen &&
          capacityAvailable &&
          reservationReusable &&
          enoughBalance,
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
