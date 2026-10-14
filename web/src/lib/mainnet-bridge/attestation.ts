import { getAddress, type Address, type Hex } from "viem";

/**
 * Parsing and validation of Circle Iris `GET /v2/messages/{sourceDomain}` responses.
 *
 * The raw CCTP V2 message is decoded locally and compared with the transfer
 * the user started, so a wrong or unexpected message is never submitted.
 * The destination MessageTransmitter verifies the attestation over exactly
 * these bytes, which makes the raw message the authoritative source.
 *
 * MessageV2 layout (bytes):
 *   0  version(4) | 4 sourceDomain(4) | 8 destinationDomain(4) | 12 nonce(32)
 *   44 sender(32) | 76 recipient(32) | 108 destinationCaller(32)
 *   140 minFinalityThreshold(4) | 144 finalityThresholdExecuted(4) | 148 messageBody
 * BurnMessageV2 body (offsets relative to the body):
 *   0 version(4) | 4 burnToken(32) | 36 mintRecipient(32) | 68 amount(32)
 *   100 messageSender(32) | 132 maxFee(32) | 164 feeExecuted(32)
 *   196 expirationBlock(32) | 228 hookData
 */

export type DecodedBurnMessage = {
  sourceDomain: number;
  destinationDomain: number;
  nonce: Hex;
  destinationCaller: Hex;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  burnToken: Address;
  mintRecipient: Address;
  amount: bigint;
  messageSender: Address;
  maxFee: bigint;
  feeExecuted: bigint;
  expirationBlock: bigint;
};

const HEADER_BYTES = 148;
const BODY_MIN_BYTES = 228;

function slice(hex: string, startByte: number, lengthBytes: number) {
  return hex.slice(2 + startByte * 2, 2 + (startByte + lengthBytes) * 2);
}

function word(hex: string, startByte: number) {
  return BigInt(`0x${slice(hex, startByte, 32)}`);
}

function u32(hex: string, startByte: number) {
  return Number.parseInt(slice(hex, startByte, 4), 16);
}

function addressWord(hex: string, startByte: number): Address {
  const value = slice(hex, startByte, 32);
  if (!/^0{24}/.test(value)) {
    throw new Error("The CCTP message contains a non-EVM address.");
  }
  return getAddress(`0x${value.slice(24)}`);
}

export function decodeBurnMessage(message: string): DecodedBurnMessage {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(message) || (message.length - 2) / 2 < HEADER_BYTES + BODY_MIN_BYTES) {
    throw new Error("The CCTP message is malformed.");
  }
  const body = HEADER_BYTES;
  return {
    sourceDomain: u32(message, 4),
    destinationDomain: u32(message, 8),
    nonce: `0x${slice(message, 12, 32)}`.toLowerCase() as Hex,
    destinationCaller: `0x${slice(message, 108, 32)}`.toLowerCase() as Hex,
    minFinalityThreshold: u32(message, 140),
    finalityThresholdExecuted: u32(message, 144),
    burnToken: addressWord(message, body + 4),
    mintRecipient: addressWord(message, body + 36),
    amount: word(message, body + 68),
    messageSender: addressWord(message, body + 100),
    maxFee: word(message, body + 132),
    feeExecuted: word(message, body + 164),
    expirationBlock: word(message, body + 196),
  };
}

export type AttestationExpectation = {
  sourceDomain: number;
  destinationDomain: number;
  burnToken: Address;
  mintRecipient: Address;
  amount: bigint;
  depositor: Address;
  maxFee: bigint;
};

export type AttestationResult =
  | { state: "not-found" }
  | { state: "pending"; status: string; delayReason?: string }
  | {
      state: "complete";
      message: Hex;
      attestation: Hex;
      nonce: Hex;
      expirationBlock: bigint;
      feeExecuted: bigint;
      decoded: DecodedBurnMessage;
      /** Destination mint submitted by Circle's Forwarding Service, when used. */
      forwardTxHash?: Hex;
    };

