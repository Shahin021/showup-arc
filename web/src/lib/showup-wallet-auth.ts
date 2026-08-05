import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  getAddress,
  isAddress,
} from "viem";
import { arcTestnet } from "viem/chains";

export const SHOWUP_WALLET_CHALLENGE_COOKIE =
  "showup_wallet_challenge";

export const WALLET_CHALLENGE_MAX_AGE_SECONDS =
  5 * 60;

export const SHOWUP_WALLET_SESSION_COOKIE =
  "showup_wallet_session";

export const WALLET_SESSION_MAX_AGE_SECONDS =
  15 * 60;

export type WalletChallengePayload = {
  version: 1;
  purpose: "showup-wallet-auth";
  address: `0x${string}`;
  domain: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type WalletSessionPayload = {
  version: 1;
  purpose: "showup-wallet-session";
  address: `0x${string}`;
  domain: string;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
};

function getWalletAuthSecret() {
  const secret =
    process.env.SHOWUP_WALLET_AUTH_SECRET?.trim();

  if (!secret || secret.length < 32) {
    throw new Error(
      "SHOWUP_WALLET_AUTH_SECRET must contain at least 32 characters.",
    );
  }

  return secret;
}

function signEncodedPayload(
  encodedPayload: string,
) {
  return createHmac(
    "sha256",
    getWalletAuthSecret(),
  )
    .update(encodedPayload)
    .digest("base64url");
}

function encodePayload(
  payload:
    | WalletChallengePayload
    | WalletSessionPayload,
) {
  return Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
}

function signaturesMatch(
  actualSignature: string,
  expectedSignature: string,
) {
  try {
    const actual = Buffer.from(
      actualSignature,
      "base64url",
    );

    const expected = Buffer.from(
      expectedSignature,
      "base64url",
    );

    return (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function isWalletChallengePayload(
  value: unknown,
): value is WalletChallengePayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    value.purpose ===
      "showup-wallet-auth" &&
    typeof value.address === "string" &&
    isAddress(value.address) &&
    typeof value.domain === "string" &&
    value.domain.length > 0 &&
    typeof value.uri === "string" &&
    value.uri.length > 0 &&
    value.chainId === arcTestnet.id &&
    typeof value.nonce === "string" &&
    value.nonce.length >= 16 &&
    typeof value.issuedAt === "string" &&
    typeof value.expiresAt === "string"
  );
}

export function buildWalletChallengeMessage(
  payload: WalletChallengePayload,
) {
  return [
    `${payload.domain} wants you to authorize this wallet for ShowUp:`,
    payload.address,
    "",
    "Sign this message to prove that you control this wallet.",
    "",
    `URI: ${payload.uri}`,
    "Version: 1",
    `Chain ID: ${payload.chainId}`,
    `Nonce: ${payload.nonce}`,
    `Issued At: ${payload.issuedAt}`,
    `Expiration Time: ${payload.expiresAt}`,
  ].join("\n");
}

export function createWalletChallenge({
  address,
  domain,
  uri,
}: {
  address: string;
  domain: string;
  uri: string;
}) {
  if (!isAddress(address)) {
    throw new Error(
      "A valid wallet address is required.",
    );
  }

  const normalizedDomain =
    domain.trim().toLowerCase();

  if (!normalizedDomain) {
    throw new Error(
      "A valid application domain is required.",
    );
  }

  const parsedUri = new URL(uri);

  if (
    parsedUri.host.toLowerCase() !==
    normalizedDomain
  ) {
    throw new Error(
      "The wallet authorization domain does not match its URI.",
    );
  }

  const issuedAtDate = new Date();

  const expiresAtDate = new Date(
    issuedAtDate.getTime() +
      WALLET_CHALLENGE_MAX_AGE_SECONDS *
        1_000,
  );

  const payload: WalletChallengePayload = {
    version: 1,
    purpose: "showup-wallet-auth",
    address: getAddress(address),
    domain: normalizedDomain,
    uri: parsedUri.origin,
    chainId: arcTestnet.id,
    nonce:
      randomBytes(24).toString(
        "base64url",
      ),
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  };

  const encodedPayload =
    encodePayload(payload);

  const signature =
    signEncodedPayload(encodedPayload);

  return {
    payload,
    message:
      buildWalletChallengeMessage(
        payload,
      ),
    token:
      `${encodedPayload}.${signature}`,
  };
}

export function readWalletChallenge(
  token: string | undefined,
) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [
    encodedPayload,
    actualSignature,
  ] = parts;

  const expectedSignature =
    signEncodedPayload(encodedPayload);

  if (
    !signaturesMatch(
      actualSignature,
      expectedSignature,
    )
  ) {
    return null;
  }

  try {
    const parsedPayload: unknown =
      JSON.parse(
        Buffer.from(
          encodedPayload,
          "base64url",
        ).toString("utf8"),
      );

    if (
      !isWalletChallengePayload(
        parsedPayload,
      )
    ) {
      return null;
    }

    const expiresAt =
      Date.parse(
        parsedPayload.expiresAt,
      );

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return null;
    }

    const parsedUri =
      new URL(parsedPayload.uri);

    if (
      parsedUri.host.toLowerCase() !==
      parsedPayload.domain
    ) {
      return null;
    }

    return parsedPayload;
  } catch {
    return null;
  }
}

function isWalletSessionPayload(
  value: unknown,
): value is WalletSessionPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    value.purpose ===
      "showup-wallet-session" &&
    typeof value.address === "string" &&
    isAddress(value.address) &&
    typeof value.domain === "string" &&
    value.domain.length > 0 &&
    value.chainId === arcTestnet.id &&
    typeof value.issuedAt === "string" &&
    typeof value.expiresAt === "string"
  );
}

export function createWalletSession({
  address,
  domain,
}: {
  address: string;
  domain: string;
}) {
  if (!isAddress(address)) {
    throw new Error(
      "A valid wallet address is required.",
    );
  }

  const normalizedDomain =
    domain.trim().toLowerCase();

  if (!normalizedDomain) {
    throw new Error(
      "A valid application domain is required.",
    );
  }

  const issuedAtDate = new Date();

  const expiresAtDate = new Date(
    issuedAtDate.getTime() +
      WALLET_SESSION_MAX_AGE_SECONDS *
        1_000,
  );

  const payload: WalletSessionPayload = {
    version: 1,
    purpose: "showup-wallet-session",
    address: getAddress(address),
    domain: normalizedDomain,
    chainId: arcTestnet.id,
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  };

  const encodedPayload =
    encodePayload(payload);

  const signature =
    signEncodedPayload(encodedPayload);

  return {
    payload,
    token:
      `${encodedPayload}.${signature}`,
  };
}

export function readWalletSession(
  token: string | undefined,
) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [
    encodedPayload,
    actualSignature,
  ] = parts;

  const expectedSignature =
    signEncodedPayload(encodedPayload);

  if (
    !signaturesMatch(
      actualSignature,
      expectedSignature,
    )
  ) {
    return null;
  }

  try {
    const parsedPayload: unknown =
      JSON.parse(
        Buffer.from(
          encodedPayload,
          "base64url",
        ).toString("utf8"),
      );

    if (
      !isWalletSessionPayload(
        parsedPayload,
      )
    ) {
      return null;
    }

    const expiresAt =
      Date.parse(
        parsedPayload.expiresAt,
      );

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return null;
    }

    return parsedPayload;
  } catch {
    return null;
  }
}
