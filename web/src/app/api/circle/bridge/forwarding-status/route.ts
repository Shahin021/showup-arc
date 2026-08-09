import {
  NextResponse,
} from "next/server";

import {
  getCctpNetwork,
  type ShowUpCctpBlockchain,
} from "@/lib/showup-cctp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForwardingStatusRequest = {
  sourceBlockchain?: unknown;
  transactionHash?: unknown;
};

type CctpMessage = {
  status?: string;
  forwardState?: string;
  forwardTxHash?: string | null;
};

type CctpMessagesResponse = {
  messages?: CctpMessage[];
};

function readBlockchain(
  value: unknown,
): ShowUpCctpBlockchain | null {
  return value === "ARC-TESTNET" ||
    value === "ETH-SEPOLIA"
    ? value
    : null;
}

export async function POST(
  request: Request,
) {
  const body =
    (await request
      .json()
      .catch(
        () => ({}),
      )) as ForwardingStatusRequest;

  const sourceBlockchain =
    readBlockchain(
      body.sourceBlockchain,
    );

  const transactionHash =
    typeof body.transactionHash === "string"
      ? body.transactionHash.trim()
      : "";

  if (!sourceBlockchain) {
    return NextResponse.json(
      {
        error:
          "Unsupported CCTP source blockchain.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    !/^0x[a-fA-F0-9]{64}$/.test(
      transactionHash,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "A valid burn transaction hash is required.",
      },
      {
        status: 400,
      },
    );
  }

  const sourceNetwork =
    getCctpNetwork(
      sourceBlockchain,
    );

  const response =
    await fetch(
      `https://iris-api-sandbox.circle.com/v2/messages/${sourceNetwork.domain}?transactionHash=${transactionHash}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

  if (
    response.status === 404
  ) {
    return NextResponse.json(
      {
        status: "pending",
      },
      {
        status: 202,
      },
    );
  }

  const data =
    (await response
      .json()
      .catch(
        () => ({}),
      )) as CctpMessagesResponse;

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          "Unable to retrieve the Circle forwarding status.",
      },
      {
        status: 502,
      },
    );
  }

  const message =
    data.messages?.[0];

  const forwardTxHash =
    typeof message?.forwardTxHash === "string"
      ? message.forwardTxHash
      : "";

  if (
    /^0x[a-fA-F0-9]{64}$/.test(
      forwardTxHash,
    )
  ) {
    return NextResponse.json({
      status: "complete",
      forwardState:
        message?.forwardState ?? null,
      forwardTxHash,
    });
  }

  return NextResponse.json(
    {
      status: "pending",
      forwardState:
        message?.forwardState ?? null,
    },
    {
      status: 202,
    },
  );
}