type IrisMessage = {
  message?: unknown;
  attestation?: unknown;
  status?: unknown;
  delayReason?: unknown;
  forwardTxHash?: unknown;
  decodedMessage?: {
    sourceDomain?: unknown;
    destinationDomain?: unknown;
    decodedMessageBody?: { amount?: unknown; mintRecipient?: unknown } | null;
  } | null;
};

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x([0-9a-fA-F]{2})+$/.test(value);
}

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** Throws if a decoded message does not describe the transfer the user started. */
export function assertMessageMatches(decoded: DecodedBurnMessage, expected: AttestationExpectation) {
  const problems: string[] = [];
  if (decoded.sourceDomain !== expected.sourceDomain) problems.push("source domain");
  if (decoded.destinationDomain !== expected.destinationDomain) problems.push("destination domain");
  if (!sameAddress(decoded.burnToken, expected.burnToken)) problems.push("burn token");
  if (!sameAddress(decoded.mintRecipient, expected.mintRecipient)) problems.push("recipient");
  if (decoded.amount !== expected.amount) problems.push("amount");
  if (!sameAddress(decoded.messageSender, expected.depositor)) problems.push("sender");
  if (decoded.maxFee !== expected.maxFee) problems.push("max fee");
  if (decoded.destinationCaller !== ZERO_BYTES32) problems.push("destination caller");
  if (problems.length > 0) {
    throw new Error(`The attested CCTP message does not match this transfer (${problems.join(", ")}).`);
  }
}

/**
 * Interprets an Iris response. Pending messages may not include a usable
 * message yet; complete ones are decoded and validated before being returned.
 * One burn transaction normally produces one message; if there are several,
 * only the one matching this transfer is used.
 */
export function parseIrisMessages(body: unknown, expected: AttestationExpectation): AttestationResult {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { state: "not-found" };
  }

  let pending: AttestationResult | null = null;
  const mismatches: string[] = [];

  for (const raw of messages as IrisMessage[]) {
    const status = typeof raw?.status === "string" ? raw.status : "unknown";
    const attestationReady =
      status === "complete" && isHex(raw.attestation) && isHex(raw.message);

    if (!attestationReady) {
      // Before attestation the message bytes may be incomplete; use the
      // decoded summary only to ignore unrelated messages.
      const decodedBody = raw?.decodedMessage?.decodedMessageBody;
      const amount = decodedBody?.amount;
      if (amount !== undefined && String(amount) !== expected.amount.toString()) {
        continue;
      }
      pending = {
        state: "pending",
        status,
        ...(typeof raw?.delayReason === "string" && raw.delayReason ? { delayReason: raw.delayReason } : {}),
      };
      continue;
    }

    const decoded = decodeBurnMessage(raw.message as string);
    try {
      assertMessageMatches(decoded, expected);
    } catch (error) {
      mismatches.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    if (decoded.nonce === ZERO_BYTES32) {
      pending = { state: "pending", status: "nonce-unassigned" };
      continue;
    }

    return {
      state: "complete",
      message: raw.message as Hex,
      attestation: raw.attestation as Hex,
      nonce: decoded.nonce,
      expirationBlock: decoded.expirationBlock,
      feeExecuted: decoded.feeExecuted,
      decoded,
      ...(typeof raw.forwardTxHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(raw.forwardTxHash)
        ? { forwardTxHash: raw.forwardTxHash as Hex }
        : {}),
    };
  }

  if (pending) {
    return pending;
  }
  if (mismatches.length > 0) {
    throw new Error(mismatches[0]);
  }
  return { state: "not-found" };
}

/** Fast-transfer attestations expire; standard ones have expirationBlock 0. */
export function isAttestationExpired(expirationBlock: bigint, currentBlock: bigint) {
  return expirationBlock !== BigInt(0) && currentBlock >= expirationBlock;
}
