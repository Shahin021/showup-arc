import { decodeEventLog, decodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";

/**
 * Same-chain USDC <-> EURC swap on Arc mainnet through Circle App Kit
 * (Stablecoin Service). Pure helpers, no environment access.
 *
 * Sources (checked October 2026):
 * - Arc supports Swap for USDC, EURC and cirBTC:
 *   https://docs.arc.io/app-kit/references/supported-blockchains
 * - API key optional; without one requests share a rate limit:
 *   https://docs.arc.io/app-kit/swap
 * - Spender: the App Kit adapter contract defined in the SDK
 *   (@circle-fin/provider-stablecoin-service-swap, ADAPTER_CONTRACT_EVM_MAINNET).
 */

export const ARC_MAINNET_CHAIN_ID = 5042;

/** Circle App Kit adapter contract on EVM mainnets (spender for permits and approvals). */
export const CIRCLE_SWAP_ADAPTER: Address = "0x7FB8c7260b63934d8da38aF902f87ae6e284a845";

export const SWAP_TOKENS = {
  USDC: { symbol: "USDC", address: "0x3600000000000000000000000000000000000000" as Address, decimals: 6 },
  EURC: { symbol: "EURC", address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as Address, decimals: 6 },
} as const;

export type SwapTokenSymbol = keyof typeof SWAP_TOKENS;

export const SLIPPAGE_OPTIONS_BPS = [10, 50, 100] as const;
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 300;

/** A displayed quote must be refreshed after this long. */
export const QUOTE_TTL_MS = 30_000;

export function isSwapToken(value: unknown): value is SwapTokenSymbol {
  return value === "USDC" || value === "EURC";
}

export function otherToken(symbol: SwapTokenSymbol): SwapTokenSymbol {
  return symbol === "USDC" ? "EURC" : "USDC";
}

export function parseTokenAmount(input: string, decimals: number): bigint {
  const value = input.trim();
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(value)) {
    throw new Error(`Enter an amount with at most ${decimals} decimals.`);
  }
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= BigInt(0)) {
    throw new Error("Enter an amount greater than zero.");
  }
  return units;
}

export function formatTokenUnits(units: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateSlippage(bps: number) {
  if (!Number.isInteger(bps) || bps < 1 || bps > MAX_SLIPPAGE_BPS) {
    throw new Error(`Slippage must be between 0.01% and ${MAX_SLIPPAGE_BPS / 100}%.`);
  }
  return bps;
}

export type SwapFeeLine = { type: string; token: string; amount: string | null };

/** What the user confirms. Amounts are base units. */
export type SwapQuote = {
  owner: Address;
  tokenIn: SwapTokenSymbol;
  tokenOut: SwapTokenSymbol;
  amountIn: bigint;
  estimatedOut: bigint;
  /** Minimum output enforced on-chain (stop limit). */
  minimumOut: bigint;
  slippageBps: number;
  fees: SwapFeeLine[];
  quotedAt: number;
};

type EstimateLike = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  estimatedOutput: { token: string; amount: string };
  stopLimit: { token: string; amount: string };
  fees?: readonly { type: string; token: string; amount: string | null }[];
};

/** Converts an App Kit estimate into a quote and checks it matches the request. */
export function quoteFromEstimate(
  estimate: EstimateLike,
  request: { owner: Address; tokenIn: SwapTokenSymbol; tokenOut: SwapTokenSymbol; amountIn: bigint; slippageBps: number },
  now: number,
): SwapQuote {
  const tokenOut = SWAP_TOKENS[request.tokenOut];
  if (estimate.tokenIn !== request.tokenIn || estimate.tokenOut !== request.tokenOut) {
    throw new Error("Circle returned a quote for a different token pair.");
  }
  if (estimate.estimatedOutput.token !== request.tokenOut || estimate.stopLimit.token !== request.tokenOut) {
    throw new Error("Circle returned a quote in an unexpected token.");
  }
  const amountIn = parseTokenAmount(estimate.amountIn, SWAP_TOKENS[request.tokenIn].decimals);
  if (amountIn !== request.amountIn) {
    throw new Error("Circle returned a quote for a different amount.");
  }
  const estimatedOut = parseTokenAmount(estimate.estimatedOutput.amount, tokenOut.decimals);
  const minimumOut = parseTokenAmount(estimate.stopLimit.amount, tokenOut.decimals);
  if (minimumOut > estimatedOut) {
    throw new Error("Circle returned an inconsistent minimum output.");
  }
  // The stop limit must respect the slippage the user chose.
  const floor = (estimatedOut * BigInt(10_000 - request.slippageBps)) / BigInt(10_000);
  if (minimumOut < floor) {
    throw new Error("Circle's minimum output is below your slippage setting.");
  }
  return {
    owner: request.owner,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn,
    estimatedOut,
    minimumOut,
    slippageBps: request.slippageBps,
    fees: (estimate.fees ?? []).map((fee) => ({ type: fee.type, token: fee.token, amount: fee.amount })),
    quotedAt: now,
  };
}

