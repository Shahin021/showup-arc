import { decodeEventLog, getAddress, type Address, type Hex } from "viem";

import { MESSAGE_TRANSMITTER_V2_ABI, TOKEN_MESSENGER_V2_ABI, TOKEN_MINTER_V2_EVENTS_ABI } from "./cctp-abi";
import { isAttestationExpired, parseIrisMessages, type AttestationExpectation } from "./attestation";
import {
  BRIDGE_CHAINS,
  CCTP_FORWARDING_HOOK_DATA,
  CCTP_V2_MESSAGE_TRANSMITTER,
  CCTP_V2_TOKEN_MESSENGER,
  addressToBytes32,
  bytes32ToAddress,
  chainByDomain,
  computeTransferFees,
  feeTierScaledBps,
  finalityThreshold,
  forwardFeeFor,
  isSupportedRoute,
  parseUsdcAmount,
  supportedSpeeds,
  type BridgeChainKey,
  type BridgeSpeed,
  type BurnFeeTier,
  type TransferFees,
} from "./cctp-routes";
import {
  hasTransferForBurn,
  hasUnresolvedBurnRequest,
  loadTransfers,
  newTransferId,
  saveTransfer,
  type BridgeDelivery,
  type BridgeTransfer,
  type KeyValueStorage,
} from "./transfer-store";

/**
 * CCTP V2 transfer flow for browser wallets.
 *
 * Invariants:
 * - `startBridge` is the only function that submits a burn, and it always
 *   creates and persists a fresh record before asking the wallet to sign.
 * - Every other step (attestation, mint, retries, recovery) works from the
 *   stored record and never burns again.
 * - A transfer is reported as completed only after the destination chain
 *   confirms the message nonce was used (a successful mint receipt with the
 *   matching MessageReceived event, or `usedNonces(nonce) != 0`).
 */

/** TokenMinterV2 shares this address on every EVM mainnet. */
export const CCTP_V2_TOKEN_MINTER: Address = "0xfd78EE919681417d192449715b2594ab58f5D002";

/** Conservative gas budgets (measured CCTP V2 usage plus headroom). */
export const GAS_BUDGET = {
  approve: BigInt(70_000),
  burn: BigInt(250_000),
  mint: BigInt(300_000),
} as const;

/** A preview must be re-quoted after this long. */
export const PREVIEW_TTL_MS = 60_000;

/** A mint with no receipt after this long may be retried (the nonce prevents a double mint). */
export const STALE_MINT_MS = 5 * 60_000;

const USDC_TO_NATIVE = BigInt(1_000_000_000_000); // 6 -> 18 decimals on Arc

export type ReceiptLog = { address: Address; topics: readonly Hex[]; data: Hex };
export type TxReceipt = { status: "success" | "reverted"; logs: readonly ReceiptLog[] };

export type BurnArgs = {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: Hex;
  burnToken: Address;
  maxFee: bigint;
  minFinalityThreshold: number;
  hookData?: Hex;
};

/** Wallet, RPC and API boundary. Implemented with viem in the browser and mocked in tests. */
export type BridgeRuntime = {
  storage: KeyValueStorage;
  now(): number;
  activeAccount(): Promise<Address>;
  ensureChain(chain: BridgeChainKey): Promise<void>;
  usdcBalance(chain: BridgeChainKey, owner: Address): Promise<bigint>;
  nativeBalance(chain: BridgeChainKey, owner: Address): Promise<bigint>;
  allowance(chain: BridgeChainKey, owner: Address): Promise<bigint>;
  /** maxFeePerGas the transaction will use, in native wei. */
  gasPrice(chain: BridgeChainKey): Promise<bigint>;
  approve(chain: BridgeChainKey, owner: Address, amount: bigint): Promise<Hex>;
  burn(chain: BridgeChainKey, owner: Address, args: BurnArgs): Promise<Hex>;
  mint(chain: BridgeChainKey, owner: Address, message: Hex, attestation: Hex): Promise<Hex>;
  /** null when the transaction is unknown or not yet mined within the wait. */
  waitForReceipt(chain: BridgeChainKey, hash: Hex): Promise<TxReceipt | null>;
  /** Raw Iris response body, or null when Iris has no record yet (404). */
  fetchMessages(sourceDomain: number, burnTxHash: Hex): Promise<unknown>;
  fetchFeeTiers(sourceDomain: number, destinationDomain: number, forward: boolean): Promise<BurnFeeTier[]>;
  isNonceUsed(chain: BridgeChainKey, nonce: Hex): Promise<boolean>;
  blockNumber(chain: BridgeChainKey): Promise<bigint>;
  requestReattest(nonce: Hex): Promise<void>;
};

