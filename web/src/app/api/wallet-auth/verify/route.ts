import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  isAddress,
  isHex,
} from "viem";

import { arcPublicClient } from "@/lib/arc-public-client";
import {
  buildWalletChallengeMessage,
  createWalletSession,
  readWalletChallenge,
  SHOWUP_WALLET_CHALLENGE_COOKIE,
  SHOWUP_WALLET_SESSION_COOKIE,
  WALLET_SESSION_MAX_AGE_SECONDS,
} from "@/lib/showup-wallet-auth";

type VerifyRequestBody = {
  address?: unknown;
  signature?: unknown;
};

function readForwardedHeader(
  value: string | null,
) {
  return (
    value
      ?.split(",")[0]
      ?.trim() ?? ""
  );
}

function getPublicRequestUrl(
  request: Request,
) {
  const internalUrl =
    new URL(request.url);

  const forwardedHost =
    readForwardedHeader(
      request.headers.get(
        "x-forwarded-host",
      ),
    );

  const host =
    forwardedHost ||
    request.headers
      .get("host")
      ?.trim() ||
    internalUrl.host;

  const forwardedProtocol =
    readForwardedHeader(
      request.headers.get(
        "x-forwarded-proto",
      ),
    ).toLowerCase();

  const protocol =
    forwardedProtocol === "http" ||
    forwardedProtocol === "https"
      ? `${forwardedProtocol}:`
      : internalUrl.protocol;

  return new URL(
    `${protocol}//${host}`,
  );
}

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
  request: NextRequest,
) {
  try {
    const requestUrl =
      getPublicRequestUrl(request);

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

      const fetchSite =
        request.headers
          .get("sec-fetch-site")
          ?.trim()
          .toLowerCase();

      const isSameOriginRequest =
        fetchSite === "same-origin" ||
        origin.origin ===
          requestUrl.origin;

      if (!isSameOriginRequest) {
        return jsonError(
          "Cross-origin wallet authorization is not allowed.",
          403,
        );
      }
    }

    let body: VerifyRequestBody;

    try {
      body =
        (await request.json()) as VerifyRequestBody;
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

    if (
      typeof body.signature !== "string" ||
      !isHex(body.signature)
    ) {
      return jsonError(
        "A valid wallet signature is required.",
        400,
      );
    }

    const challengeToken =
      request.cookies.get(
        SHOWUP_WALLET_CHALLENGE_COOKIE,
      )?.value;

    const challenge =
      readWalletChallenge(
        challengeToken,
      );

    if (!challenge) {
      return jsonError(
        "The wallet authorization challenge is missing or expired.",
        401,
      );
    }

    if (
      challenge.domain !==
        requestUrl.host.toLowerCase() ||
      challenge.uri !==
        requestUrl.origin ||
      challenge.address.toLowerCase() !==
        body.address.toLowerCase()
    ) {
      return jsonError(
        "The wallet authorization challenge does not match this request.",
        401,
      );
    }

    const message =
      buildWalletChallengeMessage(
        challenge,
      );

    let verified = false;

    try {
      verified =
        await arcPublicClient.verifyMessage({
          address: challenge.address,
          message,
          signature: body.signature,
        });
    } catch (error) {
      console.error(
        "ShowUp wallet signature verification failed:",
        error,
      );

      return jsonError(
        "Unable to verify the wallet signature.",
        503,
      );
    }

    if (!verified) {
      return jsonError(
        "The wallet signature is invalid.",
        401,
      );
    }

    const session =
      createWalletSession({
        address: challenge.address,
        domain: requestUrl.host,
      });

    const secure =
      requestUrl.protocol === "https:" ||
      process.env.NODE_ENV ===
        "production";

    const response =
      NextResponse.json(
        {
          address:
            session.payload.address,
          expiresAt:
            session.payload.expiresAt,
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
        SHOWUP_WALLET_SESSION_COOKIE,
      value: session.token,
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge:
        WALLET_SESSION_MAX_AGE_SECONDS,
    });

    response.cookies.set({
      name:
        SHOWUP_WALLET_CHALLENGE_COOKIE,
      value: "",
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error(
      "ShowUp wallet authorization failed:",
      error,
    );

    return jsonError(
      "Unable to authorize the wallet.",
      500,
    );
  }
}
