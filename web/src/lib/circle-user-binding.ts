import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { SHOWUP_NETWORK } from "@/lib/showup-network";

/**
 * Binds a Circle user ID to the browser that created or restored it.
 *
 * Circle sessions are issued from a user ID. Without this binding, anyone
 * who learned an ID could open a session for that user. The ID is now only
 * accepted together with an httpOnly cookie signed by the server, which is
 * set when the user is created here or restored with a recovery code.
 */

const COOKIE_NAME = `showup_circle_user_${SHOWUP_NETWORK}`;
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function getSecret() {
  const secret = process.env.SHOWUP_WALLET_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "SHOWUP_WALLET_AUTH_SECRET must contain at least 32 characters.",
    );
  }
  return secret;
}

function sign(userId: string) {
  return createHmac("sha256", getSecret())
    .update(`showup-circle-user:${SHOWUP_NETWORK}:${userId}`)
    .digest("base64url");
}

export function setCircleUserCookie(
  response: NextResponse,
  request: Request,
  userId: string,
) {
  response.cookies.set({
    name: COOKIE_NAME,
    value: `${userId}.${sign(userId)}`,
    httpOnly: true,
    secure:
      new URL(request.url).protocol === "https:" ||
      process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Returns the Circle user ID this browser is bound to, if any. */
export function readBoundCircleUserId(request: NextRequest): string | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value ?? "";
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }

  const userId = raw.slice(0, separator);
  const provided = Buffer.from(raw.slice(separator + 1));
  const expected = Buffer.from(sign(userId));

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  return userId;
}

export function isBoundToCircleUser(request: NextRequest, userId: string) {
  return readBoundCircleUserId(request) === userId;
}
