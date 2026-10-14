"use client";

import { markPendingCircleTransaction } from "@/lib/pending-transactions";
import { networkStorageKey } from "@/lib/showup-network";

/**
 * Shared browser-side helpers for Circle user-controlled wallets: reading
 * the connected wallet, opening a session and running a PIN challenge.
 */

export const CIRCLE_USER_ID_KEY = networkStorageKey("circle_user_id");
export const CIRCLE_WALLET_ID_KEY = networkStorageKey("circle_wallet_id");
export const CIRCLE_WALLET_ADDRESS_KEY = networkStorageKey("circle_wallet_address");

export function readStoredCircleWallet() {
  try {
    const userId = window.localStorage.getItem(CIRCLE_USER_ID_KEY);
    const walletId = window.localStorage.getItem(CIRCLE_WALLET_ID_KEY);
    const address = window.localStorage.getItem(CIRCLE_WALLET_ADDRESS_KEY);
    if (!userId || !walletId || !address) {
      return null;
    }
    return { userId, walletId, address };
  } catch {
    return null;
  }
}

export async function getCircleSession(userId: string) {
  const response = await fetch("/api/circle/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ userId }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    userToken?: string;
    encryptionKey?: string;
    error?: string;
  };

  if (!response.ok || !data.userToken || !data.encryptionKey) {
    throw new Error(data.error ?? "Unable to create a secure Circle session.");
  }

  return { userToken: data.userToken, encryptionKey: data.encryptionKey };
}

/**
 * Opens Circle's PIN dialog for a challenge. Resolves with the signature for
 * signing challenges, or an empty string for transaction challenges.
 */
export async function runCircleChallenge(
  challengeId: string,
  session: { userToken: string; encryptionKey: string },
  options: {
    isTransaction: boolean;
    /** The API route's challenge response (with refId), for transactions. */
    pending?: unknown;
    label?: string;
  },
) {
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  if (!appId) {
    throw new Error("Circle App ID is not configured.");
  }

  if (options.isTransaction) {
    markPendingCircleTransaction(options.pending, options.label);
  }

  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  const sdk = new W3SSdk({ appSettings: { appId } });
  await sdk.getDeviceId();
  sdk.setAuthentication(session);

  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Circle authorization timed out.")),
      10 * 60 * 1000,
    );

    sdk.execute(challengeId, (error, result) => {
      window.clearTimeout(timeout);

      if (error) {
        reject(new Error(error.message || "Circle authorization failed."));
        return;
      }

      if (!result || result.status === "FAILED" || result.status === "EXPIRED") {
        reject(
          new Error(
            `Circle authorization ended with status: ${result?.status ?? "unknown"}.`,
          ),
        );
        return;
      }

      const signature = (result as { data?: { signature?: unknown } }).data
        ?.signature;

      resolve(typeof signature === "string" ? signature.trim() : "");
    });
  });
}
