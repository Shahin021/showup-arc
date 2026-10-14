import type { Address, Hex } from "viem";

import { SHOWUP_EIP712_DOMAIN } from "@/lib/showup-network";

/**
 * Self check-in codes. The organizer signs a short-lived EIP-712 message;
 * the venue shows it as a QR code linking to the check-in page; the attendee
 * submits it to ShowUpV6.checkIn from their own wallet.
 *
 * The signature is bound to the event, the attendee (or address(0) for an
 * open code anyone with a reservation can use), the validity window, the
 * chain and the contract (through the EIP-712 domain).
 */

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

/** Must match ShowUpV6.MAX_CHECK_IN_CODE_TTL. */
export const MAX_CHECK_IN_CODE_TTL_SECONDS = 15 * 60;

/**
 * issuedAt is backdated slightly so a code is valid immediately even if the
 * next block's timestamp is a little behind the server clock.
 */
export const CHECK_IN_ISSUED_AT_SKEW_SECONDS = 60;

export const CHECK_IN_TYPES = {
  CheckIn: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export type CheckInPayload = {
  eventId: bigint;
  attendee: Address;
  issuedAt: bigint;
  expiry: bigint;
};

export type SignedCheckInCode = CheckInPayload & {
  signature: Hex;
};

export function getViemCheckInTypedData(payload: CheckInPayload) {
  return {
    domain: SHOWUP_EIP712_DOMAIN,
    primaryType: "CheckIn" as const,
    types: CHECK_IN_TYPES,
    message: payload,
  };
}

/** Typed data in the JSON shape Circle's signTypedData endpoint expects. */
export function getCircleCheckInTypedData(payload: CheckInPayload) {
  return {
    domain: SHOWUP_EIP712_DOMAIN,
    primaryType: "CheckIn",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      CheckIn: CHECK_IN_TYPES.CheckIn,
    },
    message: {
      eventId: payload.eventId.toString(),
      attendee: payload.attendee,
      issuedAt: payload.issuedAt.toString(),
      expiry: payload.expiry.toString(),
    },
  };
}

/** Builds the validity window for a new code, capped by the event end. */
export function createCheckInWindow(
  nowSeconds: bigint,
  eventEnd: bigint,
) {
  const issuedAt = nowSeconds - BigInt(CHECK_IN_ISSUED_AT_SKEW_SECONDS);
  const maxExpiry = issuedAt + BigInt(MAX_CHECK_IN_CODE_TTL_SECONDS);
  const expiry = maxExpiry < eventEnd ? maxExpiry : eventEnd;
  return { issuedAt, expiry };
}

function toBase64Url(value: string) {
  const base64 =
    typeof window === "undefined"
      ? Buffer.from(value, "utf8").toString("base64")
      : window.btoa(value);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return typeof window === "undefined"
    ? Buffer.from(padded, "base64").toString("utf8")
    : window.atob(padded);
}

/** Compact, URL-safe encoding used in the QR code link. */
export function encodeCheckInCode(code: SignedCheckInCode) {
  return toBase64Url(
    JSON.stringify({
      a: code.attendee,
      i: code.issuedAt.toString(),
      e: code.expiry.toString(),
      s: code.signature,
    }),
  );
}

export function decodeCheckInCode(
  eventId: bigint,
  encoded: string,
): SignedCheckInCode {
  let parsed: { a?: unknown; i?: unknown; e?: unknown; s?: unknown };

  try {
    parsed = JSON.parse(fromBase64Url(encoded));
  } catch {
    throw new Error("This check-in code is not valid.");
  }

  const attendee = typeof parsed.a === "string" ? parsed.a : "";
  const issuedAt = typeof parsed.i === "string" ? parsed.i : "";
  const expiry = typeof parsed.e === "string" ? parsed.e : "";
  const signature = typeof parsed.s === "string" ? parsed.s : "";

  if (
    !/^0x[0-9a-fA-F]{40}$/.test(attendee) ||
    !/^\d+$/.test(issuedAt) ||
    !/^\d+$/.test(expiry) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)
  ) {
    throw new Error("This check-in code is not valid.");
  }

  return {
    eventId,
    attendee: attendee as Address,
    issuedAt: BigInt(issuedAt),
    expiry: BigInt(expiry),
    signature: signature as Hex,
  };
}

export function checkInPath(eventId: string | bigint, code: SignedCheckInCode) {
  return `/events/${eventId.toString()}/check-in?code=${encodeCheckInCode(code)}`;
}