export function quoteSecondsLeft(quote: SwapQuote, now: number) {
  return Math.max(0, Math.ceil((quote.quotedAt + QUOTE_TTL_MS - now) / 1000));
}

export function isQuoteExpired(quote: SwapQuote, now: number) {
  return now - quote.quotedAt >= QUOTE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Wallet request guard

const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** IAdapter.execute, as encoded by @circle-fin/adapter-viem-v2 for `swap.execute`. */
export const CIRCLE_ADAPTER_EXECUTE_ABI = parseAbi([
  "function execute(((address target, bytes data, uint256 value, address tokenIn, uint256 amountToApprove, address tokenOut, uint256 minTokenOut)[] instructions, (address token, address beneficiary)[] tokens, uint256 execId, uint256 deadline, bytes metadata) params, (uint8 permitType, address token, uint256 amount, bytes permitCalldata)[] tokenInputs, bytes signature)",
]);

/** Longest accepted validity for Circle's execution deadline and for permits (the SDK uses 1 hour). */
export const MAX_SIGNATURE_WINDOW_SECONDS = 2 * 60 * 60;

/** Everything the guard needs from the quote the user confirmed. */
export type SwapGuardContext = {
  owner: Address;
  tokenIn: SwapTokenSymbol;
  tokenOut: SwapTokenSymbol;
  amountIn: bigint;
  /** Minimum output the user confirmed (base units). */
  minimumOut: bigint;
  /** Current time in seconds; injected for tests. */
  nowSeconds?: number;
};

/** Wallet methods the SDK may use for reads. Anything not listed (and not a checked signing method) is refused. */
const READ_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_accounts",
  "eth_requestAccounts",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "wallet_getCapabilities",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);

export const SIGNING_METHODS = new Set(["eth_sendTransaction", "eth_signTypedData_v4"]);

function lower(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function refuse(reason: string): never {
  throw new Error(`Refused wallet request: ${reason}`);
}

function toBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value.trim())) return BigInt(value.trim());
  return refuse(`${label} is missing or malformed`);
}

function nowSeconds(context: SwapGuardContext) {
  return context.nowSeconds ?? Math.floor(Date.now() / 1000);
}

function assertWindow(deadline: bigint, context: SwapGuardContext, label: string) {
  const now = BigInt(nowSeconds(context));
  if (deadline <= now) refuse(`${label} has expired`);
  if (deadline > now + BigInt(MAX_SIGNATURE_WINDOW_SECONDS)) refuse(`${label} is valid for too long`);
}

/** Decodes the EIP-2612 permit calldata the SDK attaches: abi.encode(value, deadline, v, r, s). */
function decodePermitCalldata(data: Hex) {
  if (!/^0x[0-9a-fA-F]{320}$/.test(data)) refuse("malformed permit calldata");
  const word = (index: number) => BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
  return { value: word(0), deadline: word(1) };
}

