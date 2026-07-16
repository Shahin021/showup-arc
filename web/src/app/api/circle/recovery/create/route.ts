import { NextResponse } from "next/server";
import { createShowUpRecoveryCode } from "@/lib/showup-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecoveryCodeRequest = {
  userId?: unknown;
};

function isValidCircleUserId(userId: string): boolean {
  return (
    userId.length >= 5 &&
    userId.length <= 50 &&
    /^[a-zA-Z0-9_-]+$/.test(userId)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request
      .json()
      .catch(() => ({}))) as RecoveryCodeRequest;

    const userId =
      typeof body.userId === "string"
        ? body.userId.trim()
        : "";

    if (!userId || !isValidCircleUserId(userId)) {
      return NextResponse.json(
        {
          error: "A valid Circle user ID is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const recoveryCode =
      createShowUpRecoveryCode(userId);

    return NextResponse.json(
      {
        recoveryCode,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "ShowUp recovery code creation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to create the ShowUp recovery code.",
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