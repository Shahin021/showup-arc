import { randomUUID } from "node:crypto";
import {
  formatUnits,
  getAddress,
  isAddress,
} from "viem";
import { arcPublicClient } from "@/lib/arc-public-client";

export const SHOWUP_V3_ADDRESS =
  "0x81a14301ADb2c8DA38dbd7d8Fa05eF940115FfBD";

export const ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

export const SHOWUP_EVENT_ABI = [
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
            name: "metadataURI",
            type: "string",
          },
          {
            name: "eventType",
            type: "uint8",
          },
          {
            name: "depositAmount",
            type: "uint256",
          },
          {
            name: "totalPrice",
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
          {
            name: "paymentDeadline",
            type: "uint64",
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getReservation",
    stateMutability: "view",
    inputs: [
      {
        name: "eventId",
        type: "uint256",
      },
      {
        name: "attendee",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "status",
            type: "uint8",
          },
          {
            name: "reservedAt",
            type: "uint64",
          },
          {
            name: "updatedAt",
            type: "uint64",
          },
          {
            name: "paymentDeadline",
            type: "uint64",
          },
        ],
      },
    ],
  },
] as const;

export const ERC20_READ_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
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
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "spender",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },
] as const;

export type ShowUpEventDetails = {
  organizer: `0x${string}`;
  title: string;
  description: string;
  metadataURI: string;
  eventType: number | bigint;
  depositAmount: bigint;
  totalPrice: bigint;
  capacity: bigint;
  reservedSeats: bigint;
  escrowedAmount: bigint;
  cancellationDeadline: bigint;
  eventStart: bigint;
  eventEnd: bigint;
  resolutionDeadline: bigint;
  cancelled: boolean;
  paymentDeadline: bigint;
};

export type ShowUpReservation = {
  status: number | bigint;
  reservedAt: bigint;
  updatedAt: bigint;
  paymentDeadline: bigint;
};

type CircleWallet = {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
};

type CircleWalletResponse = {
  data?: {
    wallet?: CircleWallet;
  };
  code?: number;
  message?: string;
};

type CircleChallengeResponse = {
  data?: {
    challengeId?: string;
  };
  code?: number;
  message?: string;
};

export class ShowUpApiError extends Error {
  status: number;

  constructor(
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "ShowUpApiError";
    this.status = status;
  }
}

export function getShowUpAddress() {
  const configured =
    process.env
      .NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS
      ?.trim() ||
    SHOWUP_V3_ADDRESS;

  if (!isAddress(configured)) {
    throw new ShowUpApiError(
      "ShowUp contract address is invalid.",
      500,
    );
  }

  return getAddress(configured);
}

export function getUsdcAddress() {
  const configured =
    process.env
      .NEXT_PUBLIC_ARC_USDC_ADDRESS
      ?.trim() ||
    ARC_TESTNET_USDC_ADDRESS;

  if (!isAddress(configured)) {
    throw new ShowUpApiError(
      "Arc Testnet USDC address is invalid.",
      500,
    );
  }

  return getAddress(configured);
}

export function parseEventId(
  value: unknown,
) {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new ShowUpApiError(
      "Event ID is invalid.",
    );
  }

  return BigInt(normalized);
}

export function parseAttendeeAddress(
  value: unknown,
) {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!isAddress(normalized)) {
    throw new ShowUpApiError(
      "Attendee wallet address is invalid.",
    );
  }

  return getAddress(normalized);
}

export async function getEventDetails(
  eventId: bigint,
) {
  try {
    return (
      await arcPublicClient.readContract({
        address: getShowUpAddress(),
        abi: SHOWUP_EVENT_ABI,
        functionName: "getEvent",
        args: [eventId],
      })
    ) as unknown as ShowUpEventDetails;
  } catch {
    throw new ShowUpApiError(
      "This event could not be found on Arc Testnet.",
      404,
    );
  }
}

export async function getReservation(
  eventId: bigint,
  attendee: `0x${string}`,
) {
  return (
    await arcPublicClient.readContract({
      address: getShowUpAddress(),
      abi: SHOWUP_EVENT_ABI,
      functionName: "getReservation",
      args: [
        eventId,
        attendee,
      ],
    })
  ) as unknown as ShowUpReservation;
}