function assertExecuteMatchesQuote(data: unknown, context: SwapGuardContext) {
  if (typeof data !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(data)) refuse("missing call data for the adapter");
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: CIRCLE_ADAPTER_EXECUTE_ABI, data: data as Hex });
  } catch {
    return refuse("the adapter call data is not a valid execute() call");
  }
  const [params, tokenInputs] = decoded.args;
  const tokenIn = lower(SWAP_TOKENS[context.tokenIn].address);
  const tokenOut = lower(SWAP_TOKENS[context.tokenOut].address);
  const owner = lower(context.owner);

  assertWindow(params.deadline, context, "the execution deadline");

  const instructions = params.instructions;
  if (instructions.length === 0) refuse("the swap has no instructions");
  if (instructions.some((instruction) => instruction.value !== BigInt(0))) refuse("the swap sends native value");
  if (lower(instructions[0].tokenIn) !== tokenIn) refuse("the swap spends a different token");
  const last = instructions[instructions.length - 1];
  if (lower(last.tokenOut) !== tokenOut) refuse("the swap returns a different token");
  if (last.minTokenOut < context.minimumOut) refuse("the swap's minimum output is below the confirmed minimum");
  const spent = instructions
    .filter((instruction) => lower(instruction.tokenIn) === tokenIn)
    .reduce((total, instruction) => total + instruction.amountToApprove, BigInt(0));
  if (spent > context.amountIn) refuse("the swap spends more than the confirmed amount");

  if (params.tokens.length === 0) refuse("the swap has no recipient");
  if (params.tokens.some((entry) => lower(entry.beneficiary) !== owner)) refuse("tokens would be sent to another address");
  if (!params.tokens.some((entry) => lower(entry.token) === tokenOut)) refuse("the output token has no recipient");

  if (tokenInputs.length !== 1) refuse("unexpected token inputs");
  const [input] = tokenInputs;
  if (lower(input.token) !== tokenIn) refuse("the swap pulls a different token");
  if (input.amount !== context.amountIn) refuse("the swap pulls a different amount than confirmed");
  if (input.permitType === 0) {
    if (input.permitCalldata !== "0x") refuse("unexpected permit data");
  } else if (input.permitType === 1) {
    const permit = decodePermitCalldata(input.permitCalldata);
    if (permit.value !== context.amountIn) refuse("the permit covers a different amount");
    assertWindow(permit.deadline, context, "the permit");
  } else {
    refuse("unknown permit type");
  }
}

const PERMIT_FIELDS = ["owner", "spender", "value", "nonce", "deadline"];
const PERMIT_TYPES = ["address", "address", "uint256", "uint256", "uint256"];

function assertPermitMatchesQuote(params: unknown, context: SwapGuardContext) {
  const [signer, raw] = Array.isArray(params) ? params : [];
  let typed: {
    types?: Record<string, { name?: unknown; type?: unknown }[]>;
    primaryType?: unknown;
    domain?: { chainId?: unknown; verifyingContract?: unknown };
    message?: Record<string, unknown>;
  };
  try {
    typed = typeof raw === "string" ? JSON.parse(raw) : (raw as typeof typed);
  } catch {
    return refuse("the signature request is not valid typed data");
  }
  if (!typed || typeof typed !== "object") refuse("the signature request is not valid typed data");
  if (lower(signer) !== lower(context.owner)) refuse("the signer is not the connected account");
  if (typed.primaryType !== "Permit") refuse("only an EIP-2612 permit may be signed");

  const permitType = typed.types?.Permit;
  if (
    !Array.isArray(permitType) ||
    permitType.length !== PERMIT_FIELDS.length ||
    permitType.some((field, i) => field?.name !== PERMIT_FIELDS[i] || field?.type !== PERMIT_TYPES[i])
  ) {
    refuse("the permit does not have the standard EIP-2612 structure");
  }
  const extraTypes = Object.keys(typed.types ?? {}).filter((name) => name !== "Permit" && name !== "EIP712Domain");
  if (extraTypes.length > 0) refuse("the permit has unexpected types");

  if (Number(toBigInt(typed.domain?.chainId, "permit chainId")) !== ARC_MAINNET_CHAIN_ID) refuse("the permit targets the wrong network");
  if (lower(typed.domain?.verifyingContract) !== lower(SWAP_TOKENS[context.tokenIn].address)) refuse("the permit is for an unexpected token");

  const message = typed.message ?? {};
  const keys = Object.keys(message).filter((key) => message[key] !== undefined);
  if (keys.length !== PERMIT_FIELDS.length || !PERMIT_FIELDS.every((key) => keys.includes(key))) {
    refuse("the permit message has missing or extra fields");
  }
  if (lower(message.owner) !== lower(context.owner)) refuse("the permit owner is not the connected account");
  if (lower(message.spender) !== lower(CIRCLE_SWAP_ADAPTER)) refuse("the permit spender is not Circle's adapter");
  if (toBigInt(message.value, "permit value") !== context.amountIn) refuse("the permit covers a different amount than confirmed");
  toBigInt(message.nonce, "permit nonce");
  assertWindow(toBigInt(message.deadline, "permit deadline"), context, "the permit");
}

