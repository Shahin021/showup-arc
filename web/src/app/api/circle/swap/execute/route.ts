import {
  NextResponse,
} from "next/server";

import {
  getAddress,
  isAddress,
} from "viem";

import {
  createCircleChallenge,
  ShowUpApiError,
  verifyCircleArcWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CircleSwapExecuteRequest = {
  userToken?: unknown;
  walletId?: unknown;
  contractAddress?: unknown;
  callData?: unknown;
};

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isCallData(
  value: string,
): value is `0x${string}` {
  return /^0x(?:[a-fA-F0-9]{2})+$/.test(
    value,
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
        )) as CircleSwapExecuteRequest;

    const userToken =
      readString(body.userToken);

    const walletId =
      readString(body.walletId);

    const contractAddress =
      readString(body.contractAddress);

    const callData =
      readString(body.callData);

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

    if (!isAddress(contractAddress)) {
      throw new ShowUpApiError(
        "A valid swap contract address is required.",
      );
    }

    if (!isCallData(callData)) {
      throw new ShowUpApiError(
        "Valid swap call data is required.",
      );
    }

    const verifiedWallet =
      await verifyCircleArcWallet(
        userToken,
        walletId,
      );

    const challenge =
      await createCircleChallenge({
        userToken:
          verifiedWallet.userToken,
        walletId:
          verifiedWallet.walletId,
        contractAddress:
          getAddress(contractAddress),
        callData,
        refPrefix:
          "showup-circle-swap",
      });

    return NextResponse.json({
      ...challenge,
      walletId:
        verifiedWallet.walletId,
      walletAddress:
        verifiedWallet.address,
      blockchain:
        "ARC-TESTNET",
      contractAddress:
        getAddress(contractAddress),
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
      "Circle swap challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to prepare the Circle swap transaction.",
      },
      {
        status: 500,
      },
    );
  }
}
