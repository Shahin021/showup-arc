import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WalletRequest = {
  userToken?: unknown;
};

type CircleWallet = {
  id: string;
  address: string;
  blockchain: string;
  createDate?: string;
  updateDate?: string;
  state?: string;
  walletSetId?: string;
  accountType?: string;
  name?: string;
  refId?: string;
  userId?: string;
};

type CircleWalletsResponse = {
  data?: {
    wallets?: CircleWallet[];
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as WalletRequest;

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

    const circleUrl = new URL(
      "https://api.circle.com/v1/w3s/wallets",
    );

    circleUrl.searchParams.set("blockchain", "ARC-TESTNET");
    circleUrl.searchParams.set("pageSize", "10");
    circleUrl.searchParams.set("order", "DESC");

    const circleResponse = await fetch(circleUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-User-Token": userToken,
        "X-Request-Id": randomUUID(),
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const circleData =
      (await circleResponse
        .json()
        .catch(() => ({}))) as CircleWalletsResponse;

    if (!circleResponse.ok) {
      console.error("Circle wallet lookup failed:", {
        status: circleResponse.status,
        message: circleData.message,
      });

      return NextResponse.json(
        {
          error:
            circleData.message ||
            "Circle could not retrieve the wallet.",
        },
        {
          status: circleResponse.status,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const wallets = circleData.data?.wallets ?? [];

    const wallet =
      wallets.find(
        (item) =>
          item.blockchain === "ARC-TESTNET" &&
          item.state === "LIVE",
      ) ??
      wallets.find(
        (item) => item.blockchain === "ARC-TESTNET",
      );

    if (!wallet) {
      return NextResponse.json(
        {
          error: "No Arc Testnet wallet was found for this user.",
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        wallet: {
          id: wallet.id,
          address: wallet.address,
          blockchain: wallet.blockchain,
          state: wallet.state,
          accountType: wallet.accountType,
          createDate: wallet.createDate,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Circle wallet lookup failed:", error);

    return NextResponse.json(
      {
        error: "Unable to retrieve the Circle wallet.",
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