export type BridgeRequest = {
  owner: Address;
  from: BridgeChainKey;
  to: BridgeChainKey;
  amountText: string;
  speed: BridgeSpeed;
  delivery: BridgeDelivery;
};

export type GasCheck = { symbol: string; cost: bigint; balance: bigint; enough: boolean };

export type BridgePreview = {
  request: BridgeRequest;
  amount: bigint;
  fees: TransferFees;
  finality: number;
  needsApproval: boolean;
  usdcBalance: bigint;
  sourceGas: GasCheck;
  /** Only checked when the user submits the mint themselves. */
  destinationGas: GasCheck | null;
  problems: string[];
  quotedAt: number;
};

export class BridgeUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeUserError";
  }
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function isUserRejection(error: unknown) {
  const code = (error as { code?: unknown; cause?: { code?: unknown } })?.code ?? (error as { cause?: { code?: unknown } })?.cause?.code;
  if (code === 4001) return true;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /user (rejected|denied|cancel)|rejected the request|UserRejectedRequestError/i.test(message);
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" && short ? short : error.message;
  }
  return String(error);
}

async function assertAccount(runtime: BridgeRuntime, owner: Address) {
  const active = await runtime.activeAccount();
  if (!sameAddress(active, owner)) {
    throw new BridgeUserError(
      `The wallet account changed to ${active}. Switch back to ${owner} to continue this transfer.`,
    );
  }
}

function persist(runtime: BridgeRuntime, transfer: BridgeTransfer, patch: Partial<BridgeTransfer>): BridgeTransfer {
  const next: BridgeTransfer = { ...transfer, ...patch, updatedAt: runtime.now() };
  saveTransfer(runtime.storage, next);
  return next;
}

function expectationFor(transfer: BridgeTransfer): AttestationExpectation {
  return {
    sourceDomain: BRIDGE_CHAINS[transfer.from].domain,
    destinationDomain: BRIDGE_CHAINS[transfer.to].domain,
    burnToken: BRIDGE_CHAINS[transfer.from].usdc,
    mintRecipient: transfer.recipient,
    amount: BigInt(transfer.amount),
    depositor: transfer.owner,
    maxFee: BigInt(transfer.maxFee),
  };
}

// ---------------------------------------------------------------------------
// Preview

