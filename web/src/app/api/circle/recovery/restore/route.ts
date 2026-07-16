import { NextResponse } from "next/server";
import { readShowUpRecoveryCode } from "@/lib/showup-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RestoreRequest = {
  recoveryCode?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request
      .json()
      .catch(() => ({}))) as RestoreRequest;

    const recoveryCode =
      typeof body.recoveryCode === "string"
        ? body.recoveryCode.trim()
        : "";

    if (!recoveryCode) {
      return NextResponse.json(
        {
          error: "A ShowUp recovery code is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const recoveryPayload =
      readShowUpRecoveryCode(recoveryCode);

    return NextResponse.json(
      {
        userId: recoveryPayload.userId,
        createdAt: recoveryPayload.createdAt,
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
      "ShowUp wallet restoration failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to restore the ShowUp wallet.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}