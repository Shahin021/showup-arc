"use client";

import { networkStorageKey, SHOWUP_NETWORK } from "@/lib/showup-network";

/**
 * The earlier testnet site stored the Circle wallet under un-namespaced
 * keys and had no session cookie. On testnet, move those keys to the new
 * namespaced ones and bind the user to this browser (see
 * /api/circle/legacy-migrate). Runs at most once per browser.
 */
const LEGACY_KEYS = {
  circle_user_id: "showup_circle_user_id",
  circle_wallet_id: "showup_circle_wallet_id",
  circle_wallet_address: "showup_circle_wallet_address",
  circle_wallet_ready: "showup_circle_wallet_ready",
} as const;

export async function migrateLegacyCircleUser() {
  if (SHOWUP_NETWORK !== "testnet" || typeof window === "undefined") {
    return;
  }

  try {
    const storage = window.localStorage;
    const legacyUserId = storage.getItem(LEGACY_KEYS.circle_user_id);

    if (!legacyUserId || storage.getItem(networkStorageKey("circle_user_id"))) {
      return;
    }

    const response = await fetch("/api/circle/legacy-migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ userId: legacyUserId }),
    });

    if (!response.ok) {
      return; // Migration closed or unknown user: the user can restore instead.
    }

    for (const [name, legacyKey] of Object.entries(LEGACY_KEYS)) {
      const value = storage.getItem(legacyKey);
      if (value !== null) {
        storage.setItem(networkStorageKey(name), value);
        storage.removeItem(legacyKey);
      }
    }
  } catch {
    // Storage or network unavailable: nothing to migrate now.
  }
}
