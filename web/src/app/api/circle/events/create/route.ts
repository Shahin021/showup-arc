import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE_EVENT_SIGNATURE =
  "createEvent(string,string,string,uint8,uint256,uint256,uint256,uint64,uint64,uint64,uint64,uint64)";

const MAX_TITLE_BYTES = 320;
const MAX_DESCRIPTION_BYTES = 960;
const MAX_METADATA_URI_BYTES = 2048;
const MAX_RESOLUTION_HOURS = 168;

type CreateEventRequest = {
  userToken?: unknown;
  walletId?: unknown;
  title?: unknown;
  description?: unknown;
  metadataURI?: unknown;
  eventType?: unknown;
  deposit?: unknown;
  totalPrice?: unknown;
  capacity?: unknown;
  eventStart?: unknown;
  eventEnd?: unknown;
  cancellationHours?: unknown;
  resolutionHours?: unknown;
};

type CircleChallengeResponse = {
  data?: {
    challengeId?: string;
  };
  code?: number;
  message?: string;
};

function getCircleApiKey() {
  const apiKey =
    process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "CIRCLE_API_KEY is not configured.",
    );
  }

  return apiKey;
}

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function parseEventType(
  value: unknown,
) {
  const normalized =
    typeof value === "string" ||
    typeof value === "number"
      ? String(value)
          .trim()
          .toLowerCase()
      : "";

  if (
    normalized === "0" ||
    normalized === "free"
  ) {
    return 0;
  }

  if (
    normalized === "1" ||
    normalized === "paid"
  ) {
    return 1;
  }

  throw new Error(
    "Event type must be Free or Paid.",
  );
}

function parsePositiveInteger(
  value: unknown,
  fieldName: string,
  allowZero = false,
) {
  const normalized =
    typeof value === "number" ||
    typeof value === "string"
      ? String(value).trim()
      : "";

  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `${fieldName} must be a whole number.`,
    );
  }

  const parsed =
    BigInt(normalized);

  if (
    allowZero
      ? parsed < BigInt(0)
      : parsed <= BigInt(0)
  ) {
    throw new Error(
      allowZero
        ? `${fieldName} cannot be negative.`
        : `${fieldName} must be greater than zero.`,
    );
  }

  return parsed;
}

function parseUsdcUnits(
  value: unknown,
  fieldName: string,
  allowZero: boolean,
) {
  const normalized =
    typeof value === "number" ||
    typeof value === "string"
      ? String(value).trim()
      : "";

  if (
    !/^\d+(?:\.\d{1,6})?$/.test(
      normalized,
    )
  ) {
    throw new Error(
      `${fieldName} must be a valid USDC amount with up to 6 decimal places.`,
    );
  }

  const [
    whole,
    fraction = "",
  ] = normalized.split(".");

  const paddedFraction =
    `${fraction}000000`.slice(
      0,
      6,
    );

  const units =
    BigInt(whole) * BigInt(1_000_000) +
    BigInt(paddedFraction);

  if (
    allowZero
      ? units < BigInt(0)
      : units <= BigInt(0)
  ) {
    throw new Error(
      allowZero
        ? `${fieldName} cannot be negative.`
        : `${fieldName} must be greater than zero.`,
    );
  }

  return units;
}

function parseHours(
  value: unknown,
  fieldName: string,
  maximum?: number,
) {
  const normalized =
    typeof value === "number" ||
    typeof value === "string"
      ? Number(value)
      : Number.NaN;

  if (
    !Number.isSafeInteger(
      normalized,
    ) ||
    normalized <= 0
  ) {
    throw new Error(
      `${fieldName} must be a positive whole number.`,
    );
  }

  if (
    typeof maximum === "number" &&
    normalized > maximum
  ) {
    throw new Error(
      `${fieldName} cannot exceed ${maximum} hours.`,
    );
  }

  return normalized;
}

function parseTimestamp(
  value: unknown,
  fieldName: string,
) {
  const normalized =
    readString(value);

  const milliseconds =
    Date.parse(normalized);

  if (
    !normalized ||
    Number.isNaN(milliseconds)
  ) {
    throw new Error(
      `${fieldName} is invalid.`,
    );
  }

  return Math.floor(
    milliseconds / 1000,
  );
}

function validateMetadataURI(
  value: unknown,
) {
  const metadataURI =
    readString(value);

  if (!metadataURI) {
    throw new Error(
      "Event metadata must be uploaded before creating the event.",
    );
  }

  if (
    Buffer.byteLength(
      metadataURI,
      "utf8",
    ) > MAX_METADATA_URI_BYTES
  ) {
    throw new Error(
      "Event metadata URL is too long.",
    );
  }

  let parsedURL: URL;

  try {
    parsedURL =
      new URL(metadataURI);
  } catch {
    throw new Error(
      "Event metadata URL is invalid.",
    );
  }

  if (
    parsedURL.protocol !== "https:"
  ) {
    throw new Error(
      "Event metadata URL must use HTTPS.",
    );
  }

  if (
    !parsedURL.hostname.endsWith(
      ".public.blob.vercel-storage.com",
    )
  ) {
    throw new Error(
      "Event metadata must come from the connected Vercel Blob store.",
    );
  }

  return metadataURI;
}

function getErrorMessage(
  error: unknown,
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "Circle could not create the transaction challenge.";
}

