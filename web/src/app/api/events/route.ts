import { NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  http,
} from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const contractAddress = getContractAddress();

    const client = createPublicClient({
      transport: http(
        "https://rpc.testnet.arc.network",
      ),
    });

    const eventCount = await client.readContract({
      address: contractAddress,
      abi: SHOWUP_ABI,
      functionName: "eventCount",
    });

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
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const eventIds = Array.from(
      {
        length: count,
      },
      (_, index) => BigInt(index + 1),
    );

    const contractEvents = await Promise.all(
      eventIds.map(async (eventId) => {
        const details = (await client.readContract({
          address: contractAddress,
          abi: SHOWUP_ABI,
          functionName: "getEvent",
          args: [eventId],
        })) as ContractEvent;

        return {
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
        };
      }),
    );

    return NextResponse.json(
      {
        events: contractEvents.reverse(),
        contractAddress,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Unable to load ShowUp events:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load events from Arc Testnet.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
