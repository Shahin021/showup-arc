import { NextResponse } from "next/server";
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InitializeRequest = {
  userToken?: unknown;
};

function createCircleClient() {
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not configured.");
  }

  return initiateUserControlledWalletsClient({
    apiKey,
  });
}

function getCircleErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const possibleError = error as {
    code?: number;
    data?: {
      code?: number;
    };
    response?: {
      data?: {
        code?: number;
      };
    };
  };

  return (
    possibleError.code ??
    possibleError.data?.code ??
    possibleError.response?.data?.code
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as InitializeRequest;

    const userToken =
      typeof body.userToken === "string" ? body.userToken.trim() : "";

    if (!userToken) {
      return NextResponse.json(
        {
          error: "A valid user token is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const circleClient = createCircleClient();

    try {
      const response = await circleClient.createUserPinWithWallets({
        userToken,
        blockchains: ["ARC-TESTNET"],
        accountType: "SCA",
      });

      const challengeId = response.data?.challengeId;

      if (!challengeId) {
        throw new Error("Circle did not return a wallet challenge ID.");
      }

      return NextResponse.json(
        {
          challengeId,
          alreadyInitialized: false,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (error) {
      // Circle code 155106 means the user already created their wallet.
      if (getCircleErrorCode(error) === 155106) {
        return NextResponse.json(
          {
            challengeId: null,
            alreadyInitialized: true,
          },
          {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
            },
          },
        );
      }

      throw error;
    }
  } catch (error) {
    console.error("Circle wallet initialization failed:", error);

    return NextResponse.json(
      {
        error: "Unable to initialize the Circle wallet.",
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