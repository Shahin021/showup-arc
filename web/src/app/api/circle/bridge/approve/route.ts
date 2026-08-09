import {
  NextResponse,
} from "next/server";

import {
  parseUnits,
} from "viem";

import {
  CCTP_TOKEN_MESSENGER_V2,
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

type BridgeApproveRequest = {
  userToken?: unknown;
  walletId?: unknown;
  blockchain?: unknown;
  amount?: unknown;
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

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as BridgeApproveRequest;

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

    const amountUnits =
      parseUnits(
        amount,
        6,
      );

    if (amountUnits <= BigInt(0)) {
      throw new ShowUpApiError(
        "USDC amount must be greater than zero.",
      );
    }

    const verifiedWallet =
      await verifyCircleWallet(
        userToken,
        walletId,
        blockchain,
      );

    const network =
      getCctpNetwork(
        blockchain,
      );

    const challenge =
      await createCircleChallenge({
        userToken:
          verifiedWallet.userToken,
        walletId:
          verifiedWallet.walletId,
        contractAddress:
          network.usdcAddress,
        abiFunctionSignature:
          "approve(address,uint256)",
        abiParameters: [
          CCTP_TOKEN_MESSENGER_V2,
          amountUnits.toString(),
        ],
        refPrefix:
          blockchain === "ARC-TESTNET"
            ? "showup-cctp-approve-arc"
            : "showup-cctp-approve-sepolia",
      });

    return NextResponse.json({
      ...challenge,
      blockchain,
      walletAddress:
        verifiedWallet.address,
      amount,
      amountUnits:
        amountUnits.toString(),
      spender:
        CCTP_TOKEN_MESSENGER_V2,
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
      "Circle CCTP approve challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to prepare the USDC approval transaction.",
      },
      {
        status: 500,
      },
    );
  }
}
