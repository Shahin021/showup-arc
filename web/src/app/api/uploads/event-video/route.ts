import { randomUUID } from "node:crypto";
import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEO_BYTES = 50_000_000;
const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

type UploadClientPayload = {
  userToken?: unknown;
  walletId?: unknown;
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

  if (!userToken || userToken.length > 20_000) {
    throw new Error(
      "A valid Circle user token is required.",
    );
  }

  if (!walletId || walletId.length > 200) {
    throw new Error(
      "A valid Circle wallet ID is required.",
    );
  }

  return {
    userToken,
    walletId,
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
  walletId: string,
) {
  const expectedPrefix =
    `showup/videos/${walletId}/`;

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

export async function POST(request: Request) {
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
        const {
          userToken,
          walletId,
        } = parseClientPayload(clientPayload);

        const wallet = await verifyCircleWallet(
          userToken,
          walletId,
        );

        validatePathname(pathname, walletId);

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
