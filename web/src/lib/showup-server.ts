import { randomUUID } from "node:crypto";
import {
  formatUnits,
  getAddress,
  isAddress,
} from "viem";
import { arcPublicClient } from "@/lib/arc-public-client";
import { SHOWUP_ABI } from "@/lib/showup-abi";
import {
  ARC_NETWORK_LABEL,
  ARC_USDC_ADDRESS,
  CIRCLE_ARC_BLOCKCHAIN,
  GAS_RESERVE_USDC,
  SHOWUP_CONTRACT_ADDRESS,
  type CircleWalletBlockchain,
} from "@/lib/showup-network";

export type { CircleWalletBlockchain };

/**
 * The full ShowUpV6 ABI, generated from the compiled contract. Kept under
 * the old name for the routes that import it.
 */
export const SHOWUP_EVENT_ABI = SHOWUP_ABI;

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
  accessMode: number | bigint;
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
  return SHOWUP_CONTRACT_ADDRESS;
}

export function getUsdcAddress() {
  return ARC_USDC_ADDRESS;
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
      `This event could not be found on ${ARC_NETWORK_LABEL}.`,
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

  // `balance` is what can be spent on ShowUp payments: the ERC-20 USDC
  // balance minus a small reserve for network fees, which on Arc are paid
  // from the same USDC. Every sufficiency check uses it, so a payment never
  // leaves a wallet unable to pay for its next transaction.
  const spendable =
    balance > GAS_RESERVE_USDC
      ? balance - GAS_RESERVE_USDC
      : BigInt(0);

  return {
    balance: spendable,
    totalBalance: balance,
    gasReserve: GAS_RESERVE_USDC,
    allowance,
  };
}

export async function verifyCircleWallet(
  userTokenValue: unknown,
  walletIdValue: unknown,
  blockchain: CircleWalletBlockchain,
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
    wallet.blockchain !== blockchain ||
    wallet.state !== "LIVE" ||
    !isAddress(wallet.address)
  ) {
    throw new ShowUpApiError(
      `The connected ${blockchain} wallet could not be verified.`,
      403,
    );
  }

  return {
    userToken,
    walletId,
    address:
      getAddress(wallet.address),
    blockchain,
  };
}

export async function verifyCircleArcWallet(
  userTokenValue: unknown,
  walletIdValue: unknown,
) {
  return verifyCircleWallet(
    userTokenValue,
    walletIdValue,
    CIRCLE_ARC_BLOCKCHAIN,
  );
}

export async function createCircleChallenge(
  input: {
    userToken: string;
    walletId: string;
    contractAddress:
      `0x${string}`;
    abiFunctionSignature?: string;
    abiParameters?: string[];
    callData?: `0x${string}`;
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
        ...(input.callData
          ? {
              callData:
                input.callData,
            }
          : {
              abiFunctionSignature:
                input.abiFunctionSignature,
              abiParameters:
                input.abiParameters ?? [],
            }),
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
