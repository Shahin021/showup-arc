import { NextResponse } from "next/server";
import {
  getEventDetails,
  getReservation,
  getReservationStatusLabel,
  getShowUpAddress,
  parseEventId,
  serializeUsdc,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";
import { arcPublicClient } from "@/lib/arc-public-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type AuthBody = {
  userToken?: unknown;
  walletId?: unknown;
};

type ExportAttendee = {
  attendee: `0x${string}`;
  status: number;
  label: string;

  reservedAt: string;
  updatedAt: string;
  paymentDeadline: string;

  active: boolean;
  attended: boolean;
  paymentDue: boolean;
  completed: boolean;
  paymentDefaulted: boolean;
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

const ADDRESS_BATCH_SIZE =
  BigInt(100);

const RESERVATION_CONCURRENCY =
  8;

function isActiveReservation(
  status: number,
) {
  return (
    status === 1 ||
    status === 7
  );
}

function isAttendanceConfirmed(
  status: number,
) {
  return (
    status === 3 ||
    status === 7 ||
    status === 8 ||
    status === 9
  );
}

async function readAttendeeAddresses(
  eventId: bigint,
  offset: bigint,
  limit: bigint,
) {
  return (await arcPublicClient.readContract({
    address:
      getShowUpAddress(),

    abi:
      ATTENDEE_READ_ABI,

    functionName:
      "getAttendees",

    args: [
      eventId,
      offset,
      limit,
    ],
  })) as `0x${string}`[];
}

async function readAllAttendeeAddresses(
  eventId: bigint,
  attendeeCount: bigint,
) {
  const addresses:
    `0x${string}`[] = [];

  for (
    let offset = BigInt(0);
    offset < attendeeCount;
    offset += ADDRESS_BATCH_SIZE
  ) {
    const remaining =
      attendeeCount - offset;

    const limit =
      remaining <
      ADDRESS_BATCH_SIZE
        ? remaining
        : ADDRESS_BATCH_SIZE;

    const batch =
      await readAttendeeAddresses(
        eventId,
        offset,
        limit,
      );

    addresses.push(
      ...batch,
    );

    if (
      batch.length <
      Number(limit)
    ) {
      break;
    }
  }

  return addresses;
}

async function mapWithConcurrency<
  TInput,
  TOutput,
>(
  items: TInput[],
  concurrency: number,
  mapper: (
    item: TInput,
  ) => Promise<TOutput>,
) {
  const results =
    new Array<TOutput>(
      items.length,
    );

  let nextIndex = 0;

  async function worker() {
    while (
      nextIndex <
      items.length
    ) {
      const currentIndex =
        nextIndex;

      nextIndex += 1;

      results[currentIndex] =
        await mapper(
          items[currentIndex],
        );
    }
  }

  const workerCount =
    Math.min(
      concurrency,
      items.length,
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () => worker(),
    ),
  );

  return results;
}

async function loadExportAttendees(
  eventId: bigint,
  addresses:
    `0x${string}`[],
) {
  return mapWithConcurrency(
    addresses,
    RESERVATION_CONCURRENCY,

    async (
      attendee,
    ): Promise<ExportAttendee> => {
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

        paymentDeadline:
          reservation.paymentDeadline.toString(),

        active:
          isActiveReservation(
            status,
          ),

        attended:
          isAttendanceConfirmed(
            status,
          ),

        paymentDue:
          status === 7,

        completed:
          status === 8,

        paymentDefaulted:
          status === 9,
      };
    },
  );
}

function csvCell(
  value:
    | string
    | number
    | boolean,
) {
  const text =
    String(value);

  if (
    /[",\n\r]/.test(
      text,
    )
  ) {
    return `"${text.replace(
      /"/g,
      '""',
    )}"`;
  }

  return text;
}

function timestampToIso(
  timestamp: string,
) {
  const seconds =
    Number(timestamp);

  if (
    !Number.isFinite(
      seconds,
    ) ||
    seconds <= 0
  ) {
    return "";
  }

  return new Date(
    seconds * 1000,
  ).toISOString();
}

