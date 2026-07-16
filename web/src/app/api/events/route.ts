import { NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  http,
} from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC_URL = "https://rpc.testnet.arc.network";

const FALLBACK_CONTRACT_ADDRESS =
  "0x0506cF7B5408C046F0f693a52394F481C0922B2D";

const SHOWUP_ABI = [
  {
    type: "function",
    name: "eventCount",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "getEvent",
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
        type: "tuple",
        components: [
          {
            name: "organizer",
            type: "address",
          },
          {
            name: "title",
            type: "string",
          },
          {
            name: "description",
            type: "string",
          },
          {
            name: "depositAmount",
            type: "uint256",
          },
          {
            name: "capacity",
            type: "uint256",
          },
          {
            name: "reservedSeats",
            type: "uint256",
          },
          {
            name: "escrowedAmount",
            type: "uint256",
          },
          {
            name: "cancellationDeadline",
            type: "uint64",
          },
          {
            name: "eventStart",
            type: "uint64",
          },
          {
            name: "eventEnd",
            type: "uint64",
          },
          {
            name: "resolutionDeadline",
            type: "uint64",
          },
          {
            name: "cancelled",
            type: "bool",
          },
        ],
      },
    ],
  },
] as const;

type ContractEvent = {
  organizer: `0x${string}`;
  title: string;
  description: string;
  depositAmount: bigint;
  capacity: bigint;
  reservedSeats: bigint;
  escrowedAmount: bigint;
  cancellationDeadline: bigint;
  eventStart: bigint;
  eventEnd: bigint;
  resolutionDeadline: bigint;
  cancelled: boolean;
};

function getContractAddress() {
  const configuredAddress =
    process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS?.trim() ||
    FALLBACK_CONTRACT_ADDRESS;

  if (!/^0x[a-fA-F0-9]{40}$/.test(configuredAddress)) {
    throw new Error(
      "ShowUp contract address is not configured correctly.",
    );
  }

  return configuredAddress as `0x${string}`;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRateLimitError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("request limit reached") ||
    message.includes("rate limit") ||
    message.includes("limit exceeded") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    message.includes("-32614")
  );
}

async function withRpcRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error) || attempt === 5) {
        throw error;
      }

      await wait(attempt * 1_000);
    }
  }

  throw lastError;
}

export async function GET() {
  try {
    const contractAddress = getContractAddress();

    const client = createPublicClient({
      transport: http(RPC_URL, {
        retryCount: 5,
        retryDelay: 1_000,
        timeout: 20_000,
      }),
    });

    const eventCount = await withRpcRetry(() =>
      client.readContract({
        address: contractAddress,
        abi: SHOWUP_ABI,
        functionName: "eventCount",
      }),
    );

    const count = Number(eventCount);

    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        "The contract returned an invalid event count.",
      );
    }

    if (count === 0) {
      return NextResponse.json(
        {
          events: [],
          contractAddress,
        },
        {
          status: 200,
          headers: {
            "Cache-Control":
              "public, s-maxage=10, stale-while-revalidate=30",
          },
        },
      );
    }

    const contractEvents = [];

    /*
     * Read events one by one instead of sending concurrent
     * requests to the rate-limited public Arc RPC.
     */
    for (let eventNumber = 1; eventNumber <= count; eventNumber += 1) {
      await wait(1_200);

      const eventId = BigInt(eventNumber);

      const details = (await withRpcRetry(() =>
        client.readContract({
          address: contractAddress,
          abi: SHOWUP_ABI,
          functionName: "getEvent",
          args: [eventId],
        }),
      )) as ContractEvent;

      contractEvents.push({
        id: eventId.toString(),
        organizer: details.organizer,
        title: details.title,
        description: details.description,
        deposit: formatUnits(
          details.depositAmount,
          6,
        ),
        depositAmount:
          details.depositAmount.toString(),
        capacity: details.capacity.toString(),
        reservedSeats:
          details.reservedSeats.toString(),
        escrowedAmount:
          details.escrowedAmount.toString(),
        cancellationDeadline:
          details.cancellationDeadline.toString(),
        eventStart: details.eventStart.toString(),
        eventEnd: details.eventEnd.toString(),
        resolutionDeadline:
          details.resolutionDeadline.toString(),
        cancelled: details.cancelled,
      });
    }

    return NextResponse.json(
      {
        events: contractEvents.reverse(),
        contractAddress,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "public, s-maxage=10, stale-while-revalidate=30",
        },
      },
    );
  } catch (error) {
    console.error(
      "Unable to load ShowUp events:",
      error,
    );

    const rateLimited = isRateLimitError(error);

    return NextResponse.json(
      {
        error: rateLimited
          ? "Arc Testnet is temporarily limiting public RPC requests. Please refresh in a few seconds."
          : "Unable to load events from Arc Testnet.",
      },
      {
        status: rateLimited ? 503 : 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
