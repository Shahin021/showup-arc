import {
  NextResponse,
} from "next/server";

import {
  CCTP_MESSAGE_TRANSMITTER_V2,
  type ShowUpCctpBlockchain,
} from "@/lib/showup-cctp";

import {
  createCircleChallenge,
  ShowUpApiError,
  verifyCircleWallet,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BridgeReceiveRequest = {
  userToken?: unknown;
  walletId?: unknown;
  blockchain?: unknown;
  message?: unknown;
  attestation?: unknown;
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
    "Unsupported CCTP destination blockchain.",
  );
}

function readHexBytes(
  value: unknown,
  fieldName: string,
) {
  const normalized =
    readString(value);

  if (
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(
      normalized,
    )
  ) {
    throw new ShowUpApiError(
      `${fieldName} is invalid.`,
    );
  }

  return normalized;
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
        )) as BridgeReceiveRequest;

    const userToken =
      readString(body.userToken);

    const walletId =
      readString(body.walletId);

    const blockchain =
      readBlockchain(
        body.blockchain,
      );

    const message =
      readHexBytes(
        body.message,
        "CCTP message",
      );

    const attestation =
      readHexBytes(
        body.attestation,
        "CCTP attestation",
      );

    if (!userToken) {
      throw new ShowUpApiError(
        "A valid Circle session is required.",
        401,
      );
    }

    if (!walletId) {
      throw new ShowUpApiError(
        "Circle destination wallet ID is required.",
      );
    }

    const verifiedWallet =
      await verifyCircleWallet(
        userToken,
        walletId,
        blockchain,
      );

    const challenge =
      await createCircleChallenge({
        userToken:
          verifiedWallet.userToken,
        walletId:
          verifiedWallet.walletId,
        contractAddress:
          CCTP_MESSAGE_TRANSMITTER_V2,
        abiFunctionSignature:
          "receiveMessage(bytes,bytes)",
        abiParameters: [
          message,
          attestation,
        ],
        refPrefix:
          blockchain === "ARC-TESTNET"
            ? "showup-cctp-receive-arc"
            : "showup-cctp-receive-sepolia",
      });

    return NextResponse.json({
      ...challenge,
      blockchain,
      walletAddress:
        verifiedWallet.address,
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
      "Circle CCTP receive challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to prepare the CCTP receive transaction.",
      },
      {
        status: 500,
      },
    );
  }
}