export async function previewBridge(runtime: BridgeRuntime, request: BridgeRequest): Promise<BridgePreview> {
  const { owner, from, to, speed, delivery } = request;
  if (!isSupportedRoute(from, to)) {
    throw new BridgeUserError(`Transfers from ${BRIDGE_CHAINS[from].label} to ${BRIDGE_CHAINS[to].label} are not supported.`);
  }
  if (!supportedSpeeds(from).includes(speed)) {
    throw new BridgeUserError(`Fast Transfer is not available from ${BRIDGE_CHAINS[from].label}; use a standard transfer.`);
  }

  let amount: bigint;
  try {
    amount = parseUsdcAmount(request.amountText);
  } catch (error) {
    throw new BridgeUserError(errorText(error));
  }

  const source = BRIDGE_CHAINS[from];
  const destination = BRIDGE_CHAINS[to];
  const threshold = finalityThreshold(speed);

  const tiers = await runtime.fetchFeeTiers(source.domain, destination.domain, delivery === "forwarding");
  let fees: TransferFees;
  try {
    fees = computeTransferFees({
      amount,
      // Standard transfers are currently free (0 bps), but the live tier is used either way.
      scaledBps: feeTierScaledBps(tiers, threshold),
      forward: delivery === "forwarding" ? forwardFeeFor(tiers, threshold) : undefined,
    });
  } catch (error) {
    throw new BridgeUserError(errorText(error));
  }

  const [usdcBalance, allowance, sourcePrice, sourceNative, destinationPrice, destinationNative] = await Promise.all([
    runtime.usdcBalance(from, owner),
    runtime.allowance(from, owner),
    runtime.gasPrice(from),
    runtime.nativeBalance(from, owner),
    delivery === "self" ? runtime.gasPrice(to) : Promise.resolve(BigInt(0)),
    delivery === "self" ? runtime.nativeBalance(to, owner) : Promise.resolve(BigInt(0)),
  ]);

  const needsApproval = allowance < amount;
  const sourceCost = sourcePrice * (GAS_BUDGET.burn + (needsApproval ? GAS_BUDGET.approve : BigInt(0)));
  // On Arc the gas and the USDC being bridged come from the same balance.
  const sourceRequired = source.gasIsUsdc ? sourceCost + amount * USDC_TO_NATIVE : sourceCost;
  const sourceGas: GasCheck = {
    symbol: source.nativeSymbol,
    cost: sourceCost,
    balance: sourceNative,
    enough: sourceNative >= sourceRequired,
  };

  const destinationGas: GasCheck | null =
    delivery === "self"
      ? {
          symbol: destination.nativeSymbol,
          cost: destinationPrice * GAS_BUDGET.mint,
          balance: destinationNative,
          enough: destinationNative >= destinationPrice * GAS_BUDGET.mint,
        }
      : null;

  const problems: string[] = [];
  if (usdcBalance < amount) {
    problems.push(`Insufficient USDC on ${source.label}.`);
  } else if (!sourceGas.enough) {
    problems.push(
      source.gasIsUsdc
        ? `Not enough USDC on ${source.label} for the amount plus network fees.`
        : `Not enough ${source.nativeSymbol} on ${source.label} to pay for gas.`,
    );
  }
  if (destinationGas && !destinationGas.enough) {
    problems.push(
      `Not enough ${destination.nativeSymbol} on ${destination.label} to submit the receive transaction. Add ${destination.nativeSymbol} there or choose Circle delivery.`,
    );
  }

  return {
    request,
    amount,
    fees,
    finality: threshold,
    needsApproval,
    usdcBalance,
    sourceGas,
    destinationGas,
    problems,
    quotedAt: runtime.now(),
  };
}

// ---------------------------------------------------------------------------
// Start (approve + burn)

export type ProgressListener = (transfer: BridgeTransfer) => void;

