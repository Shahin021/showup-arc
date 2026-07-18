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

type PublicWallet = {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
  accountType?: string;
  createDate?: string;
  updateDate?: string;
  name?: string;
  refId?: string;
};

function getCircleApiKey() {
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not configured.");
  }

  return apiKey;
}

function toPublicWallet(wallet: CircleWallet): PublicWallet {
  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    state: wallet.state,
    accountType: wallet.accountType,
    createDate: wallet.createDate,
    updateDate: wallet.updateDate,
    name: wallet.name,
    refId: wallet.refId,
  };
}

async function fetchWalletPage({
  apiKey,
  userToken,
  pageAfter,
}: {
  apiKey: string;
  userToken: string;
  pageAfter?: string;
}) {
  const circleUrl = new URL("https://api.circle.com/v1/w3s/wallets");

  circleUrl.searchParams.set("blockchain", "ARC-TESTNET");
  circleUrl.searchParams.set("pageSize", "50");
  circleUrl.searchParams.set("order", "DESC");

  if (pageAfter) {
    circleUrl.searchParams.set("pageAfter", pageAfter);
  }

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

  const circleData = (await circleResponse
    .json()
    .catch(() => ({}))) as CircleWalletsResponse;

  if (!circleResponse.ok) {
    throw new Error(
      circleData.message || "Circle could not retrieve the wallets.",
    );
  }

  return circleData.data?.wallets ?? [];
}

async function fetchAllArcWallets({
  apiKey,
  userToken,
}: {
  apiKey: string;
  userToken: string;
}) {
  const wallets: CircleWallet[] = [];
  const seenWalletIds = new Set<string>();

  let pageAfter: string | undefined;

  /*
   * Circle supports up to 50 wallets per request.
   * This loop continues requesting pages until no new page is available.
   * The 20-page guard prevents an accidental infinite loop.
   */
  for (let page = 0; page < 20; page += 1) {
    const pageWallets = await fetchWalletPage({
      apiKey,
      userToken,
      pageAfter,
    });

    const newWallets = pageWallets.filter((wallet) => {
      if (!wallet.id || seenWalletIds.has(wallet.id)) {
        return false;
      }

      seenWalletIds.add(wallet.id);
      return true;
    });

    wallets.push(...newWallets);

    if (pageWallets.length < 50) {
      break;
    }

    const lastWallet = pageWallets.at(-1);

    if (!lastWallet?.id || lastWallet.id === pageAfter) {
      break;
    }

    pageAfter = lastWallet.id;
  }

  return wallets
    .filter(
      (wallet) =>
        wallet.id &&
        wallet.address &&
        wallet.blockchain === "ARC-TESTNET",
    )
    .sort((walletA, walletB) => {
      const walletALive = walletA.state === "LIVE";
      const walletBLive = walletB.state === "LIVE";

      if (walletALive !== walletBLive) {
        return walletALive ? -1 : 1;
      }

      const dateA = walletA.createDate
        ? new Date(walletA.createDate).getTime()
        : 0;

      const dateB = walletB.createDate
        ? new Date(walletB.createDate).getTime()
        : 0;

      return dateB - dateA;
    });
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

    const circleWallets = await fetchAllArcWallets({
      apiKey,
      userToken,
    });

    if (circleWallets.length === 0) {
      return NextResponse.json(
        {
          wallets: [],
          wallet: null,
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

    const wallets = circleWallets.map(toPublicWallet);

    const activeFallbackWallet =
      wallets.find((wallet) => wallet.state === "LIVE") ?? wallets[0];

    return NextResponse.json(
      {
        /*
         * New response used by the upcoming multi-wallet interface.
         */
        wallets,

        /*
         * Kept temporarily so the current frontend continues working
         * until we replace circle-wallet-button.tsx.
         */
        wallet: activeFallbackWallet,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Circle wallet list lookup failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to retrieve the Circle wallets.";

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