import {
  NextResponse,
} from "next/server";

import {
  isAddress,
  parseUnits,
} from "viem";

import {
  addressToCctpBytes32,
  CCTP_TOKEN_MESSENGER_V2,
  CCTP_ZERO_BYTES32,
  getCctpNetwork,
  type ShowUpCctpBlockchain,
} from "@/lib/showup-cctp";

import {
  createCircleChallenge,
  ShowUpApiError,
  verifyCircleWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CCTP_FORWARDING_SERVICE_HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000";

type BridgeBurnRequest = {
  userToken?: unknown;
  walletId?: unknown;
  blockchain?: unknown;
  amount?: unknown;
  recipient?: unknown;
  totalAmount?: unknown;
  maxFee?: unknown;
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
        )) as BridgeBurnRequest;

    const userToken =
      readString(body.userToken);

    const walletId =
      readString(body.walletId);

    const blockchain =
      readBlockchain(
        body.blockchain,
      );

    const amount =
      readString(body.amount);

    const recipient =
      readString(body.recipient);

    const totalAmountText =
      readString(body.totalAmount);

    const maxFeeText =
      readString(body.maxFee);

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

    if (
      !/^\d+(?:\.\d{1,6})?$/.test(
        amount,
      )
    ) {
      throw new ShowUpApiError(
        "Enter a valid USDC amount with up to 6 decimals.",
      );
    }

    if (!isAddress(recipient)) {
      throw new ShowUpApiError(
        "A valid destination recipient is required.",
      );
    }

    if (
      !/^\d+$/.test(totalAmountText) ||
      !/^\d+$/.test(maxFeeText)
    ) {
      throw new ShowUpApiError(
        "A valid Circle forwarding quote is required.",
      );
    }

    const transferAmount =
      parseUnits(
        amount,
        6,
      );

    const totalAmount =
      BigInt(totalAmountText);

    const maxFee =
      BigInt(maxFeeText);

    if (
      transferAmount <= BigInt(0)
    ) {
      throw new ShowUpApiError(
        "USDC amount must be greater than zero.",
      );
    }

    if (
      totalAmount !==
      transferAmount + maxFee
    ) {
      throw new ShowUpApiError(
        "The Circle forwarding quote is inconsistent.",
      );
    }

    const verifiedWallet =
      await verifyCircleWallet(
        userToken,
        walletId,
        blockchain,
      );

    const sourceNetwork =
      getCctpNetwork(
        blockchain,
      );

    const destinationBlockchain =
      getDestinationBlockchain(
        blockchain,
      );

    const destinationNetwork =
      getCctpNetwork(
        destinationBlockchain,
      );

    const finalityThreshold =
      blockchain === "ETH-SEPOLIA"
        ? 1000
        : 2000;

    const mintRecipient =
      addressToCctpBytes32(
        recipient,
      );

    const challenge =
      await createCircleChallenge({
        userToken:
          verifiedWallet.userToken,
        walletId:
          verifiedWallet.walletId,
        contractAddress:
          CCTP_TOKEN_MESSENGER_V2,
        abiFunctionSignature:
          "depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)",
        abiParameters: [
          totalAmount.toString(),
          destinationNetwork.domain.toString(),
          mintRecipient,
          sourceNetwork.usdcAddress,
          CCTP_ZERO_BYTES32,
          maxFee.toString(),
          finalityThreshold.toString(),
          CCTP_FORWARDING_SERVICE_HOOK_DATA,
        ],
        refPrefix:
          blockchain === "ARC-TESTNET"
            ? "showup-cctp-forward-arc"
            : "showup-cctp-forward-sepolia",
      });

    return NextResponse.json({
      ...challenge,
      sourceBlockchain:
        blockchain,
      destinationBlockchain,
      sourceWalletAddress:
        verifiedWallet.address,
      recipient,
      amount,
      transferAmount:
        transferAmount.toString(),
      totalAmount:
        totalAmount.toString(),
      maxFee:
        maxFee.toString(),
      finalityThreshold,
      forwarding: true,
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
      "Circle CCTP forwarding burn challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to prepare the CCTP forwarding transaction.",
      },
      {
        status: 500,
      },
    );
  }
}