export async function startBridge(
  runtime: BridgeRuntime,
  preview: BridgePreview,
  onProgress: ProgressListener = () => {},
): Promise<BridgeTransfer> {
  const { owner, from, to, speed, delivery } = preview.request;
  const source = BRIDGE_CHAINS[from];
  const destination = BRIDGE_CHAINS[to];

  if (runtime.now() - preview.quotedAt > PREVIEW_TTL_MS) {
    throw new BridgeUserError("This quote has expired. Review the transfer again.");
  }
  if (preview.problems.length > 0) {
    throw new BridgeUserError(preview.problems[0]);
  }
  if (hasUnresolvedBurnRequest(loadTransfers(runtime.storage, owner))) {
    throw new BridgeUserError(
      "A previous transfer was interrupted while the burn was being signed. Resolve it first (recover it with its transaction hash or discard it).",
    );
  }

  await assertAccount(runtime, owner);
  await runtime.ensureChain(from);

  if ((await runtime.allowance(from, owner)) < preview.amount) {
    const approvalHash = await runtime.approve(from, owner, preview.amount);
    const approval = await runtime.waitForReceipt(from, approvalHash);
    if (!approval || approval.status !== "success") {
      throw new BridgeUserError("The USDC approval did not succeed. Nothing was burned.");
    }
    if ((await runtime.allowance(from, owner)) < preview.amount) {
      throw new BridgeUserError("The USDC approval is still too low. Nothing was burned.");
    }
    await assertAccount(runtime, owner);
  }

  const now = runtime.now();
  let transfer: BridgeTransfer = {
    version: 1,
    id: newTransferId(now),
    owner: getAddress(owner),
    from,
    to,
    amount: preview.amount.toString(),
    speed,
    delivery,
    maxFee: preview.fees.maxFee.toString(),
    recipient: getAddress(owner),
    status: "burn-requested",
    createdAt: now,
    updatedAt: now,
    mintAttempts: 0,
  };
  // Persist before signing: if storage fails, nothing is burned.
  saveTransfer(runtime.storage, transfer);
  onProgress(transfer);

  let burnTxHash: Hex;
  try {
    burnTxHash = await runtime.burn(from, owner, {
      amount: preview.amount,
      destinationDomain: destination.domain,
      mintRecipient: addressToBytes32(owner),
      burnToken: source.usdc,
      maxFee: preview.fees.maxFee,
      minFinalityThreshold: preview.finality,
      ...(delivery === "forwarding" ? { hookData: CCTP_FORWARDING_HOOK_DATA } : {}),
    });
  } catch (error) {
    if (isUserRejection(error)) {
      transfer = persist(runtime, transfer, { status: "discarded", lastError: "The burn was rejected in the wallet." });
      onProgress(transfer);
      throw new BridgeUserError("The burn was rejected in the wallet. Nothing was burned.");
    }
    // The wallet may or may not have broadcast the transaction. Keep the
    // record so the user checks before starting another transfer.
    transfer = persist(runtime, transfer, { lastError: errorText(error) });
    onProgress(transfer);
    throw error;
  }

  transfer = persist(runtime, transfer, { status: "burn-submitted", burnTxHash, lastError: undefined });
  onProgress(transfer);

  return advanceTransfer(runtime, transfer, onProgress);
}

// ---------------------------------------------------------------------------
// Event helpers

type DepositForBurnArgs = {
  burnToken: Address;
  amount: bigint;
  depositor: Address;
  mintRecipient: Hex;
  destinationDomain: number;
  destinationCaller: Hex;
  maxFee: bigint;
  minFinalityThreshold: number;
  hookData: Hex;
};

export function findDepositForBurn(receipt: TxReceipt): DepositForBurnArgs | null {
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, CCTP_V2_TOKEN_MESSENGER)) continue;
    try {
      const decoded = decodeEventLog({
        abi: TOKEN_MESSENGER_V2_ABI,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      if (decoded.eventName === "DepositForBurn") {
        return decoded.args as unknown as DepositForBurnArgs;
      }
    } catch {
      // Not a DepositForBurn log.
    }
  }
  return null;
}

/** Returns the minted amount when the receipt proves this nonce was received, otherwise null. */
export function findMintEvidence(receipt: TxReceipt, nonce: Hex, recipient: Address): { minted?: bigint } | null {
  let received = false;
  let minted: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      if (sameAddress(log.address, CCTP_V2_MESSAGE_TRANSMITTER)) {
        const decoded = decodeEventLog({ abi: MESSAGE_TRANSMITTER_V2_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data });
        if (decoded.eventName === "MessageReceived" && (decoded.args.nonce as Hex).toLowerCase() === nonce.toLowerCase()) {
          received = true;
        }
      } else if (sameAddress(log.address, CCTP_V2_TOKEN_MINTER)) {
        const decoded = decodeEventLog({ abi: TOKEN_MINTER_V2_EVENTS_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data });
        if (decoded.eventName === "MintAndWithdraw" && sameAddress(decoded.args.mintRecipient, recipient)) {
          minted = decoded.args.amount;
        }
      }
    } catch {
      // Unrelated log.
    }
  }
  return received ? { minted } : null;
}