/**
 * Checks every wallet request the swap SDK makes.
 * Allowed while a confirmed quote is being executed:
 * - an exact-amount approve() of tokenIn to Circle's adapter;
 * - an EIP-2612 permit of tokenIn to the adapter for exactly the amount,
 *   on Arc, with a short deadline;
 * - adapter.execute() whose decoded instructions, recipients, input amount,
 *   permit and minimum output match the quote.
 * Known read methods pass. Everything else is refused before the wallet sees it.
 * Without a context (no swap being confirmed) no signing request passes.
 */
export function assertAllowedSwapRequest(
  method: string,
  params: unknown,
  context: SwapGuardContext | null,
): "swap" | "approve" | "permit" | "read" {
  if (READ_METHODS.has(method)) {
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
      const requested = Array.isArray(params) ? (params[0] as { chainId?: unknown })?.chainId : undefined;
      if (requested === undefined || Number(toBigInt(requested, "chainId")) !== ARC_MAINNET_CHAIN_ID) {
        refuse("the swap may only use Arc mainnet");
      }
    }
    return "read";
  }
  if (!SIGNING_METHODS.has(method)) refuse(`unsupported method ${method}`);
  if (!context) refuse("no swap is being confirmed");

  if (method === "eth_signTypedData_v4") {
    assertPermitMatchesQuote(params, context);
    return "permit";
  }

  const tx = (Array.isArray(params) ? params[0] : undefined) as Record<string, unknown> | undefined;
  if (!tx || typeof tx !== "object") refuse("invalid transaction");
  if (lower(tx.from) !== lower(context.owner)) refuse("the sender is not the connected account");
  if (tx.value !== undefined && toBigInt(tx.value, "value") !== BigInt(0)) refuse("the transaction sends native value");
  if (tx.chainId !== undefined && Number(toBigInt(tx.chainId, "chainId")) !== ARC_MAINNET_CHAIN_ID) {
    refuse("the transaction targets the wrong network");
  }
  const data = tx.data ?? tx.input;
  const to = lower(tx.to);

  if (to === lower(CIRCLE_SWAP_ADAPTER)) {
    assertExecuteMatchesQuote(data, context);
    return "swap";
  }
  if (to === lower(SWAP_TOKENS[context.tokenIn].address)) {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: APPROVE_ABI, data: data as Hex });
    } catch {
      return refuse("the token call is not an approve()");
    }
    const [spender, amount] = decoded.args;
    if (lower(spender) !== lower(CIRCLE_SWAP_ADAPTER)) refuse("approval for an unknown spender");
    if (amount !== context.amountIn) refuse("approval for a different amount than confirmed");
    return "approve";
  }
  return refuse(`transaction to an unexpected contract (${String(tx.to)})`);
}

// ---------------------------------------------------------------------------
// Arc fee parameters

export type ArcFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

function hex(value: bigint) {
  return `0x${value.toString(16)}`;
}

/**
 * Applies Arc's EIP-1559 fee parameters to a transaction request before it
 * reaches the wallet, like the event payment path does: legacy gasPrice is
 * removed and maxFeePerGas is raised to at least the Arc estimate (which
 * already includes the 20 gwei mempool floor). A higher value set by the
 * SDK or wallet is kept.
 */
export function applyArcFeesToTransaction(tx: Record<string, unknown>, fees: ArcFees): Record<string, unknown> {
  const rest = { ...tx };
  delete rest.gasPrice;
  const current = rest.maxFeePerGas === undefined ? BigInt(0) : toBigInt(rest.maxFeePerGas, "maxFeePerGas");
  const maxFeePerGas = current > fees.maxFeePerGas ? current : fees.maxFeePerGas;
  const requestedPriority =
    rest.maxPriorityFeePerGas === undefined ? fees.maxPriorityFeePerGas : toBigInt(rest.maxPriorityFeePerGas, "maxPriorityFeePerGas");
  const maxPriorityFeePerGas = requestedPriority > maxFeePerGas ? maxFeePerGas : requestedPriority;
  return { ...rest, type: "0x2", maxFeePerGas: hex(maxFeePerGas), maxPriorityFeePerGas: hex(maxPriorityFeePerGas) };
}

