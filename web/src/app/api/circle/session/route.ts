import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRequest = {
  userId?: unknown;
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

function isValidUserId(userId: string) {
  return userId.length >= 5 && userId.length <= 50;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SessionRequest;

    const existingUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";

    if (existingUserId && !isValidUserId(existingUserId)) {
      return NextResponse.json(
        {
          error: "Invalid Circle user ID.",
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

    let userId = existingUserId;
    let isNewUser = false;

    if (!userId) {
      userId = `showup_${randomUUID().replaceAll("-", "").slice(0, 32)}`;

      await circleClient.createUser({
        userId,
      });

      isNewUser = true;
    }

    const tokenResponse = await circleClient.createUserToken({
      userId,
    });

    const userToken = tokenResponse.data?.userToken;
    const encryptionKey = tokenResponse.data?.encryptionKey;

    if (!userToken || !encryptionKey) {
      throw new Error(
        "Circle did not return the required session credentials.",
      );
    }

    return NextResponse.json(
      {
        userId,
        userToken,
        encryptionKey,
        isNewUser,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Circle session creation failed:", error);

    return NextResponse.json(
      {
        error: "Unable to create the Circle wallet session.",
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