function burnMatchesTransfer(event: DepositForBurnArgs, transfer: BridgeTransfer) {
  const source = BRIDGE_CHAINS[transfer.from];
  const destination = BRIDGE_CHAINS[transfer.to];
  return (
    sameAddress(event.burnToken, source.usdc) &&
    sameAddress(event.depositor, transfer.owner) &&
    event.amount === BigInt(transfer.amount) &&
    event.destinationDomain === destination.domain &&
    sameAddress(bytes32ToAddress(event.mintRecipient), transfer.recipient) &&
    event.maxFee === BigInt(transfer.maxFee)
  );
}

// ---------------------------------------------------------------------------
// Non-interactive progress (safe to call on every refresh / poll)

async function completeIfReceived(runtime: BridgeRuntime, transfer: BridgeTransfer, onProgress: ProgressListener) {
  if (!transfer.nonce) return null;
  if (await runtime.isNonceUsed(transfer.to, transfer.nonce)) {
    const next = persist(runtime, transfer, {
      status: "completed",
      completedBy: transfer.delivery === "forwarding" && !transfer.mintAttempts ? "forwarding" : "already-received",
      lastError: undefined,
    });
    onProgress(next);
    return next;
  }
  return null;
}

async function settleMintReceipt(
  runtime: BridgeRuntime,
  transfer: BridgeTransfer,
  mintTxHash: Hex,
  onProgress: ProgressListener,
): Promise<BridgeTransfer> {
  const receipt = await runtime.waitForReceipt(transfer.to, mintTxHash);
  if (receipt?.status === "success" && transfer.nonce) {
    const evidence = findMintEvidence(receipt, transfer.nonce, transfer.recipient);
    if (evidence) {
      const next = persist(runtime, transfer, {
        status: "completed",
        mintTxHash,
        completedBy: transfer.mintAttempts > 0 ? "mint" : "forwarding",
        ...(evidence.minted !== undefined ? { receivedAmount: evidence.minted.toString() } : {}),
        lastError: undefined,
      });
      onProgress(next);
      return next;
    }
  }

  // Reverted, unknown or without evidence: trust only the on-chain nonce state.
  const done = await completeIfReceived(runtime, transfer, onProgress);
  if (done) return done;

  if (receipt?.status === "reverted") {
    const next = persist(runtime, transfer, {
      status: "mint-failed",
      lastError: "The receive transaction reverted on the destination chain. You can retry it; the burn is not repeated.",
    });
    onProgress(next);
    return next;
  }

  if (!receipt && runtime.now() - transfer.updatedAt > STALE_MINT_MS) {
    const next = persist(runtime, transfer, {
      status: "mint-failed",
      lastError: "The receive transaction was not found. You can submit it again; the burn is not repeated.",
    });
    onProgress(next);
    return next;
  }
  return transfer;
}

/**
 * Moves a transfer forward as far as possible without asking the wallet to
 * sign anything. Never burns and never mints.
 */
