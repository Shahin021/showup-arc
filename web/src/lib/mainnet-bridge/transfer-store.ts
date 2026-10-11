import { getAddress, isAddress, type Address, type Hex } from "viem";

import { isBridgeChainKey, type BridgeChainKey, type BridgeSpeed } from "./cctp-routes";

/**
 * Persisted CCTP transfers. Everything needed to resume after a refresh is
 * stored as soon as it is known; in particular the burn transaction hash is
 * saved before waiting for its receipt, so a burn is never repeated.
 */

export type BridgeDelivery = "self" | "forwarding";

export type TransferStatus =
  /** Record created; the wallet was asked to sign the burn. No hash is known yet. */
  | "burn-requested"
  /** Burn transaction broadcast; waiting for its receipt. */
  | "burn-submitted"
  /** Burn reverted on-chain. Nothing was burned. */
  | "burn-failed"
  /** Burn confirmed; waiting for Circle's attestation. */
  | "awaiting-attestation"
  /** Attestation received; the destination mint can be submitted. */
  | "ready-to-mint"
  /** Mint broadcast; waiting for its receipt. */
  | "mint-submitted"
  /** Mint failed or was rejected. It can be retried; the burn is not repeated. */
  | "mint-failed"
  /** USDC received on the destination chain (verified on-chain). */
  | "completed"
  /** User discarded a transfer whose burn was never broadcast. */
  | "discarded";

export type BridgeTransfer = {
  version: 1;
  id: string;
  owner: Address;
  from: BridgeChainKey;
  to: BridgeChainKey;
  /** USDC base units (6 decimals). */
  amount: string;
  speed: BridgeSpeed;
  /** "forwarding": Circle's Forwarding Service submits the mint; "self": the user does. */
  delivery: BridgeDelivery;
  /** maxFee passed to depositForBurn, base units. */
  maxFee: string;
  recipient: Address;
  status: TransferStatus;
  createdAt: number;
  updatedAt: number;
  approvalTxHash?: Hex;
  burnTxHash?: Hex;
  nonce?: Hex;
  message?: Hex;
  attestation?: Hex;
  expirationBlock?: string;
  feeExecuted?: string;
  mintTxHash?: Hex;
  mintAttempts: number;
  receivedAmount?: string;
  completedBy?: "mint" | "forwarding" | "already-received";
  lastError?: string;
};

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const BRIDGE_STORAGE_PREFIX = "showup:mainnet:cctp-transfers:v1";

export function storageKeyFor(owner: Address) {
  return `${BRIDGE_STORAGE_PREFIX}:${owner.toLowerCase()}`;
}

const STATUSES: readonly TransferStatus[] = [
  "burn-requested",
  "burn-submitted",
  "burn-failed",
  "awaiting-attestation",
  "ready-to-mint",
  "mint-submitted",
  "mint-failed",
  "completed",
  "discarded",
];

const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x([0-9a-fA-F]{2})+$/;
const UINT = /^\d+$/;

function optionalMatch(value: unknown, pattern: RegExp) {
  return value === undefined || (typeof value === "string" && pattern.test(value));
}

/** Validates a stored record; malformed or tampered entries are dropped instead of acted on. */
export function isBridgeTransfer(value: unknown): value is BridgeTransfer {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    t.version === 1 &&
    typeof t.id === "string" &&
    t.id.length > 0 &&
    typeof t.owner === "string" &&
    isAddress(t.owner) &&
    isBridgeChainKey(t.from) &&
    isBridgeChainKey(t.to) &&
    t.from !== t.to &&
    typeof t.amount === "string" &&
    UINT.test(t.amount) &&
    (t.speed === "standard" || t.speed === "fast") &&
    (t.delivery === "self" || t.delivery === "forwarding") &&
    typeof t.maxFee === "string" &&
    UINT.test(t.maxFee) &&
    typeof t.recipient === "string" &&
    isAddress(t.recipient) &&
    typeof t.status === "string" &&
    (STATUSES as readonly string[]).includes(t.status) &&
    typeof t.createdAt === "number" &&
    typeof t.updatedAt === "number" &&
    typeof t.mintAttempts === "number" &&
    optionalMatch(t.approvalTxHash, HASH) &&
    optionalMatch(t.burnTxHash, HASH) &&
    optionalMatch(t.nonce, HASH) &&
    optionalMatch(t.message, HEX) &&
    optionalMatch(t.attestation, HEX) &&
    optionalMatch(t.expirationBlock, UINT) &&
    optionalMatch(t.feeExecuted, UINT) &&
    optionalMatch(t.mintTxHash, HASH) &&
    optionalMatch(t.receivedAmount, UINT) &&
    // A record past the burn stage must carry its burn hash.
    (["burn-requested", "discarded"].includes(t.status) || typeof t.burnTxHash === "string")
  );
}

export function loadTransfers(storage: KeyValueStorage, owner: Address): BridgeTransfer[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(storageKeyFor(owner));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isBridgeTransfer)
      .filter((t) => t.owner.toLowerCase() === owner.toLowerCase())
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

const MAX_STORED = 50;

/** Inserts or replaces a transfer. Throws if storage is unavailable so callers never burn without a record. */
export function saveTransfer(storage: KeyValueStorage, transfer: BridgeTransfer) {
  const existing = loadTransfers(storage, transfer.owner).filter((t) => t.id !== transfer.id);
  const next = [transfer, ...existing]
    .sort((a, b) => b.createdAt - a.createdAt)
    // Never evict a transfer that still needs action.
    .filter((t, index) => index < MAX_STORED || !isTerminal(t));
  storage.setItem(storageKeyFor(transfer.owner), JSON.stringify(next));
}

export function isTerminal(transfer: BridgeTransfer) {
  return transfer.status === "completed" || transfer.status === "burn-failed" || transfer.status === "discarded";
}

/** Transfers that still need the user's attention or a background step. */
export function activeTransfers(transfers: BridgeTransfer[]) {
  return transfers.filter((t) => !isTerminal(t));
}

/** A burn may have been broadcast without its hash being recorded (e.g. refresh during signing). */
export function hasUnresolvedBurnRequest(transfers: BridgeTransfer[]) {
  return transfers.some((t) => t.status === "burn-requested");
}

export function hasTransferForBurn(transfers: BridgeTransfer[], burnTxHash: Hex) {
  return transfers.some((t) => t.burnTxHash?.toLowerCase() === burnTxHash.toLowerCase());
}

export function newTransferId(now: number, random: () => number = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 1e12).toString(36)}`;
}

export function normalizeOwner(address: string): Address {
  return getAddress(address);
}
