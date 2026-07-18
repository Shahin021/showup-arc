import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateWalletRequest = {
  userToken?: unknown;
  walletName?: unknown;
};

type CircleCreateWalletResponse = {
  data?: {
    challengeId?: string;
  };
  code?: number;
  message?: string;
};

function getCircleApiKey() {
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not configured.");
  }

  return apiKey;
}

function createWalletName(value: unknown) {
  if (typeof value !== "string") {
    return `ShowUp Wallet ${new Date().toISOString().slice(0, 10)}`;
  }

  const trimmedName = value.trim();

  if (!trimmedName) {
    return `ShowUp Wallet ${new Date().toISOString().slice(0, 10)}`;
  }

  return trimmedName.slice(0, 64);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateWalletRequest;

    const userToken =
      typeof body.userToken === "string" ? body.userToken.trim() : "";

    if (!userToken) {
      return NextResponse.json(
        {
          error: "Circle user token is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const apiKey = getCircleApiKey();
    const walletName = createWalletName(body.walletName);

    /*
     * A new idempotency key is generated for every intentional
     * Create new wallet request.
     *
     * This is different from initialization and restore:
     * it asks Circle to create an additional wallet for the
     * currently authenticated Circle user.
     */
    const idempotencyKey = randomUUID();
    const requestId = randomUUID();
    const walletRefId = `showup-wallet-${randomUUID()}`;

    const circleResponse = await fetch(
      "https://api.circle.com/v1/w3s/user/wallets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-User-Token": userToken,
          "X-Request-Id": requestId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          idempotencyKey,
          blockchains: ["ARC-TESTNET"],
          accountType: "EOA",
          metadata: [
            {
              name: walletName,
              refId: walletRefId,
            },
          ],
        }),
        cache: "no-store",
      },
    );

    const circleData = (await circleResponse
      .json()
      .catch(() => ({}))) as CircleCreateWalletResponse;

    if (!circleResponse.ok) {
      return NextResponse.json(
        {
          error:
            circleData.message ||
            "Circle could not prepare the new wallet creation.",
          circleCode: circleData.code,
        },
        {
          status:
            circleResponse.status >= 400 && circleResponse.status < 600
              ? circleResponse.status
              : 500,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const challengeId = circleData.data?.challengeId;

    if (!challengeId) {
      return NextResponse.json(
        {
          error: "Circle did not return a wallet creation challenge.",
        },
        {
          status: 502,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        challengeId,
        walletName,
        blockchain: "ARC-TESTNET",
        accountType: "EOA",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Circle wallet creation failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to prepare the new Circle wallet.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}