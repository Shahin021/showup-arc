import {
  getAddress,
  isAddress,
  parseUnits,
} from "viem";

const MAX_TITLE_BYTES = 320;
const MAX_DESCRIPTION_BYTES = 960;
const MAX_METADATA_URI_BYTES = 2048;
const MAX_RESOLUTION_HOURS = 168;

export const SHOWUP_CREATE_EVENT_ABI = [
  {
    type: "function",
    name: "createEvent",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "title",
        type: "string",
      },
      {
        name: "description",
        type: "string",
      },
      {
        name: "metadataURI",
        type: "string",
      },
      {
        name: "eventType",
        type: "uint8",
      },
      {
        name: "accessMode",
        type: "uint8",
      },
      {
        name: "depositAmount",
        type: "uint256",
      },
      {
        name: "totalPrice",
        type: "uint256",
      },
      {
        name: "capacity",
        type: "uint256",
      },
      {
        name: "cancellationDeadline",
        type: "uint64",
      },
      {
        name: "eventStart",
        type: "uint64",
      },
      {
        name: "eventEnd",
        type: "uint64",
      },
      {
        name: "resolutionDeadline",
        type: "uint64",
      },
      {
        name: "paymentDeadline",
        type: "uint64",
      },
    ],
    outputs: [],
  },
] as const;

export type ShowUpCreateEventInput = {
  title: string;
  description: string;
  metadataURI: string;
  eventType: "free" | "paid";
  accessMode: "public" | "inviteOnly";
  deposit: string;
  totalPrice: string;
  capacity: string;
  eventStart: string;
  eventEnd: string;
  cancellationHours: string;
  resolutionHours: string;
};

function getByteLength(
  value: string,
) {
  return new TextEncoder()
    .encode(value)
    .byteLength;
}

function parseWholeNumber(
  value: string,
  fieldName: string,
  allowZero = false,
) {
  const normalized =
    value.trim();

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

function parsePositiveHours(
  value: string,
  fieldName: string,
  maximum?: number,
) {
  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(
      `${fieldName} must be a positive whole number.`,
    );
  }

  if (
    maximum !== undefined &&
    parsed > maximum
  ) {
    throw new Error(
      `${fieldName} cannot exceed ${maximum} hours.`,
    );
  }

  return parsed;
}

function parseTimestamp(
  value: string,
  fieldName: string,
) {
  const milliseconds =
    Date.parse(value);

  if (
    !value ||
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
  value: string,
) {
  const metadataURI =
    value.trim();

  if (!metadataURI) {
    throw new Error(
      "Event metadata must be uploaded before creating the event.",
    );
  }

  if (
    getByteLength(metadataURI) >
    MAX_METADATA_URI_BYTES
  ) {
    throw new Error(
      "Event metadata URL is too long.",
    );
  }

  const parsedUrl =
    new URL(metadataURI);

  if (
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname.endsWith(
      ".public.blob.vercel-storage.com",
    )
  ) {
    throw new Error(
      "Event metadata must come from the connected Vercel Blob store.",
    );
  }

  return metadataURI;
}

export function getShowUpContractAddress() {
  const contractAddress =
    process.env
      .NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS
      ?.trim();

  if (
    !contractAddress ||
    !isAddress(contractAddress)
  ) {
    throw new Error(
      "ShowUp contract address is not configured correctly.",
    );
  }

  return getAddress(contractAddress);
}

export function buildCreateEventArgs(
  input: ShowUpCreateEventInput,
) {
  const title =
    input.title.trim();

  const description =
    input.description.trim();

  if (!title) {
    throw new Error(
      "Event title is required.",
    );
  }

  if (
    getByteLength(title) >
    MAX_TITLE_BYTES
  ) {
    throw new Error(
      "Event title is too long.",
    );
  }

  if (
    getByteLength(description) >
    MAX_DESCRIPTION_BYTES
  ) {
    throw new Error(
      "Event description is too long.",
    );
  }

  const metadataURI =
    validateMetadataURI(
      input.metadataURI,
    );

  const eventType =
    input.eventType === "paid"
      ? 1
      : 0;

  const accessMode =
    input.accessMode ===
    "inviteOnly"
      ? 1
      : 0;

  const depositUnits =
    parseUnits(
      input.deposit.trim(),
      6,
    );

  const totalPriceUnits =
    parseUnits(
      eventType === 1
        ? input.totalPrice.trim()
        : "0",
      6,
    );

  if (
    depositUnits < BigInt(0) ||
    totalPriceUnits < BigInt(0)
  ) {
    throw new Error(
      "USDC amounts cannot be negative.",
    );
  }

  if (
    eventType === 1 &&
    depositUnits <= BigInt(0)
  ) {
    throw new Error(
      "Upfront payment must be greater than zero.",
    );
  }

  if (
    eventType === 1 &&
    depositUnits >= totalPriceUnits
  ) {
    throw new Error(
      "Upfront payment must be lower than the total price.",
    );
  }

  const capacity =
    parseWholeNumber(
      input.capacity,
      "Capacity",
      true,
    );

  const eventStart =
    parseTimestamp(
      input.eventStart,
      "Event start",
    );

  const eventEnd =
    parseTimestamp(
      input.eventEnd,
      "Event end",
    );

  const cancellationHours =
    parsePositiveHours(
      input.cancellationHours,
      "Cancellation period",
    );

  const resolutionHours =
    parsePositiveHours(
      input.resolutionHours,
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

  if (eventEnd <= eventStart) {
    throw new Error(
      "Event end must be later than event start.",
    );
  }

  if (
    cancellationDeadline <= now
  ) {
    throw new Error(
      "The cancellation deadline must still be in the future.",
    );
  }

  if (
    eventType === 1 &&
    paymentDeadline !== 0 &&
    cancellationDeadline >
      paymentDeadline
  ) {
    throw new Error(
      "Paid events with upfront reservations require a cancellation period of at least 24 hours.",
    );
  }

  return [
    title,
    description,
    metadataURI,
    eventType,
    accessMode,
    depositUnits,
    totalPriceUnits,
    capacity,
    BigInt(cancellationDeadline),
    BigInt(eventStart),
    BigInt(eventEnd),
    BigInt(resolutionDeadline),
    BigInt(paymentDeadline),
  ] as const;
}
