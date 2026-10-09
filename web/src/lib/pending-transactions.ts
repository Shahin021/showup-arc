import {
  networkStorageKey,
  SHOWUP_CONTRACT_ADDRESS,
  SHOWUP_NETWORK,
} from "@/lib/showup-network";

/**
 * Remembers the transaction the user just approved, with enough detail to
 * look up *that* transaction's result later: the Circle reference (wallet,
 * refId, start time) or the transaction hash for browser wallets, plus the
 * wallet, network and contract it belongs to.
 *
 * If the page is reloaded or the connection drops before the transaction
 * settles, the next page load resumes tracking it (see
 * components/pending-transaction-notice.tsx) and shows its real outcome.
 * Nothing here marks a transaction as successful by itself.
 */

const PENDING_KEY = networkStorageKey("pending_transaction");

/** After this long without a result, the notice says the status is unknown. */
export const PENDING_TRANSACTION_GIVE_UP_MS = 30 * 60 * 1000;

export type PendingTransaction = {
  network: string;
  contract: string;
  label: string;
  walletAddress: string | null;
  startedAt: number;
  pageLoadId: string;
} & (
  | {
      kind: "circle";
      walletId: string;
      refId: string;
      createdAfter: string;
    }
  | {
      kind: "browser";
      txHash: string | null;
    }
);

// A random id per page load, to tell a reload apart from the same session.
const PAGE_LOAD_ID =
  typeof window === "undefined"
    ? "server"
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function write(value: PendingTransaction) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the flow still works.
  }
}

function readStoredWallet() {
  try {
    return {
      address: window.localStorage.getItem(networkStorageKey("circle_wallet_address")),
      walletId: window.localStorage.getItem(networkStorageKey("circle_wallet_id")),
    };
  } catch {
    return { address: null, walletId: null };
  }
}

function base(label: string, walletAddress: string | null) {
  return {
    network: SHOWUP_NETWORK,
    contract: SHOWUP_CONTRACT_ADDRESS,
    label,
    walletAddress,
    startedAt: Date.now(),
    pageLoadId: PAGE_LOAD_ID,
  };
}

/**
 * Records a Circle transaction before the PIN dialog opens. `challenge` is
 * the response of the API route that created it, which includes the
 * transaction's reference ID and start time.
 */
export function markPendingCircleTransaction(
  challenge: unknown,
  label = "Transaction",
) {
  if (typeof window === "undefined") {
    return;
  }

  const data = (challenge ?? {}) as { refId?: unknown; createdAfter?: unknown };
  const wallet = readStoredWallet();

  if (
    typeof data.refId !== "string" ||
    typeof data.createdAfter !== "string" ||
    !wallet.walletId
  ) {
    return;
  }

  write({
    ...base(label, wallet.address),
    kind: "circle",
    walletId: wallet.walletId,
    refId: data.refId,
    createdAfter: data.createdAfter,
  });
}

/** Records a browser-wallet transaction; call again with the hash once known. */
export function markPendingBrowserTransaction(
  walletAddress: string,
  label: string,
  txHash: string | null = null,
) {
  if (typeof window === "undefined") {
    return;
  }

  write({ ...base(label, walletAddress), kind: "browser", txHash });
}

export function clearPendingTransaction() {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

/**
 * Returns a transaction recorded by an earlier page load on this network
 * and contract. Records for another network or contract are discarded.
 */
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

    if (
      value.network !== SHOWUP_NETWORK ||
      value.contract?.toLowerCase() !== SHOWUP_CONTRACT_ADDRESS.toLowerCase()
    ) {
      clearPendingTransaction();
      return null;
    }

    return value.pageLoadId === PAGE_LOAD_ID ? null : value;
  } catch {
    return null;
  }
}