// ---------------------------------------------------------------------------
// Outcome verification

const TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export type SwapReceiptLike = {
  status: "success" | "reverted";
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[];
};

/** Sum of `token` transferred to `owner`, from Transfer events emitted by the token contract itself. */
export function receivedFromReceipt(receipt: SwapReceiptLike, token: Address, owner: Address) {
  let total = BigInt(0);
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(token)) continue;
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (decoded.eventName === "Transfer" && lower(decoded.args.to) === lower(owner)) {
        total += decoded.args.value;
      }
    } catch {
      // Not a Transfer event.
    }
  }
  return total;
}

export type SwapOutcome =
  | { state: "success"; received: bigint }
  | { state: "failed"; reason: string }
  /** Not mined yet (or the RPC did not answer); check again later. */
  | { state: "pending"; reason: string }
  /** Mined, but the output could not be proven from the receipt. Never shown as success. */
  | { state: "unknown"; reason: string };

/**
 * Success only with on-chain evidence: a successful receipt that contains a
 * Transfer of the output token, emitted by that token contract, to the same
 * user, for at least the confirmed minimum. SDK status values are not used.
 */
export function evaluateSwapReceipt(
  receipt: SwapReceiptLike | null,
  expected: { owner: Address; tokenOut: SwapTokenSymbol; minimumOut: bigint },
): SwapOutcome {
  if (!receipt) return { state: "pending", reason: "The swap transaction has not been confirmed yet." };
  if (receipt.status !== "success") return { state: "failed", reason: "The swap transaction reverted. Your tokens were not swapped." };
  const received = receivedFromReceipt(receipt, SWAP_TOKENS[expected.tokenOut].address, expected.owner);
  if (received > BigInt(0) && received >= expected.minimumOut) {
    return { state: "success", received };
  }
  return {
    state: "unknown",
    reason: `The transaction was mined, but a transfer of at least the minimum ${expected.tokenOut} to your address was not found in its receipt. Check it on the explorer.`,
  };
}

// ---------------------------------------------------------------------------
// Persisted swap transactions (for refresh)

export type StoredSwap = {
  version: 1;
  owner: Address;
  txHash: Hex;
  tokenIn: SwapTokenSymbol;
  tokenOut: SwapTokenSymbol;
  amountIn: string;
  minimumOut: string;
  createdAt: number;
  status: "submitted" | "success" | "failed";
  received?: string;
};

export function swapStorageKey(owner: Address) {
  return `showup:mainnet:swaps:v1:${owner.toLowerCase()}`;
}

function isStoredSwap(value: unknown): value is StoredSwap {
  const s = value as StoredSwap;
  return (
    typeof s === "object" &&
    s !== null &&
    s.version === 1 &&
    typeof s.owner === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(s.owner) &&
    typeof s.txHash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(s.txHash) &&
    isSwapToken(s.tokenIn) &&
    isSwapToken(s.tokenOut) &&
    /^\d+$/.test(s.amountIn) &&
    /^\d+$/.test(s.minimumOut) &&
    typeof s.createdAt === "number" &&
    ["submitted", "success", "failed"].includes(s.status)
  );
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function loadSwaps(storage: Storage, owner: Address): StoredSwap[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(swapStorageKey(owner)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(isStoredSwap).filter((s) => lower(s.owner) === lower(owner)).sort((a, b) => b.createdAt - a.createdAt)
      : [];
  } catch {
    return [];
  }
}

export function saveSwap(storage: Storage, swap: StoredSwap) {
  const rest = loadSwaps(storage, swap.owner).filter((s) => lower(s.txHash) !== lower(swap.txHash));
  storage.setItem(swapStorageKey(swap.owner), JSON.stringify([swap, ...rest].slice(0, 20)));
}

export function normalize(address: string): Address {
  return getAddress(address);
}
