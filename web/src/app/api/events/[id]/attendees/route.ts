import { NextResponse } from "next/server";
import {
  getEventDetails,
  getReservation,
  getReservationStatusLabel,
  getShowUpAddress,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
} from "@/lib/showup-server";
import { arcPublicClient } from "@/lib/arc-public-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const ATTENDEE_READ_ABI = [
  {
    type: "function",
    name: "getAttendeeCount",
    stateMutability: "view",
    inputs: [
      {
        name: "eventId",
        type: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "getAttendees",
    stateMutability: "view",
    inputs: [
      {
        name: "eventId",
        type: "uint256",
      },
      {
        name: "offset",
        type: "uint256",
      },
      {
        name: "limit",
        type: "uint256",
      },
    ],
    outputs: [
      {
        name: "attendees",
        type: "address[]",
      },
    ],
  },
] as const;

const PAGE_SIZE = BigInt(50);
const MAX_PAGES = 20;

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    const {
      id,
    } = await context.params;

    const eventId =
      parseEventId(id);

    const eventDetails =
      await getEventDetails(
        eventId,
      );

    const attendeeCount =
      await arcPublicClient.readContract({
        address:
          getShowUpAddress(),
        abi:
          ATTENDEE_READ_ABI,
        functionName:
          "getAttendeeCount",
        args: [eventId],
      });

    const addresses:
      `0x${string}`[] = [];

    for (
      let page = 0;
      page < MAX_PAGES;
      page += 1
    ) {
      const offset =
        BigInt(page) *
        PAGE_SIZE;

      if (
        offset >=
        attendeeCount
      ) {
        break;
      }

      const pageAddresses =
        await arcPublicClient.readContract({
          address:
            getShowUpAddress(),
          abi:
            ATTENDEE_READ_ABI,
          functionName:
            "getAttendees",
          args: [
            eventId,
            offset,
            PAGE_SIZE,
          ],
        });

      addresses.push(
        ...pageAddresses,
      );

      if (
        pageAddresses.length <
        Number(PAGE_SIZE)
      ) {
        break;
      }
    }

    const reservations =
      await Promise.all(
        addresses.map(
          async (
            attendee,
          ) => {
            const reservation =
              await getReservation(
                eventId,
                attendee,
              );

            const status =
              Number(
                reservation.status,
              );

            return {
              attendee,
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
              attended:
                status === 3,
            };
          },
        ),
      );

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    const attendanceWindowOpen =
      !eventDetails.cancelled &&
      now >=
        eventDetails.eventStart &&
      now <=
        eventDetails.resolutionDeadline;

    return NextResponse.json(
      {
        eventId:
          eventId.toString(),

        organizer:
          eventDetails.organizer,

        deposit: {
          amount:
            eventDetails.depositAmount.toString(),
          formatted:
            serializeUsdc(
              eventDetails.depositAmount,
            ),
        },

        timing: {
          eventStart:
            eventDetails.eventStart.toString(),
          eventEnd:
            eventDetails.eventEnd.toString(),
          resolutionDeadline:
            eventDetails.resolutionDeadline.toString(),
          attendanceWindowOpen,
        },

        attendeeCount:
          attendeeCount.toString(),

        attendees:
          reservations,
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
      "ShowUp attendee list failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load event attendees.",
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