export async function POST(
  request: Request,
) {
  try {
    const apiKey =
      getCircleApiKey();

    const contractAddress =
      process.env
        .NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS
        ?.trim();

    if (
      !contractAddress ||
      !/^0x[a-fA-F0-9]{40}$/.test(
        contractAddress,
      )
    ) {
      throw new Error(
        "ShowUp contract address is not configured correctly.",
      );
    }

    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as CreateEventRequest;

    const userToken =
      readString(body.userToken);

    const walletId =
      readString(body.walletId);

    const title =
      readString(body.title);

    const description =
      readString(
        body.description,
      );

    const metadataURI =
      validateMetadataURI(
        body.metadataURI,
      );

    if (!userToken) {
      return NextResponse.json(
        {
          error:
            "A valid Circle session is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (!walletId) {
      return NextResponse.json(
        {
          error:
            "Connect your Circle wallet before creating an event.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (!title) {
      return NextResponse.json(
        {
          error:
            "Event title is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      Buffer.byteLength(
        title,
        "utf8",
      ) > MAX_TITLE_BYTES
    ) {
      return NextResponse.json(
        {
          error:
            "Event title is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      Buffer.byteLength(
        description,
        "utf8",
      ) > MAX_DESCRIPTION_BYTES
    ) {
      return NextResponse.json(
        {
          error:
            "Event description is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const eventType =
      parseEventType(
        body.eventType,
      );

    const depositUnits =
      parseUsdcUnits(
        body.deposit ??
          (eventType === 0
            ? "0"
            : ""),
        eventType === 0
          ? "Commitment deposit"
          : "Upfront payment",
        eventType === 0,
      );

    const totalPriceUnits =
      parseUsdcUnits(
        body.totalPrice ??
          (eventType === 0
            ? "0"
            : ""),
        "Total price",
        eventType === 0,
      );

    if (
      eventType === 0 &&
      totalPriceUnits !== BigInt(0)
    ) {
      throw new Error(
        "Total price must be zero for a Free event.",
      );
    }

    if (
      eventType === 1 &&
      depositUnits >=
        totalPriceUnits
    ) {
      throw new Error(
        "Upfront payment must be lower than the total price.",
      );
    }

    const capacity =
      parsePositiveInteger(
        body.capacity,
        "Capacity",
        true,
      );

    const eventStart =
      parseTimestamp(
        body.eventStart,
        "Event start",
      );

    const eventEnd =
      parseTimestamp(
        body.eventEnd,
        "Event end",
      );

    const cancellationHours =
      parseHours(
        body.cancellationHours,
        "Cancellation period",
      );

    const resolutionHours =
      parseHours(
        body.resolutionHours,
        "Resolution period",
        MAX_RESOLUTION_HOURS,
      );

    const cancellationDeadline =
      eventStart -
      cancellationHours *
        60 *
        60;

    const resolutionDeadline =
      eventEnd +
      resolutionHours *
        60 *
        60;

    const now =
      Math.floor(
        Date.now() / 1000,
      );

    const paymentDeadline =
      eventType === 1 &&
      eventStart - now >
        24 * 60 * 60
        ? eventStart -
          24 *
            60 *
            60
        : 0;

    if (
      eventEnd <= eventStart
    ) {
      return NextResponse.json(
        {
          error:
            "Event end must be later than event start.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      cancellationDeadline <=
      now
    ) {
      return NextResponse.json(
        {
          error:
            "The cancellation deadline must still be in the future. Move the event later or shorten the cancellation period.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      eventType === 1 &&
      paymentDeadline !== 0 &&
      cancellationDeadline >
        paymentDeadline
    ) {
      return NextResponse.json(
        {
          error:
            "For Paid events with upfront reservations, the cancellation period must be at least 24 hours.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      !(
        cancellationDeadline <
          eventStart &&
        eventStart <
          eventEnd &&
        eventEnd <
          resolutionDeadline
      )
    ) {
      return NextResponse.json(
        {
          error:
            "The event timeline is invalid.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const idempotencyKey =
      randomUUID();

    const refId =
      `showup-create-${randomUUID()}`;

    const createdAfter =
      new Date(
        Date.now() - 5_000,
      ).toISOString();

    const circleResponse =
      await fetch(
        "https://api.circle.com/v1/w3s/user/transactions/contractExecution",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "X-User-Token":
              userToken,
            "X-Request-Id":
              randomUUID(),
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            idempotencyKey,
            walletId,
            contractAddress,
            abiFunctionSignature:
              CREATE_EVENT_SIGNATURE,
            abiParameters: [
              title,
              description,
              metadataURI,
              String(eventType),
              depositUnits.toString(),
              totalPriceUnits.toString(),
              capacity.toString(),
              String(
                cancellationDeadline,
              ),
              String(eventStart),
              String(eventEnd),
              String(
                resolutionDeadline,
              ),
              String(
                paymentDeadline,
              ),
            ],
            feeLevel: "MEDIUM",
            refId,
          }),
        },
      );

    const circleData =
      (await circleResponse
        .json()
        .catch(
          () => ({}),
        )) as CircleChallengeResponse;

    if (!circleResponse.ok) {
      console.error(
        "Circle contract execution challenge failed:",
        {
          status:
            circleResponse.status,
          code:
            circleData.code,
          message:
            circleData.message,
        },
      );

      return NextResponse.json(
        {
          error:
            circleData.message ||
            "Circle could not create the transaction challenge.",
        },
        {
          status:
            circleResponse.status,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const challengeId =
      circleData.data
        ?.challengeId;

    if (!challengeId) {
      throw new Error(
        "Circle did not return a contract execution challenge.",
      );
    }

    return NextResponse.json(
      {
        challengeId,
        refId,
        createdAfter,
                paymentDeadline:
            String(paymentDeadline),
        },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "ShowUp event challenge creation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          getErrorMessage(error),
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}
