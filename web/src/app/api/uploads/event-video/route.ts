import { randomUUID } from "node:crypto";
import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import {
  NextRequest,
  NextResponse,
} from "next/server";
import { isAddress } from "viem";

import {
  readWalletSession,
  SHOWUP_WALLET_SESSION_COOKIE,
} from "@/lib/showup-wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEO_BYTES = 50_000_000;
const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

type UploadClientPayload = {
  userToken?: unknown;
  walletId?: unknown;
  walletAddress?: unknown;
};

type CircleWallet = {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
};

type CircleWalletsResponse = {
  data?: {
    wallets?: CircleWallet[];
  };
  code?: number;
  message?: string;
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

  const host =
    readForwardedHeader(
      request.headers.get(
        "x-forwarded-host",
      ),
    ) ||
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

function readBrowserWallet(
  request: NextRequest,
  expectedAddress: `0x${string}`,
): CircleWallet | null {
  const session =
    readWalletSession(
      request.cookies.get(
        SHOWUP_WALLET_SESSION_COOKIE,
      )?.value,
    );

  if (!session) {
    return null;
  }

  const requestUrl =
    getPublicRequestUrl(request);

  if (
    session.domain !==
    requestUrl.host.toLowerCase()
  ) {
    throw new Error(
      "The browser wallet session does not match this application.",
    );
  }

  if (
    session.address.toLowerCase() !==
    expectedAddress.toLowerCase()
  ) {
    throw new Error(
      "The browser wallet session does not match the requested wallet.",
    );
  }

  return {
    id:
      `browser:${session.address.toLowerCase()}`,
    address: session.address,
    blockchain: "ARC-TESTNET",
    state: "LIVE",
  };
}

function getCircleApiKey() {
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "CIRCLE_API_KEY is not configured.",
    );
  }

  return apiKey;
}

function parseClientPayload(
  clientPayload: string | null | undefined,
) {
  let parsed: UploadClientPayload;

  try {
    parsed = JSON.parse(
      clientPayload || "{}",
    ) as UploadClientPayload;
  } catch {
    throw new Error(
      "The video upload authorization payload is invalid.",
    );
  }

  const userToken =
    typeof parsed.userToken === "string"
      ? parsed.userToken.trim()
      : "";

  const walletId =
    typeof parsed.walletId === "string"
      ? parsed.walletId.trim()
      : "";

  const walletAddress =
    typeof parsed.walletAddress === "string"
      ? parsed.walletAddress.trim()
      : "";

  const hasCircleCredentials =
    Boolean(userToken || walletId);

  if (hasCircleCredentials) {
    if (
      !userToken ||
      userToken.length > 20_000
    ) {
      throw new Error(
        "A valid Circle user token is required.",
      );
    }

    if (
      !walletId ||
      walletId.length > 200
    ) {
      throw new Error(
        "A valid Circle wallet ID is required.",
      );
    }

    return {
      kind: "circle" as const,
      userToken,
      walletId,
    };
  }

  if (!isAddress(walletAddress)) {
    throw new Error(
      "A valid browser wallet address is required.",
    );
  }

  return {
    kind: "browser" as const,
    walletAddress,
  };
}

async function verifyCircleWallet(
  userToken: string,
  walletId: string,
) {
  const apiKey = getCircleApiKey();

  const circleUrl = new URL(
    "https://api.circle.com/v1/w3s/wallets",
  );

  circleUrl.searchParams.set(
    "blockchain",
    "ARC-TESTNET",
  );

  circleUrl.searchParams.set("pageSize", "10");
  circleUrl.searchParams.set("order", "DESC");

  const response = await fetch(circleUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-User-Token": userToken,
      "X-Request-Id": randomUUID(),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const data =
    (await response
      .json()
      .catch(() => ({}))) as CircleWalletsResponse;

  if (!response.ok) {
    throw new Error(
      data.message ||
        "Circle could not verify the connected wallet.",
    );
  }

  const wallets = data.data?.wallets ?? [];

  const wallet = wallets.find(
    (item) =>
      item.id === walletId &&
      item.blockchain === "ARC-TESTNET" &&
      item.state === "LIVE",
  );

  if (!wallet) {
    throw new Error(
      "The connected Arc Testnet wallet could not be verified.",
    );
  }

  return wallet;
}

function validatePathname(
  pathname: string,
  walletPathKey: string,
) {
  const expectedPrefix =
    `showup/videos/${walletPathKey}/`;

  if (!pathname.startsWith(expectedPrefix)) {
    throw new Error(
      "The requested video upload path is invalid.",
    );
  }

  const fileName = pathname.slice(
    expectedPrefix.length,
  );

  if (
    !/^[a-zA-Z0-9_-]{1,120}\.(mp4|webm)$/i.test(
      fileName,
    )
  ) {
    throw new Error(
      "The video filename or extension is invalid.",
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body =
      (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,

      onBeforeGenerateToken: async (
        pathname,
        clientPayload,
      ) => {
        const authorization =
          parseClientPayload(
            clientPayload,
          );

        const wallet =
          authorization.kind === "circle"
            ? await verifyCircleWallet(
                authorization.userToken,
                authorization.walletId,
              )
            : readBrowserWallet(
                request,
                authorization.walletAddress,
              );

        if (!wallet) {
          throw new Error(
            "Connect and authorize a wallet before uploading an event video.",
          );
        }

        const walletPathKey =
          authorization.kind === "circle"
            ? authorization.walletId
            : authorization.walletAddress
                .toLowerCase();

        validatePathname(
          pathname,
          walletPathKey,
        );

        return {
          allowedContentTypes: [
            "video/mp4",
            "video/webm",
          ],

          maximumSizeInBytes:
            MAX_VIDEO_BYTES,

          addRandomSuffix: true,

          validUntil:
            Date.now() +
            TOKEN_LIFETIME_MS,

          tokenPayload: JSON.stringify({
            purpose: "showup-event-video",
            walletKind:
              authorization.kind,
            walletId: wallet.id,
            walletAddress: wallet.address,
            blockchain: wallet.blockchain,
          }),
        };
      },

      onUploadCompleted: async ({
        blob,
        tokenPayload,
      }) => {
        let authorization:
          | Record<string, unknown>
          | null = null;

        try {
          authorization = tokenPayload
            ? JSON.parse(tokenPayload)
            : null;
        } catch {
          authorization = null;
        }

        console.info(
          "ShowUp event video uploaded:",
          {
            url: blob.url,
            pathname: blob.pathname,
            contentType: blob.contentType,
            authorization,
          },
        );
      },
    });

    return NextResponse.json(jsonResponse, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      "ShowUp video upload authorization failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          error.message
            ? error.message
            : "Unable to authorize the video upload.",
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
