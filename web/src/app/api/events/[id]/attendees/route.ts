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

type ReservationRow = {
  attendee: `0x${string}`;
  status: number;
  label: string;
  reservedAt: string;
  updatedAt: string;
  active: boolean;
  attended: boolean;
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

const PAGE_SIZE = 20;
const ADDRESS_BATCH_SIZE = BigInt(100);
const RESERVATION_CONCURRENCY = 8;

const STATUS_FILTERS: Record<string, number | null> = {
  all: null,
  reserved: 1,
  cancelled: 2,
  attended: 3,
  "no-show": 4,
  "fallback-refunded": 5,
  "event-cancelled-refunded": 6,
};

function parsePage(value: string | null) {
  if (!value) {
    return 1;
  }

  if (!/^\d+$/.test(value)) {
    throw new ShowUpApiError("Page number is invalid.");
  }

  return Math.max(1, Number.parseInt(value, 10));
}

function parseSearch(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (normalized.length > 42) {
    throw new ShowUpApiError("Wallet search is too long.");
  }

  return normalized;
}

function parseStatusFilter(value: string | null) {
  const normalized = value?.trim().toLowerCase() || "all";

  if (!(normalized in STATUS_FILTERS)) {
    throw new ShowUpApiError("Attendance status filter is invalid.");
  }

  return {
    key: normalized,
    status: STATUS_FILTERS[normalized],
  };
}

async function readAttendeeAddresses(
  eventId: bigint,
  offset: bigint,
  limit: bigint,
) {
  return (await arcPublicClient.readContract({
    address: getShowUpAddress(),
    abi: ATTENDEE_READ_ABI,
    functionName: "getAttendees",
    args: [eventId, offset, limit],
  })) as `0x${string}`[];
}

async function readAllAttendeeAddresses(eventId: bigint, attendeeCount: bigint) {
  const addresses: `0x${string}`[] = [];

  for (let offset = BigInt(0); offset < attendeeCount; offset += ADDRESS_BATCH_SIZE) {
    const remaining = attendeeCount - offset;
    const limit = remaining < ADDRESS_BATCH_SIZE ? remaining : ADDRESS_BATCH_SIZE;
    const batch = await readAttendeeAddresses(eventId, offset, limit);

    addresses.push(...batch);

    if (batch.length < Number(limit)) {
      break;
    }
  }

  return addresses;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function loadReservationRows(eventId: bigint, addresses: `0x${string}`[]) {
  return mapWithConcurrency(
    addresses,
    RESERVATION_CONCURRENCY,
    async (attendee): Promise<ReservationRow> => {
      const reservation = await getReservation(eventId, attendee);
      const status = Number(reservation.status);

      return {
        attendee,
        status,
        label: getReservationStatusLabel(status),
        reservedAt: reservation.reservedAt.toString(),
        updatedAt: reservation.updatedAt.toString(),
        active: status === 1,
        attended: status === 3,
      };
    },
  );
}

function calculateTotalPages(total: bigint) {
  if (total === BigInt(0)) {
    return 1;
  }

  return Number((total + BigInt(PAGE_SIZE - 1)) / BigInt(PAGE_SIZE));
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const eventId = parseEventId(id);
    const eventDetails = await getEventDetails(eventId);
    const body = (await request.json().catch(() => ({}))) as AuthBody;
    const verifiedWallet = await verifyCircleArcWallet(
      body.userToken,
      body.walletId,
    );

    if (
      verifiedWallet.address.toLowerCase() !==
      eventDetails.organizer.toLowerCase()
    ) {
      throw new ShowUpApiError(
        "Only the organizer wallet can view the attendee list.",
        403,
      );
    }

    const url = new URL(request.url);
    const requestedPage = parsePage(url.searchParams.get("page"));
    const search = parseSearch(url.searchParams.get("search"));
    const statusFilter = parseStatusFilter(url.searchParams.get("status"));

    const attendeeCount = await arcPublicClient.readContract({
      address: getShowUpAddress(),
      abi: ATTENDEE_READ_ABI,
      functionName: "getAttendeeCount",
      args: [eventId],
    });

    let rows: ReservationRow[] = [];
    let filteredCount = attendeeCount;
    let page = requestedPage;
    let totalPages = calculateTotalPages(attendeeCount);

    if (!search && statusFilter.status === null) {
      page = Math.min(requestedPage, totalPages);
      const offset = BigInt((page - 1) * PAGE_SIZE);
      const addresses =
        offset < attendeeCount
          ? await readAttendeeAddresses(eventId, offset, BigInt(PAGE_SIZE))
          : [];

      rows = await loadReservationRows(eventId, addresses);
    } else {
      const allAddresses = await readAllAttendeeAddresses(
        eventId,
        attendeeCount,
      );
      const searchedAddresses = search
        ? allAddresses.filter((address) =>
            address.toLowerCase().includes(search),
          )
        : allAddresses;
      const searchedRows = await loadReservationRows(
        eventId,
        searchedAddresses,
      );
      const filteredRows =
        statusFilter.status === null
          ? searchedRows
          : searchedRows.filter((row) => row.status === statusFilter.status);

      filteredCount = BigInt(filteredRows.length);
      totalPages = calculateTotalPages(filteredCount);
      page = Math.min(requestedPage, totalPages);

      const startIndex = (page - 1) * PAGE_SIZE;
      rows = filteredRows.slice(startIndex, startIndex + PAGE_SIZE);
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    const attendanceWindowOpen =
      !eventDetails.cancelled &&
      now >= eventDetails.eventStart &&
      now <= eventDetails.resolutionDeadline;

    const noShowWindowOpen =
      !eventDetails.cancelled &&
      now >= eventDetails.eventEnd &&
      now <= eventDetails.resolutionDeadline;

    return NextResponse.json(
      {
        eventId: eventId.toString(),
        organizer: eventDetails.organizer,
        deposit: {
          amount: eventDetails.depositAmount.toString(),
          formatted: serializeUsdc(eventDetails.depositAmount),
        },
        timing: {
          eventStart: eventDetails.eventStart.toString(),
          eventEnd: eventDetails.eventEnd.toString(),
          resolutionDeadline: eventDetails.resolutionDeadline.toString(),
          attendanceWindowOpen,
          noShowWindowOpen,
        },
        attendeeCount: attendeeCount.toString(),
        filteredCount: filteredCount.toString(),
        page,
        pageSize: PAGE_SIZE,
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
        search,
        status: statusFilter.key,
        attendees: rows,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const status = error instanceof ShowUpApiError ? error.status : 500;

    console.error("ShowUp paginated attendee list failed:", error);

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
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