export async function getUsdcAccountState(
  owner: `0x${string}`,
) {
  const usdcAddress =
    getUsdcAddress();

  const showUpAddress =
    getShowUpAddress();

  const [
    balance,
    allowance,
  ] = await Promise.all([
    arcPublicClient.readContract({
      address: usdcAddress,
      abi: ERC20_READ_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),

    arcPublicClient.readContract({
      address: usdcAddress,
      abi: ERC20_READ_ABI,
      functionName: "allowance",
      args: [
        owner,
        showUpAddress,
      ],
    }),
  ]);

  return {
    balance,
    allowance,
  };
}

export async function verifyCircleArcWallet(
  userTokenValue: unknown,
  walletIdValue: unknown,
) {
  const userToken =
    typeof userTokenValue === "string"
      ? userTokenValue.trim()
      : "";

  const walletId =
    typeof walletIdValue === "string"
      ? walletIdValue.trim()
      : "";

  if (!userToken) {
    throw new ShowUpApiError(
      "A valid Circle session is required.",
      401,
    );
  }

  if (!walletId) {
    throw new ShowUpApiError(
      "Connect your Circle wallet first.",
    );
  }

  const apiKey =
    process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new ShowUpApiError(
      "CIRCLE_API_KEY is not configured.",
      500,
    );
  }

  const response = await fetch(
    `https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(
      walletId,
    )}`,
    {
      method: "GET",
      headers: {
        Authorization:
          `Bearer ${apiKey}`,
        "X-User-Token":
          userToken,
        "X-Request-Id":
          randomUUID(),
        Accept:
          "application/json",
      },
      cache: "no-store",
    },
  );

  const data =
    (await response
      .json()
      .catch(
        () => ({}),
      )) as CircleWalletResponse;

  if (!response.ok) {
    throw new ShowUpApiError(
      data.message ||
        "Circle could not verify the connected wallet.",
      response.status,
    );
  }

  const wallet =
    data.data?.wallet;

  if (
    !wallet ||
    wallet.id !== walletId ||
    wallet.blockchain !==
      "ARC-TESTNET" ||
    wallet.state !== "LIVE" ||
    !isAddress(wallet.address)
  ) {
    throw new ShowUpApiError(
      "The connected Arc Testnet wallet could not be verified.",
      403,
    );
  }

  return {
    userToken,
    walletId,
    address:
      getAddress(wallet.address),
  };
}

export async function createCircleChallenge(
  input: {
    userToken: string;
    walletId: string;
    contractAddress:
      `0x${string}`;
    abiFunctionSignature: string;
    abiParameters: string[];
    refPrefix: string;
  },
) {
  const apiKey =
    process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new ShowUpApiError(
      "CIRCLE_API_KEY is not configured.",
      500,
    );
  }

  const refId =
    `${input.refPrefix}-${randomUUID()}`;

  const response = await fetch(
    "https://api.circle.com/v1/w3s/user/transactions/contractExecution",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${apiKey}`,
        "X-User-Token":
          input.userToken,
        "X-Request-Id":
          randomUUID(),
        "Content-Type":
          "application/json",
        Accept:
          "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        idempotencyKey:
          randomUUID(),
        walletId:
          input.walletId,
        contractAddress:
          input.contractAddress,
        abiFunctionSignature:
          input.abiFunctionSignature,
        abiParameters:
          input.abiParameters,
        feeLevel: "MEDIUM",
        refId,
      }),
    },
  );

  const data =
    (await response
      .json()
      .catch(
        () => ({}),
      )) as CircleChallengeResponse;

  if (!response.ok) {
    throw new ShowUpApiError(
      data.message ||
        "Circle could not create the transaction challenge.",
      response.status,
    );
  }

  const challengeId =
    data.data?.challengeId;

  if (!challengeId) {
    throw new ShowUpApiError(
      "Circle did not return a transaction challenge.",
      502,
    );
  }

  return {
    challengeId,
    refId,
    createdAfter:
      new Date(
        Date.now() - 5_000,
      ).toISOString(),
  };
}

export function getReservationStatusLabel(
  status: number,
) {
  const labels = [
    "None",
    "Reserved",
    "Cancelled",
    "Attended",
    "No-show",
    "Fallback refunded",
    "Event cancelled refunded",
    "Payment due",
    "Completed",
    "Payment defaulted",
  ];

  return labels[status] ??
    "Unknown";
}

export function serializeUsdc(
  value: bigint,
) {
  return formatUnits(value, 6);
}
