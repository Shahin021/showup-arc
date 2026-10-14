import "server-only";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import { arcPublicClient } from "@/lib/arc-public-client";
import {
  getViemCheckInTypedData,
  MAX_CHECK_IN_CODE_TTL_SECONDS,
  ZERO_ADDRESS,
  type SignedCheckInCode,
} from "@/lib/showup-checkin";
import {
  ShowUpApiError,
  type ShowUpEventDetails,
} from "@/lib/showup-server";

const RESERVED = 1;
const COMPLETED = 8;

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Parses a check-in code sent as JSON fields by the browser. */
export function parseCheckInCode(
  eventId: bigint,
  input: unknown,
): SignedCheckInCode {
  const value = (input ?? {}) as Record<string, unknown>;
  const attendee = readString(value.attendee);
  const issuedAt = readString(value.issuedAt);
  const expiry = readString(value.expiry);
  const signature = readString(value.signature);

  if (
    !isAddress(attendee) ||
    !/^\d+$/.test(issuedAt) ||
    !/^\d+$/.test(expiry) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)
  ) {
    throw new ShowUpApiError("The check-in code is not valid.");
  }

  return {
    eventId,
    attendee: getAddress(attendee),
    issuedAt: BigInt(issuedAt),
    expiry: BigInt(expiry),
    signature: signature as Hex,
  };
}

/**
 * Mirrors the checks ShowUpV6.checkIn performs, so a code that would revert
 * is rejected before the attendee is asked to approve a transaction.
 * The signature is verified with ERC-1271 support for smart wallets.
 */
export async function validateCheckInCode(
  code: SignedCheckInCode,
  event: ShowUpEventDetails,
  options: { submitter?: Address; nowSeconds?: bigint } = {},
) {
  const now = options.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));

  if (event.cancelled) {
    throw new ShowUpApiError("This event was cancelled.");
  }

  if (code.expiry <= code.issuedAt) {
    throw new ShowUpApiError("The check-in code is not valid.");
  }

  if (code.expiry - code.issuedAt > BigInt(MAX_CHECK_IN_CODE_TTL_SECONDS)) {
    throw new ShowUpApiError("The check-in code is valid for too long.");
  }

  if (now >= code.expiry) {
    throw new ShowUpApiError(
      "This check-in code has expired. Ask the organizer to show a new one.",
    );
  }

  if (
    options.submitter &&
    code.attendee !== ZERO_ADDRESS &&
    code.attendee.toLowerCase() !== options.submitter.toLowerCase()
  ) {
    throw new ShowUpApiError(
      "This personal check-in code belongs to a different wallet.",
      403,
    );
  }

  const validSignature = await arcPublicClient.verifyTypedData({
    address: event.organizer,
    ...getViemCheckInTypedData(code),
    signature: code.signature,
  });

  if (!validSignature) {
    throw new ShowUpApiError(
      "This check-in code was not signed by the event organizer.",
      403,
    );
  }
}

/** The reservation statuses ShowUpV6 accepts for check-in. */
export function canCheckIn(eventType: number, reservationStatus: number) {
  return eventType === 0
    ? reservationStatus === RESERVED
    : reservationStatus === COMPLETED;
}

export function requireCheckInWindow(event: ShowUpEventDetails, now?: bigint) {
  const nowSeconds = now ?? BigInt(Math.floor(Date.now() / 1000));

  if (nowSeconds < event.eventStart) {
    throw new ShowUpApiError("Check-in opens when the event starts.");
  }

  if (nowSeconds >= event.eventEnd) {
    throw new ShowUpApiError("Check-in closed when the event ended.");
  }
}
