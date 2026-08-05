import { NextResponse } from "next/server";
import { isAddress } from "viem";

import {
  createWalletChallenge,
  SHOWUP_WALLET_CHALLENGE_COOKIE,
  WALLET_CHALLENGE_MAX_AGE_SECONDS,
} from "@/lib/showup-wallet-auth";

type ChallengeRequestBody = {
  address?: unknown;
};

function jsonError(
  message: string,
  status: number,
) {
  return NextResponse.json(
    {
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(
  request: Request,
) {
  try {
    const requestUrl =
      new URL(request.url);

    const requestOrigin =
      requestUrl.origin;

    const originHeader =
      request.headers.get("origin");

    if (originHeader) {
      let origin: URL;

      try {
        origin = new URL(originHeader);
      } catch {
        return jsonError(
          "The request origin is invalid.",
          403,
        );
      }

      if (
        origin.origin !== requestOrigin
      ) {
        return jsonError(
          "Cross-origin wallet authorization is not allowed.",
          403,
        );
      }
    }

    let body: ChallengeRequestBody;

    try {
      body =
        (await request.json()) as ChallengeRequestBody;
    } catch {
      return jsonError(
        "A valid JSON request body is required.",
        400,
      );
    }

    if (
      typeof body.address !== "string" ||
      !isAddress(body.address)
    ) {
      return jsonError(
        "A valid wallet address is required.",
        400,
      );
    }

    const challenge =
      createWalletChallenge({
        address: body.address,
        domain: requestUrl.host,
        uri: requestOrigin,
      });

    const response =
      NextResponse.json(
        {
          address:
            challenge.payload.address,
          message:
            challenge.message,
          expiresAt:
            challenge.payload.expiresAt,
        },
        {
          status: 200,
          headers: {
            "Cache-Control":
              "no-store, max-age=0",
          },
        },
      );

    response.cookies.set({
      name:
        SHOWUP_WALLET_CHALLENGE_COOKIE,
      value: challenge.token,
      httpOnly: true,
      secure:
        requestUrl.protocol ===
          "https:" ||
        process.env.NODE_ENV ===
          "production",
      sameSite: "strict",
      path: "/",
      maxAge:
        WALLET_CHALLENGE_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    console.error(
      "ShowUp wallet challenge creation failed:",
      error,
    );

    return jsonError(
      "Unable to create the wallet authorization challenge.",
      500,
    );
  }
}