function createCsv(
  input: {
    eventId: string;
    eventTitle: string;
    eventTypeLabel: string;
    organizer: string;

    depositFormatted: string;
    totalPriceFormatted: string;
    remainingBalanceFormatted: string;

    attendees:
      ExportAttendee[];
  },
) {
  const rows:
    Array<
      Array<
        | string
        | number
        | boolean
      >
    > = [
      [
        "Index",
        "Event ID",
        "Event Title",
        "Event Type",
        "Wallet Address",
        "Status",
        "Attendance Confirmed",
        "Payment Due",
        "Completed",
        "Payment Defaulted",
        "Reserved At (UTC)",
        "Updated At (UTC)",
        "Payment Deadline (UTC)",
        "Deposit / Upfront Payment (USDC)",
        "Total Price (USDC)",
        "Remaining Balance (USDC)",
        "Organizer Wallet",
      ],
    ];

  input.attendees.forEach(
    (
      attendee,
      index,
    ) => {
      rows.push([
        index + 1,
        input.eventId,
        input.eventTitle,
        input.eventTypeLabel,
        attendee.attendee,
        attendee.label,
        attendee.attended,
        attendee.paymentDue,
        attendee.completed,
        attendee.paymentDefaulted,

        timestampToIso(
          attendee.reservedAt,
        ),

        timestampToIso(
          attendee.updatedAt,
        ),

        timestampToIso(
          attendee.paymentDeadline,
        ),

        input.depositFormatted,
        input.totalPriceFormatted,
        input.remainingBalanceFormatted,
        input.organizer,
      ]);
    },
  );

  return `\uFEFF${rows
    .map(
      (row) =>
        row
          .map(csvCell)
          .join(","),
    )
    .join("\r\n")}`;
}

export async function POST(
  request: Request,
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

    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as AuthBody;

    const verifiedWallet =
      await verifyCircleArcWallet(
        body.userToken,
        body.walletId,
      );

    if (
      verifiedWallet.address.toLowerCase() !==
      eventDetails.organizer.toLowerCase()
    ) {
      throw new ShowUpApiError(
        "Only the organizer wallet can export attendee data.",
        403,
      );
    }

    const attendeeCount =
      await arcPublicClient.readContract({
        address:
          getShowUpAddress(),

        abi:
          ATTENDEE_READ_ABI,

        functionName:
          "getAttendeeCount",

        args: [
          eventId,
        ],
      });

    const addresses =
      await readAllAttendeeAddresses(
        eventId,
        attendeeCount,
      );

    const attendees =
      await loadExportAttendees(
        eventId,
        addresses,
      );

    const eventType =
      Number(
        eventDetails.eventType,
      );

    const eventTypeLabel =
      eventType === 1
        ? "Paid"
        : "Free";

    const remainingBalance =
      eventType === 1 &&
      eventDetails.totalPrice >
        eventDetails.depositAmount
        ? eventDetails.totalPrice -
          eventDetails.depositAmount
        : BigInt(0);

    const depositFormatted =
      serializeUsdc(
        eventDetails.depositAmount,
      );

    const totalPriceFormatted =
      serializeUsdc(
        eventDetails.totalPrice,
      );

    const remainingBalanceFormatted =
      serializeUsdc(
        remainingBalance,
      );

    const generatedAt =
      new Date().toISOString();

    const format =
      new URL(
        request.url,
      ).searchParams
        .get("format")
        ?.toLowerCase();

    if (
      format === "json"
    ) {
      return NextResponse.json(
        {
          generatedAt,

          event: {
            id:
              eventId.toString(),

            title:
              eventDetails.title,

            organizer:
              eventDetails.organizer,

            eventType,

            eventTypeLabel,

            deposit: {
              amount:
                eventDetails.depositAmount.toString(),

              formatted:
                depositFormatted,
            },

            totalPrice: {
              amount:
                eventDetails.totalPrice.toString(),

              formatted:
                totalPriceFormatted,
            },

            remainingBalance: {
              amount:
                remainingBalance.toString(),

              formatted:
                remainingBalanceFormatted,
            },

            timing: {
              eventStart:
                eventDetails.eventStart.toString(),

              eventEnd:
                eventDetails.eventEnd.toString(),

              resolutionDeadline:
                eventDetails.resolutionDeadline.toString(),
            },
          },

          attendeeCount:
            attendeeCount.toString(),

          attendees,
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

    const csv =
      createCsv({
        eventId:
          eventId.toString(),

        eventTitle:
          eventDetails.title,

        eventTypeLabel,

        organizer:
          eventDetails.organizer,

        depositFormatted,

        totalPriceFormatted,

        remainingBalanceFormatted,

        attendees,
      });

    const datePart =
      generatedAt.slice(
        0,
        10,
      );

    const filename =
      `showup-event-${eventId.toString()}-attendees-${datePart}.csv`;

    return new Response(
      csv,
      {
        status: 200,

        headers: {
          "Content-Type":
            "text/csv; charset=utf-8",

          "Content-Disposition":
            `attachment; filename="${filename}"`,

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
      "ShowUp attendee export failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to export event attendees.",
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