export async function advanceTransfer(
  runtime: BridgeRuntime,
  input: BridgeTransfer,
  onProgress: ProgressListener = () => {},
): Promise<BridgeTransfer> {
  let transfer = input;

  if (transfer.status === "burn-submitted" && transfer.burnTxHash) {
    const receipt = await runtime.waitForReceipt(transfer.from, transfer.burnTxHash);
    if (!receipt) {
      return transfer;
    }
    if (receipt.status !== "success") {
      transfer = persist(runtime, transfer, {
        status: "burn-failed",
        lastError: "The burn transaction reverted. No USDC was burned.",
      });
      onProgress(transfer);
      return transfer;
    }
    const event = findDepositForBurn(receipt);
    if (!event || !burnMatchesTransfer(event, transfer)) {
      transfer = persist(runtime, transfer, {
        lastError: "The burn receipt does not contain the expected CCTP DepositForBurn event.",
      });
      onProgress(transfer);
      return transfer;
    }
    transfer = persist(runtime, transfer, { status: "awaiting-attestation", lastError: undefined });
    onProgress(transfer);
  }

  if (transfer.status === "awaiting-attestation" && transfer.burnTxHash) {
    const body = await runtime.fetchMessages(BRIDGE_CHAINS[transfer.from].domain, transfer.burnTxHash);
    const result = body === null ? ({ state: "not-found" } as const) : parseIrisMessages(body, expectationFor(transfer));
    if (result.state !== "complete") {
      return transfer;
    }
    transfer = persist(runtime, transfer, {
      status: "ready-to-mint",
      nonce: result.nonce,
      message: result.message,
      attestation: result.attestation,
      expirationBlock: result.expirationBlock.toString(),
      feeExecuted: result.feeExecuted.toString(),
      lastError: undefined,
    });
    onProgress(transfer);
    if (result.forwardTxHash) {
      transfer = persist(runtime, transfer, { status: "mint-submitted", mintTxHash: result.forwardTxHash });
      onProgress(transfer);
    }
  }

  if (transfer.status === "ready-to-mint") {
    const done = await completeIfReceived(runtime, transfer, onProgress);
    if (done) return done;

    if (transfer.delivery === "forwarding" && transfer.burnTxHash) {
      const body = await runtime.fetchMessages(BRIDGE_CHAINS[transfer.from].domain, transfer.burnTxHash);
      const result = body === null ? null : parseIrisMessages(body, expectationFor(transfer));
      if (result?.state === "complete" && result.forwardTxHash) {
        transfer = persist(runtime, transfer, { status: "mint-submitted", mintTxHash: result.forwardTxHash });
        onProgress(transfer);
      }
    }
  }

  if (transfer.status === "mint-submitted" && transfer.mintTxHash) {
    return settleMintReceipt(runtime, transfer, transfer.mintTxHash, onProgress);
  }

  if (transfer.status === "mint-failed") {
    const done = await completeIfReceived(runtime, transfer, onProgress);
    if (done) return done;
  }

  return transfer;
}

// ---------------------------------------------------------------------------
// Receive (destination mint, user-initiated, retryable)

export function canReceive(transfer: BridgeTransfer, now: number) {
  if (!transfer.message || !transfer.attestation || !transfer.nonce) return false;
  if (transfer.status === "ready-to-mint" || transfer.status === "mint-failed") return true;
  return transfer.status === "mint-submitted" && now - transfer.updatedAt > STALE_MINT_MS;
}

export async function receiveTransfer(
  runtime: BridgeRuntime,
  input: BridgeTransfer,
  onProgress: ProgressListener = () => {},
): Promise<BridgeTransfer> {
  let transfer = input;
  if (!canReceive(transfer, runtime.now())) {
    throw new BridgeUserError("This transfer is not ready to be received.");
  }

  // Already minted (by Circle's forwarder, another relayer or an earlier attempt)?
  const done = await completeIfReceived(runtime, transfer, onProgress);
  if (done) return done;

  const expiration = BigInt(transfer.expirationBlock ?? "0");
  if (expiration !== BigInt(0) && isAttestationExpired(expiration, await runtime.blockNumber(transfer.to))) {
    await runtime.requestReattest(transfer.nonce as Hex);
    transfer = persist(runtime, transfer, {
      status: "awaiting-attestation",
      message: undefined,
      attestation: undefined,
      lastError: "The attestation expired. A new one was requested from Circle; receive again when it is ready.",
    });
    onProgress(transfer);
    return transfer;
  }

  await assertAccount(runtime, transfer.owner);
  await runtime.ensureChain(transfer.to);

  const destination = BRIDGE_CHAINS[transfer.to];
  const [price, balance] = await Promise.all([
    runtime.gasPrice(transfer.to),
    runtime.nativeBalance(transfer.to, transfer.owner),
  ]);
  if (balance < price * GAS_BUDGET.mint) {
    throw new BridgeUserError(
      `Not enough ${destination.nativeSymbol} on ${destination.label} to pay for the receive transaction. Add some and retry; your burned USDC stays claimable.`,
    );
  }

  let mintTxHash: Hex;
  try {
    mintTxHash = await runtime.mint(transfer.to, transfer.owner, transfer.message as Hex, transfer.attestation as Hex);
  } catch (error) {
    // The nonce may have been used meanwhile (simulation reverts with "Nonce already used").
    const received = await completeIfReceived(runtime, transfer, onProgress);
    if (received) return received;
    transfer = persist(runtime, transfer, {
      status: "mint-failed",
      lastError: isUserRejection(error) ? "The receive transaction was rejected in the wallet." : errorText(error),
    });
    onProgress(transfer);
    throw isUserRejection(error) ? new BridgeUserError("The receive transaction was rejected. You can retry it at any time.") : error;
  }

  transfer = persist(runtime, transfer, {
    status: "mint-submitted",
    mintTxHash,
    mintAttempts: transfer.mintAttempts + 1,
    lastError: undefined,
  });
  onProgress(transfer);
  return settleMintReceipt(runtime, transfer, mintTxHash, onProgress);
}

