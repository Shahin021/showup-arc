import {
  NextResponse,
} from "next/server";

import {
  createPublicClient,
  fallback,
  http,
} from "viem";
import { sepolia } from "viem/chains";

import {
  arcPublicClient,
} from "@/lib/arc-public-client";

import {
  ShowUpApiError,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sepoliaPublicClient =
  createPublicClient({
    chain: sepolia,
    transport: fallback([
      http(
        "https://ethereum-sepolia-rpc.publicnode.com",
        {
          timeout: 15_000,
          retryCount: 0,
        },
      ),
      http(
        "https://rpc.sepolia.org",
        {
          timeout: 15_000,
          retryCount: 0,
        },
      ),
    ]),
  });

type TransactionResultRequest = {
  userToken?: unknown;
  walletId?: unknown;
  refId?: unknown;
  createdAfter?: unknown;
};

type CircleTransaction = {
  id?: string;
  state?: string;
  txHash?: string;
  refId?: string;
  walletId?: string;
  blockchain?: string;
  contractAddress?: string;
  errorReason?: string;
  errorDetails?: string;
  createDate?: string;
  updateDate?: string;
};

type CircleTransactionsResponse = {
  data?: {
    transactions?: CircleTransaction[];
  };
  message?: string;
};

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

async function getOnchainReceipt(
  transaction: CircleTransaction,
) {
  const txHash =
    transaction.txHash;

  if (
    !txHash ||
    !/^0x[a-fA-F0-9]{64}$/.test(
      txHash,
    )
  ) {
    return null;
  }

  try {
    if (
      transaction.blockchain ===
      "ARC-TESTNET"
    ) {
      return await arcPublicClient
        .getTransactionReceipt({
          hash:
            txHash as `0x${string}`,
        });
    }

    if (
      transaction.blockchain ===
      "ETH-SEPOLIA"
    ) {
      return await sepoliaPublicClient
        .getTransactionReceipt({
          hash:
            txHash as `0x${string}`,
        });
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as TransactionResultRequest;

    const userToken =
      readString(body.userToken);

    const walletId =
      readString(body.walletId);

    const refId =
      readString(body.refId);

    const createdAfter =
      readString(body.createdAfter);

    if (!userToken) {
      throw new ShowUpApiError(
        "A valid Circle session is required.",
        401,
      );
    }

    if (!walletId) {
      throw new ShowUpApiError(
        "Circle wallet ID is required.",
      );
    }

    if (!refId) {
      throw new ShowUpApiError(
        "Circle transaction reference is required.",
      );
    }

    if (
      !createdAfter ||
      Number.isNaN(
        Date.parse(createdAfter),
      )
    ) {
      throw new ShowUpApiError(
        "Circle transaction start time is invalid.",
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

    const searchParams =
      new URLSearchParams({
        walletIds: walletId,
        from: createdAfter,
        pageSize: "50",
        order: "DESC",
      });

    const response =
      await fetch(
        `https://api.circle.com/v1/w3s/transactions?${searchParams.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "X-User-Token":
              userToken,
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
        )) as CircleTransactionsResponse;

    if (!response.ok) {
      throw new ShowUpApiError(
        data.message ??
          "Unable to retrieve Circle transactions.",
        response.status,
      );
    }

    const transactions =
      Array.isArray(
        data.data?.transactions,
      )
        ? data.data.transactions
        : [];

    console.log(
      "[circle-tx-list]",
      transactions.slice(0, 10).map(
        (item) => ({
          id: item.id ?? null,
          refId: item.refId ?? null,
          walletId: item.walletId ?? null,
          state: item.state ?? null,
          txHash: item.txHash ?? null,
          blockchain: item.blockchain ?? null,
          createDate: item.createDate ?? null,
        }),
      ),
    );

    const transaction =
      transactions.find(
        (item) =>
          item.refId === refId &&
          item.walletId === walletId,
      ) ??
      transactions.find(
        (item) =>
          item.walletId === walletId &&
          !item.refId &&
          typeof item.createDate === "string" &&
          Date.parse(item.createDate) >=
            Date.parse(createdAfter),
      );

    console.log("[circle-tx-poll]", {
      refId,
      found: Boolean(transaction),
      state:
        transaction?.state ?? null,
      txHash:
        transaction?.txHash ?? null,
      blockchain:
        transaction?.blockchain ?? null,
      errorReason:
        transaction?.errorReason ?? null,
      errorDetails:
        transaction?.errorDetails ?? null,
    });

    if (!transaction) {
      return NextResponse.json(
        {
          status: "PENDING",
          transaction: null,
        },
        {
          status: 202,
        },
      );
    }

    const failed =
      transaction.state === "FAILED" ||
      transaction.state === "DENIED" ||
      transaction.state === "CANCELLED";

    if (failed) {
      return NextResponse.json(
        {
          error:
            transaction.errorDetails ||
            transaction.errorReason ||
            `Circle transaction ended with state: ${transaction.state}.`,
          transaction,
        },
        {
          status: 409,
        },
      );
    }

    if (
      transaction.state !== "CONFIRMED" &&
      transaction.state !== "COMPLETE" &&
      transaction.txHash
    ) {
      const receipt =
        await getOnchainReceipt(
          transaction,
        );

      if (
        receipt?.status === "success"
      ) {
        return NextResponse.json({
          status: "COMPLETE",
          transaction: {
            ...transaction,
            state: "COMPLETE",
          },
          confirmationSource:
            "onchain-receipt",
        });
      }

      if (
        receipt?.status === "reverted"
      ) {
        return NextResponse.json(
          {
            error:
              "The Circle transaction reverted onchain.",
            transaction,
          },
          {
            status: 409,
          },
        );
      }
    }

    return NextResponse.json({
      status:
        transaction.state ??
        "UNKNOWN",
      transaction,
    });
  } catch (error) {
    if (
      error instanceof ShowUpApiError
    ) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    console.error(
      "Circle transaction result lookup failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to retrieve the Circle transaction result.",
      },
      {
        status: 500,
      },
    );
  }
}
