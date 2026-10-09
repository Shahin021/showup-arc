import {
  networkStorageKey,
} from "@/lib/showup-network";

/**
 * Remembers that the user approved a transaction, so that if the page is
 * refreshed or the connection drops before it confirms, the next page load
 * can say so and keep re-reading on-chain state until it settles.
 *
 * The chain stays the source of truth: nothing here marks a transaction as
 * successful. Components always re-read reservation and event state.
 */

const PENDING_KEY = networkStorageKey("pending_transaction");

/** How long after approval a transaction is treated as possibly pending. */
export const PENDING_TRANSACTION_WINDOW_MS = 3 * 60 * 1000;

export type PendingTransaction = {
  startedAt: number;
  /** Identifies the page load that started it, to detect a refresh. */
  pageLoadId: string;
};

// A random id per page load. A marker written by a different page load
// means the page was reloaded while the transaction was in flight.
const PAGE_LOAD_ID =
  typeof window === "undefined"
    ? "server"
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function markPendingTransaction() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const value: PendingTransaction = {
      startedAt: Date.now(),
      pageLoadId: PAGE_LOAD_ID,
    };
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the flow still works.
  }
}

export function clearPendingTransaction() {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

/** Returns a pending transaction started before this page load, if recent. */
export function readInterruptedTransaction(): PendingTransaction | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as PendingTransaction;
    const age = Date.now() - value.startedAt;

    if (!Number.isFinite(age) || age > PENDING_TRANSACTION_WINDOW_MS) {
      clearPendingTransaction();
      return null;
    }

    return value.pageLoadId === PAGE_LOAD_ID ? null : value;
  } catch {
    return null;
  }
}
