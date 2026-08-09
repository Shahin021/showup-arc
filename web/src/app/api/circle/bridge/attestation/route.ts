import {
  NextResponse,
} from "next/server";

import {
  getCctpNetwork,
  type ShowUpCctpBlockchain,
} from "@/lib/showup-cctp";

import {
  ShowUpApiError,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AttestationRequest = {
  sourceBlockchain?: unknown;
  transactionHash?: unknown;
};

type CctpMessage = {
  message?: string;
  attestation?: string | null;
  status?: string;
  eventNonce?: string;
};

type CctpMessagesResponse = {
  messages?: CctpMessage[];
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
        )) as AttestationRequest;

    const sourceBlockchain =
      readBlockchain(
        body.sourceBlockchain,
      );

    const transactionHash =
      readString(
        body.transactionHash,
      );

    if (
      !/^0x[0-9a-fA-F]{64}$/.test(
        transactionHash,
      )
    ) {
      throw new ShowUpApiError(
        "A valid source transaction hash is required.",
      );
    }

    const sourceNetwork =
      getCctpNetwork(
        sourceBlockchain,
      );

    const response =
      await fetch(
        `https://iris-api-sandbox.circle.com/v2/messages/${sourceNetwork.domain}?transactionHash=${encodeURIComponent(transactionHash)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        },
      );

    if (response.status === 404) {
      return NextResponse.json(
        {
          status: "pending",
          message: null,
          attestation: null,
        },
        {
          status: 202,
        },
      );
    }

    if (!response.ok) {
      throw new ShowUpApiError(
        "Unable to retrieve the CCTP attestation.",
        502,
      );
    }

    const data =
      (await response
        .json()
        .catch(
          () => ({}),
        )) as CctpMessagesResponse;

    const messages =
      Array.isArray(data.messages)
        ? data.messages
        : [];

    const completed =
      messages.find(
        (item) =>
          item.status === "complete" &&
          typeof item.message === "string" &&
          item.message.startsWith("0x") &&
          typeof item.attestation === "string" &&
          item.attestation.startsWith("0x"),
      );

    if (completed) {
      return NextResponse.json({
        status: "complete",
        message:
          completed.message,
        attestation:
          completed.attestation,
        eventNonce:
          completed.eventNonce,
      });
    }

    const current =
      messages[0];

    return NextResponse.json(
      {
        status:
          current?.status ??
          "pending",
        message: null,
        attestation: null,
      },
      {
        status: 202,
      },
    );
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
      "Circle CCTP attestation lookup failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to retrieve the CCTP attestation.",
      },
      {
        status: 500,
      },
    );
  }
}
