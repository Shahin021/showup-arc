import { randomUUID } from "node:crypto";
import {
  BlobAccessError,
  put,
} from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENT_IMAGE_BYTES = 3_000_000;
const MAX_ORGANIZER_AVATAR_BYTES = 750_000;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

function readText(
  formData: FormData,
  fieldName: string,
  options: {
    required?: boolean;
    maxLength: number;
  },
) {
  const value = formData.get(fieldName);

  const normalized =
    typeof value === "string" ? value.trim() : "";

  if (options.required && !normalized) {
    throw new Error(
      `${fieldName} is required.`,
    );
  }

  if (normalized.length > options.maxLength) {
    throw new Error(
      `${fieldName} is too long.`,
    );
  }

  return normalized;
}

function readImage(
  formData: FormData,
  fieldName: string,
  maximumBytes: number,
) {
  const value = formData.get(fieldName);

  if (!(value instanceof File) || value.size === 0) {
    return null;
  }

  if (!ALLOWED_IMAGE_TYPES.has(value.type)) {
    throw new Error(
      `${fieldName} must be a JPEG, PNG, or WebP image.`,
    );
  }

  if (value.size > maximumBytes) {
    const maximumMegabytes = (
      maximumBytes /
      1_000_000
    ).toFixed(2);

    throw new Error(
      `${fieldName} must be smaller than ${maximumMegabytes} MB.`,
    );
  }

  return value;
}

function getImageExtension(contentType: string) {
  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  return "jpg";
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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const userToken = readText(
      formData,
      "userToken",
      {
        required: true,
        maxLength: 20_000,
      },
    );

    const walletId = readText(
      formData,
      "walletId",
      {
        required: true,
        maxLength: 200,
      },
    );

    const organizerName = readText(
      formData,
      "organizerName",
      {
        required: true,
        maxLength: 80,
      },
    );

    const fullDescription = readText(
      formData,
      "fullDescription",
      {
        required: true,
        maxLength: 5_000,
      },
    );

    const location = readText(
      formData,
      "location",
      {
        maxLength: 240,
      },
    );

    const organizerBio = readText(
      formData,
      "organizerBio",
      {
        maxLength: 1_200,
      },
    );

    const organizerWebsite = readText(
      formData,
      "organizerWebsite",
      {
        maxLength: 300,
      },
    );

    const organizerX = readText(
      formData,
      "organizerX",
      {
        maxLength: 100,
      },
    );

    const rules = readText(
      formData,
      "rules",
      {
        maxLength: 3_000,
      },
    );

    const eventImage = readImage(
      formData,
      "eventImage",
      MAX_EVENT_IMAGE_BYTES,
    );

    const organizerAvatar = readImage(
      formData,
      "organizerAvatar",
      MAX_ORGANIZER_AVATAR_BYTES,
    );

    const wallet = await verifyCircleWallet(
      userToken,
      walletId,
    );

    const metadataId = randomUUID();

    const basePath =
      `showup/events/` +
      `${wallet.address.toLowerCase()}/` +
      metadataId;

    let eventImageUrl = "";
    let organizerAvatarUrl = "";

    if (eventImage) {
      const extension = getImageExtension(
        eventImage.type,
      );

      const eventImageBlob = await put(
        `${basePath}/event-image.${extension}`,
        eventImage,
        {
          access: "public",
          addRandomSuffix: false,
        },
      );

      eventImageUrl = eventImageBlob.url;
    }

    if (organizerAvatar) {
      const extension = getImageExtension(
        organizerAvatar.type,
      );

      const organizerAvatarBlob = await put(
        `${basePath}/organizer-avatar.${extension}`,
        organizerAvatar,
        {
          access: "public",
          addRandomSuffix: false,
        },
      );

      organizerAvatarUrl =
        organizerAvatarBlob.url;
    }

    const metadata = {
      schema: "showup-event-metadata",
      version: 1,
      eventImage: eventImageUrl || null,
      fullDescription,
      location: location || null,
      organizer: {
        name: organizerName,
        avatar: organizerAvatarUrl || null,
        bio: organizerBio || null,
        website: organizerWebsite || null,
        x: organizerX || null,
        walletAddress: wallet.address,
      },
      rules: rules || null,
      storage: {
        provider: "vercel-blob",
        public: true,
      },
      createdAt: new Date().toISOString(),
    };

    const metadataFile = new Blob(
      [
        JSON.stringify(
          metadata,
          null,
          2,
        ),
      ],
      {
        type: "application/json",
      },
    );

    const metadataBlob = await put(
      `${basePath}/metadata.json`,
      metadataFile,
      {
        access: "public",
        addRandomSuffix: false,
      },
    );

    return NextResponse.json(
      {
        metadataURI: metadataBlob.url,
        metadata,
        assets: {
          eventImage: eventImageUrl || null,
          organizerAvatar:
            organizerAvatarUrl || null,
        },
        wallet: {
          id: wallet.id,
          address: wallet.address,
          blockchain: wallet.blockchain,
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
    console.error(
      "ShowUp metadata upload failed:",
      error,
    );

    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to upload event metadata.";

    const blobConfigurationError =
      error instanceof BlobAccessError ||
      message.includes("BLOB_") ||
      message.includes("OIDC");

    return NextResponse.json(
      {
        error: blobConfigurationError
          ? "Vercel Blob is not configured correctly for this deployment."
          : message,
      },
      {
        status: blobConfigurationError
          ? 500
          : 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
