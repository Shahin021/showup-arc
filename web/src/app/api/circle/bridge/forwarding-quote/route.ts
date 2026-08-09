import {
  NextResponse,
} from "next/server";

import {
  formatUnits,
  parseUnits,
} from "viem";

import {
  getCctpNetwork,
  type ShowUpCctpBlockchain,
} from "@/lib/showup-cctp";

import {
  ShowUpApiError,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForwardingQuoteRequest = {
  sourceBlockchain?: unknown;
  amount?: unknown;
};

type ForwardFee = {
  low?: number;
  med?: number;
  medium?: number;
  high?: number;
};

type CctpFeeQuote = {
  finalityThreshold?: number;
  minimumFee?: number;
  forwardFee?: ForwardFee;
};

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function readBlockchain(
  value: unknown,
): ShowUpCctpBlockchain {
  if (
    value === "ARC-TESTNET" ||
    value === "ETH-SEPOLIA"
  ) {
    return value;
  }

  throw new ShowUpApiError(
    "Unsupported CCTP source blockchain.",
  );
}

function getDestinationBlockchain(
  source: ShowUpCctpBlockchain,
): ShowUpCctpBlockchain {
  return source === "ARC-TESTNET"
    ? "ETH-SEPOLIA"
    : "ARC-TESTNET";
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
        )) as ForwardingQuoteRequest;

    const sourceBlockchain =
      readBlockchain(
        body.sourceBlockchain,
      );

    const amount =
      readString(body.amount);

    if (
      !/^\d+(?:\.\d{1,6})?$/.test(
        amount,
      )
    ) {
      throw new ShowUpApiError(
        "Enter a valid USDC amount with up to 6 decimals.",
      );
    }

    const transferAmount =
      parseUnits(
        amount,
        6,
      );

    if (
      transferAmount <= BigInt(0)
    ) {
      throw new ShowUpApiError(
        "USDC amount must be greater than zero.",
      );
    }

    const destinationBlockchain =
      getDestinationBlockchain(
        sourceBlockchain,
      );

    const sourceNetwork =
      getCctpNetwork(
        sourceBlockchain,
      );

    const destinationNetwork =
      getCctpNetwork(
        destinationBlockchain,
      );

    const finalityThreshold =
      sourceBlockchain === "ETH-SEPOLIA"
        ? 1000
        : 2000;

    const response =
      await fetch(
        `https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/${sourceNetwork.domain}/${destinationNetwork.domain}?forward=true`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        },
      );

    const data =
      (await response
        .json()
        .catch(
          () => [],
        )) as CctpFeeQuote[];

    if (!response.ok) {
      throw new ShowUpApiError(
        "Unable to retrieve the Circle forwarding fee.",
        502,
      );
    }

    const feeQuote =
      Array.isArray(data)
        ? data.find(
            (item) =>
              item.finalityThreshold ===
              finalityThreshold,
          )
        : undefined;

    if (
      !feeQuote ||
      typeof feeQuote.minimumFee !== "number" ||
      !feeQuote.forwardFee
    ) {
      throw new ShowUpApiError(
        "Circle did not return a valid forwarding quote.",
        502,
      );
    }

    const forwardingFeeValue =
      feeQuote.forwardFee.med ??
      feeQuote.forwardFee.medium;

    if (
      typeof forwardingFeeValue !== "number" ||
      !Number.isFinite(
        forwardingFeeValue,
      ) ||
      forwardingFeeValue < 0
    ) {
      throw new ShowUpApiError(
        "Circle did not return a valid forwarding fee.",
        502,
      );
    }

    const forwardFee =
      BigInt(
        Math.ceil(
          forwardingFeeValue,
        ),
      );

    const hundredthsOfBasisPoint =
      Math.round(
        feeQuote.minimumFee * 100,
      );

    const protocolFee =
      (
        transferAmount *
        BigInt(
          hundredthsOfBasisPoint,
        )
      ) /
      BigInt(1_000_000);

    const maxFee =
      forwardFee +
      protocolFee;

    const totalAmount =
      transferAmount +
      maxFee;

    return NextResponse.json({
      sourceBlockchain,
      destinationBlockchain,
      finalityThreshold,
      amount,
      transferAmount:
        transferAmount.toString(),
      protocolFee:
        protocolFee.toString(),
      forwardFee:
        forwardFee.toString(),
      maxFee:
        maxFee.toString(),
      totalAmount:
        totalAmount.toString(),
      totalAmountFormatted:
        formatUnits(
          totalAmount,
          6,
        ),
      feeFormatted:
        formatUnits(
          maxFee,
          6,
        ),
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
      "Circle forwarding quote failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to calculate the Circle forwarding fee.",
      },
      {
        status: 500,
      },
    );
  }
}
