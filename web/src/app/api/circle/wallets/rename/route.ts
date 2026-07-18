import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RenameWalletRequest = {
  userToken?: unknown;
  walletId?: unknown;
  walletName?: unknown;
};

type CircleRenameWalletResponse = {
  data?: {
    wallet?: {
      id?: string;
      name?: string;
      address?: string;
      blockchain?: string;
      state?: string;
    };
  };
  code?: number;
  message?: string;
};

function getCircleApiKey() {
  const apiKey =
    process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "CIRCLE_API_KEY is not configured.",
    );
  }

  return apiKey;
}

function normalizeText(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
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
        )) as RenameWalletRequest;

    const userToken =
      normalizeText(
        body.userToken,
      );

    const walletId =
      normalizeText(
        body.walletId,
      );

    const walletName =
      normalizeText(
        body.walletName,
      );

    if (!userToken) {
      return NextResponse.json(
        {
          error:
            "Circle user token is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (!walletId) {
      return NextResponse.json(
        {
          error:
            "Circle wallet ID is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (!walletName) {
      return NextResponse.json(
        {
          error:
            "Wallet name cannot be empty.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (walletName.length > 64) {
      return NextResponse.json(
        {
          error:
            "Wallet name must be 64 characters or fewer.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const circleResponse =
      await fetch(
        `https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(
          walletId,
        )}`,
        {
          method: "PUT",
          headers: {
            Authorization:
              `Bearer ${getCircleApiKey()}`,
            "X-User-Token":
              userToken,
            "X-Request-Id":
              randomUUID(),
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            name: walletName,
          }),
        },
      );

    const circleData =
      (await circleResponse
        .json()
        .catch(
          () => ({}),
        )) as CircleRenameWalletResponse;

    if (!circleResponse.ok) {
      return NextResponse.json(
        {
          error:
            circleData.message ||
            "Circle could not rename the wallet.",
          circleCode:
            circleData.code,
        },
        {
          status:
            circleResponse.status >=
              400 &&
            circleResponse.status <
              600
              ? circleResponse.status
              : 500,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        walletId,
        walletName,
        wallet:
          circleData.data
            ?.wallet ?? null,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Circle wallet rename failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to rename the Circle wallet.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}