// ---------------------------------------------------------------------------
// Recovery from a burn transaction hash

export async function recoverFromBurnHash(
  runtime: BridgeRuntime,
  { owner, from, burnTxHash }: { owner: Address; from: BridgeChainKey; burnTxHash: Hex },
  onProgress: ProgressListener = () => {},
): Promise<BridgeTransfer> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(burnTxHash)) {
    throw new BridgeUserError("Enter a valid transaction hash.");
  }
  const existing = loadTransfers(runtime.storage, owner);
  if (hasTransferForBurn(existing, burnTxHash)) {
    const found = existing.find((t) => t.burnTxHash?.toLowerCase() === burnTxHash.toLowerCase()) as BridgeTransfer;
    return advanceTransfer(runtime, found, onProgress);
  }

  const receipt = await runtime.waitForReceipt(from, burnTxHash);
  if (!receipt) {
    throw new BridgeUserError(`That transaction was not found on ${BRIDGE_CHAINS[from].label}. Check the network and try again.`);
  }
  if (receipt.status !== "success") {
    throw new BridgeUserError("That transaction reverted, so no USDC was burned.");
  }
  const event = findDepositForBurn(receipt);
  if (!event) {
    throw new BridgeUserError("That transaction is not a CCTP V2 burn.");
  }
  const destination = chainByDomain(event.destinationDomain);
  if (!destination || !isSupportedRoute(from, destination.key)) {
    throw new BridgeUserError("That burn goes to a destination this app does not support.");
  }
  if (!sameAddress(event.burnToken, BRIDGE_CHAINS[from].usdc)) {
    throw new BridgeUserError("That burn is not for USDC.");
  }
  if (!sameAddress(event.depositor, owner)) {
    throw new BridgeUserError("That burn was sent by a different account.");
  }

  const now = runtime.now();
  // Resolve an interrupted "burn-requested" record for the same route.
  const pending = existing.find((t) => t.status === "burn-requested" && t.from === from && t.to === destination.key);
  let transfer: BridgeTransfer = {
    version: 1,
    id: pending?.id ?? newTransferId(now),
    owner: getAddress(owner),
    from,
    to: destination.key,
    amount: event.amount.toString(),
    speed: event.minFinalityThreshold <= 1000 ? "fast" : "standard",
    delivery: event.hookData.toLowerCase() === CCTP_FORWARDING_HOOK_DATA ? "forwarding" : "self",
    maxFee: event.maxFee.toString(),
    recipient: bytes32ToAddress(event.mintRecipient),
    status: "awaiting-attestation",
    createdAt: pending?.createdAt ?? now,
    updatedAt: now,
    burnTxHash,
    mintAttempts: 0,
  };
  saveTransfer(runtime.storage, transfer);
  onProgress(transfer);
  transfer = await advanceTransfer(runtime, transfer, onProgress);
  return transfer;
}

/** Only an interrupted request whose burn was never broadcast can be discarded. */
export function discardTransfer(runtime: BridgeRuntime, transfer: BridgeTransfer) {
  if (transfer.status !== "burn-requested") {
    throw new BridgeUserError("Only an interrupted transfer without a burn transaction can be discarded.");
  }
  return persist(runtime, transfer, { status: "discarded" });
}
