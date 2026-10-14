import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";

import {
  advanceTransfer,
  canReceive,
  discardTransfer,
  previewBridge,
  receiveTransfer,
  recoverFromBurnHash,
  startBridge,
  CCTP_V2_TOKEN_MINTER,
  STALE_MINT_MS,
  type BridgeRequest,
  type BridgeRuntime,
  type BurnArgs,
  type TxReceipt,
} from "../src/lib/mainnet-bridge/bridge-engine";
import { MESSAGE_TRANSMITTER_V2_ABI, TOKEN_MESSENGER_V2_ABI, TOKEN_MINTER_V2_EVENTS_ABI } from "../src/lib/mainnet-bridge/cctp-abi";
import { decodeBurnMessage, parseIrisMessages } from "../src/lib/mainnet-bridge/attestation";
import {
  BRIDGE_CHAINS,
  CCTP_FORWARDING_HOOK_DATA,
  CCTP_V2_MESSAGE_TRANSMITTER,
  CCTP_V2_TOKEN_MESSENGER,
  addressToBytes32,
  computeTransferFees,
  parseUsdcAmount,
  supportedSpeeds,
  type BridgeChainKey,
  type BurnFeeTier,
} from "../src/lib/mainnet-bridge/cctp-routes";
import { loadTransfers, saveTransfer, storageKeyFor, type BridgeTransfer } from "../src/lib/mainnet-bridge/transfer-store";

const owner: Address = "0x1111111111111111111111111111111111111111";
const other: Address = "0x2222222222222222222222222222222222222222";
const ONE_USDC = BigInt(1_000_000);
const E18 = BigInt(10) ** BigInt(18);
const GWEI = BigInt(1_000_000_000);
const NONCE: Hex = `0x${"ab".repeat(32)}`;

function hash(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

function u32(n: number) {
  return n.toString(16).padStart(8, "0");
}

function w(value: bigint | string) {
  return (typeof value === "bigint" ? value.toString(16) : value.replace(/^0x/, "")).padStart(64, "0");
}

/** Builds a CCTP V2 burn message with the documented byte layout. */
function burnMessage(opts: {
  source: number;
  destination: number;
  nonce?: Hex;
  burnToken: Address;
  recipient: Address;
  amount: bigint;
  sender: Address;
  maxFee: bigint;
  feeExecuted?: bigint;
  expirationBlock?: bigint;
}): Hex {
  const header =
    u32(1) +
    u32(opts.source) +
    u32(opts.destination) +
    w(opts.nonce ?? NONCE) +
    w(CCTP_V2_TOKEN_MESSENGER.toLowerCase()) +
    w(CCTP_V2_TOKEN_MESSENGER.toLowerCase()) +
    w("0x0") +
    u32(2000) +
    u32(2000);
  const body =
    u32(1) +
    w(opts.burnToken.toLowerCase()) +
    w(opts.recipient.toLowerCase()) +
    w(opts.amount) +
    w(opts.sender.toLowerCase()) +
    w(opts.maxFee) +
    w(opts.feeExecuted ?? BigInt(0)) +
    w(opts.expirationBlock ?? BigInt(0));
  return `0x${header}${body}`;
}

function depositLog(args: BurnArgs & { depositor: Address }) {
  const topics = encodeEventTopics({
    abi: TOKEN_MESSENGER_V2_ABI,
    eventName: "DepositForBurn",
    args: { burnToken: args.burnToken, depositor: args.depositor, minFinalityThreshold: args.minFinalityThreshold },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes" },
    ],
    [args.amount, args.mintRecipient, args.destinationDomain, hash(0), hash(0), args.maxFee, args.hookData ?? "0x"],
  );
  return { address: CCTP_V2_TOKEN_MESSENGER, topics: topics as Hex[], data };
}

function mintLogs(nonce: Hex, recipient: Address, minted: bigint) {
  const received = {
    address: CCTP_V2_MESSAGE_TRANSMITTER,
    topics: encodeEventTopics({
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      eventName: "MessageReceived",
      args: { caller: recipient, nonce, finalityThresholdExecuted: 2000 },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }, { type: "bytes" }], [0, hash(0), "0x"]),
  };
  const mint = {
    address: CCTP_V2_TOKEN_MINTER,
    topics: encodeEventTopics({
      abi: TOKEN_MINTER_V2_EVENTS_ABI,
      eventName: "MintAndWithdraw",
      args: { mintRecipient: recipient, mintToken: BRIDGE_CHAINS.arc.usdc },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [minted, BigInt(0)]),
  };
  return [received, mint];
}

class MemoryStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

type Fake = ReturnType<typeof createFake>;

function createFake() {
  let txCounter = 0;
  const state = {
    now: 1_000_000,
    account: owner as Address,
    chain: "ethereum" as BridgeChainKey,
    usdc: { arc: BigInt(50) * ONE_USDC, ethereum: BigInt(50) * ONE_USDC, base: BigInt(50) * ONE_USDC } as Record<BridgeChainKey, bigint>,
    native: { arc: BigInt(50) * E18, ethereum: E18 / BigInt(10), base: E18 / BigInt(100) } as Record<BridgeChainKey, bigint>,
    allowance: BigInt(0),
    gasPrice: { arc: BigInt(20) * GWEI, ethereum: BigInt(10) * GWEI, base: GWEI / BigInt(10) } as Record<BridgeChainKey, bigint>,
    receipts: new Map<string, TxReceipt | null>(),
    /** Overrides receipts for burns/mints, in order of submission. */
    burnReceipt: "success" as "success" | "reverted" | "missing",
    mintReceipt: [] as Array<"success" | "reverted" | "missing">,
    burnError: null as Error | null,
    mintError: null as Error | null,
    irisResponses: [] as unknown[],
    iris: null as unknown,
    usedNonces: new Set<string>(),
    blockNumber: BigInt(100),
    tiers: [
      { finalityThreshold: 1000, minimumFee: "1.3", forwardFee: { low: "10000", med: "20000", high: "50000" } },
      { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: "10000", med: "20000", high: "50000" } },
    ] as BurnFeeTier[],
    reattests: [] as Hex[],
  };
  const calls: string[] = [];
  const burns: BurnArgs[] = [];
  const storage = new MemoryStorage();
  let lastBurn: (BurnArgs & { from: BridgeChainKey }) | null = null;

  const runtime: BridgeRuntime = {
    storage,
    now: () => state.now,
    activeAccount: async () => state.account,
    ensureChain: async (chain) => {
      calls.push(`switch:${chain}`);
      state.chain = chain;
    },
    usdcBalance: async (chain) => state.usdc[chain],
    nativeBalance: async (chain) => state.native[chain],
    allowance: async () => state.allowance,
    gasPrice: async (chain) => state.gasPrice[chain],
    approve: async (_chain, _owner, amount) => {
      calls.push(`approve:${amount}`);
      state.allowance = amount;
      const h = hash(++txCounter);
      state.receipts.set(h, { status: "success", logs: [] });
      return h;
    },
    burn: async (chain, _owner, args) => {
      calls.push(`burn:${chain}`);
      if (state.burnError) throw state.burnError;
      burns.push(args);
      lastBurn = { ...args, from: chain };
      const h = hash(++txCounter);
      state.receipts.set(
        h,
        state.burnReceipt === "missing"
          ? null
          : { status: state.burnReceipt, logs: state.burnReceipt === "success" ? [depositLog({ ...args, depositor: state.account })] : [] },
      );
      return h;
    },
    mint: async (chain) => {
      calls.push(`mint:${chain}`);
      if (state.mintError) throw state.mintError;
      const h = hash(++txCounter);
      const outcome = state.mintReceipt.shift() ?? "success";
      if (outcome === "success") {
        state.usedNonces.add(NONCE);
        state.receipts.set(h, { status: "success", logs: mintLogs(NONCE, owner, BigInt(10) * ONE_USDC) });
      } else {
        state.receipts.set(h, outcome === "missing" ? null : { status: "reverted", logs: [] });
      }
      return h;
    },
    waitForReceipt: async (_chain, h) => state.receipts.get(h) ?? null,
    fetchMessages: async () => (state.irisResponses.length ? state.irisResponses.shift() : state.iris),
    fetchFeeTiers: async () => state.tiers,
    isNonceUsed: async (_chain, nonce) => state.usedNonces.has(nonce),
    blockNumber: async () => state.blockNumber,
    requestReattest: async (nonce) => {
      state.reattests.push(nonce);
    },
  };

  /** Makes Iris return a complete attestation for the most recent burn. */
  function attest(extra: { forwardTxHash?: Hex; expirationBlock?: bigint; tamper?: Partial<{ amount: bigint; recipient: Address }> } = {}) {
    assert.ok(lastBurn, "no burn yet");
    const source = BRIDGE_CHAINS[lastBurn.from];
    const destination = Object.values(BRIDGE_CHAINS).find((c) => c.domain === lastBurn!.destinationDomain)!;
    state.iris = {
      messages: [
        {
          status: "complete",
          attestation: `0x${"11".repeat(65)}`,
          message: burnMessage({
            source: source.domain,
            destination: destination.domain,
            burnToken: source.usdc,
            recipient: extra.tamper?.recipient ?? owner,
            amount: extra.tamper?.amount ?? lastBurn.amount,
            sender: owner,
            maxFee: lastBurn.maxFee,
            expirationBlock: extra.expirationBlock,
          }),
          ...(extra.forwardTxHash ? { forwardTxHash: extra.forwardTxHash } : {}),
        },
      ],
    };
  }

  return { state, calls, burns, storage, runtime, attest };
}

function request(overrides: Partial<BridgeRequest> = {}): BridgeRequest {
  return { owner, from: "ethereum", to: "arc", amountText: "10", speed: "standard", delivery: "self", ...overrides };
}

async function started(fake: Fake, overrides: Partial<BridgeRequest> = {}) {
  const preview = await previewBridge(fake.runtime, request(overrides));
  return startBridge(fake.runtime, preview);
}

function stored(fake: Fake) {
  return loadTransfers(fake.storage, owner);
}

// --- Routes and fees ---------------------------------------------------------

test("only Arc <-> Ethereum/Base routes exist and Fast Transfer is unavailable from Arc", async () => {
  assert.deepEqual(supportedSpeeds("arc"), ["standard"]);
  assert.deepEqual(supportedSpeeds("ethereum"), ["standard", "fast"]);
  const fake = createFake();
  await assert.rejects(previewBridge(fake.runtime, request({ from: "ethereum", to: "base" })), /not supported/);
  await assert.rejects(previewBridge(fake.runtime, request({ from: "arc", to: "base", speed: "fast" })), /Fast Transfer is not available/);
});

test("amount parsing rejects malformed and excess-precision input", () => {
  assert.equal(parseUsdcAmount("1.5"), BigInt(1_500_000));
  assert.equal(parseUsdcAmount("0.000001"), BigInt(1));
  for (const bad of ["", "0", "-1", "1e3", "1.0000001", "1,5", "abc"]) {
    assert.throws(() => parseUsdcAmount(bad));
  }
});

test("fast and forwarding fees produce a maxFee with buffer and a guaranteed minimum", () => {
  const fees = computeTransferFees({ amount: BigInt(100) * ONE_USDC, scaledBps: BigInt(130), forward: { med: BigInt(20_000), high: BigInt(50_000) } });
  assert.equal(fees.protocolFee, BigInt(13_000)); // 1.3 bps of 100 USDC
  assert.equal(fees.maxFee, BigInt(15_600) + BigInt(50_000));
  assert.equal(fees.minimumReceived, BigInt(100) * ONE_USDC - fees.maxFee);
  assert.equal(fees.expectedReceived, BigInt(100) * ONE_USDC - BigInt(13_000) - BigInt(20_000));
  assert.throws(() => computeTransferFees({ amount: BigInt(40_000), scaledBps: BigInt(0), forward: { med: BigInt(20_000), high: BigInt(50_000) } }), /too small/);
});

// --- Preflight -----------------------------------------------------------------

test("preview flags missing USDC, source gas and destination gas", async () => {
  const fake = createFake();
  fake.state.usdc.ethereum = BigInt(5) * ONE_USDC;
  assert.match((await previewBridge(fake.runtime, request())).problems.join(), /Insufficient USDC on Ethereum/);

  const noEth = createFake();
  noEth.state.native.ethereum = BigInt(1);
  assert.match((await previewBridge(noEth.runtime, request())).problems.join(), /ETH on Ethereum/);

  const noArcGas = createFake();
  noArcGas.state.native.arc = BigInt(0);
  const preview = await previewBridge(noArcGas.runtime, request());
  assert.match(preview.problems.join(), /USDC on Arc to submit the receive transaction/);
  // Circle delivery does not need destination gas.
  assert.deepEqual((await previewBridge(noArcGas.runtime, request({ delivery: "forwarding" }))).problems, []);
});

test("on Arc the bridged amount and the gas come from the same USDC balance", async () => {
  const fake = createFake();
  fake.state.usdc.arc = BigInt(10) * ONE_USDC;
  fake.state.native.arc = BigInt(10) * E18; // exactly the amount, nothing left for gas
  const preview = await previewBridge(fake.runtime, request({ from: "arc", to: "base" }));
  assert.match(preview.problems.join(), /amount plus network fees/);
});

test("problems or an expired quote prevent any wallet transaction", async () => {
  const fake = createFake();
  fake.state.usdc.ethereum = BigInt(1);
  const preview = await previewBridge(fake.runtime, request());
  await assert.rejects(startBridge(fake.runtime, preview), /Insufficient USDC/);

  const ok = createFake();
  const fresh = await previewBridge(ok.runtime, request());
  ok.state.now += 61_000;
  await assert.rejects(startBridge(ok.runtime, fresh), /expired/);
  assert.deepEqual([...fake.calls, ...ok.calls], []);
});

// --- Happy path ------------------------------------------------------------------

test("approve exact amount, burn once, attest, mint and verify on-chain", async () => {
  const fake = createFake();
  let transfer = await started(fake);
  assert.deepEqual(fake.calls, ["switch:ethereum", `approve:${BigInt(10) * ONE_USDC}`, "burn:ethereum"]);
  assert.equal(fake.burns[0].destinationDomain, 26);
  assert.equal(fake.burns[0].mintRecipient, addressToBytes32(owner));
  assert.equal(fake.burns[0].maxFee, BigInt(0));
  assert.equal(fake.burns[0].minFinalityThreshold, 2000);
  assert.equal(fake.burns[0].hookData, undefined);
  assert.equal(transfer.status, "awaiting-attestation");

  // Iris has nothing yet, then a pending message.
  fake.state.iris = null;
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "awaiting-attestation");
  fake.state.iris = { messages: [{ status: "pending_confirmations", attestation: "PENDING", message: "0x" }] };
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "awaiting-attestation");

  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "ready-to-mint");
  assert.equal(transfer.nonce, NONCE);

  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "completed");
  assert.equal(transfer.completedBy, "mint");
  assert.equal(transfer.receivedAmount, (BigInt(10) * ONE_USDC).toString());
  assert.ok(transfer.mintTxHash);
  assert.equal(fake.burns.length, 1);
});

test("existing allowance skips the approval", async () => {
  const fake = createFake();
  fake.state.allowance = BigInt(100) * ONE_USDC;
  await started(fake);
  assert.deepEqual(fake.calls, ["switch:ethereum", "burn:ethereum"]);
});

// --- Refresh and recovery ----------------------------------------------------------

test("a refresh at any stage resumes from storage without burning again", async () => {
  const fake = createFake();
  fake.state.burnReceipt = "missing"; // still pending when the page reloads
  const first = await started(fake);
  assert.equal(first.status, "burn-submitted");

  // "Reload": only the stored record survives.
  let [transfer] = stored(fake);
  assert.equal(transfer.burnTxHash, first.burnTxHash);
  fake.state.receipts.set(first.burnTxHash!, {
    status: "success",
    logs: [depositLog({ ...fake.burns[0], depositor: owner })],
  });
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "awaiting-attestation");

  fake.attest();
  [transfer] = stored(fake);
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "ready-to-mint");

  [transfer] = stored(fake);
  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "completed");
  assert.equal(fake.burns.length, 1);
  assert.equal(fake.calls.filter((c) => c.startsWith("burn")).length, 1);
});

test("the record is persisted before the burn is signed; storage failure prevents the burn", async () => {
  const fake = createFake();
  fake.state.allowance = BigInt(100) * ONE_USDC;
  fake.storage.failWrites = true;
  const preview = await previewBridge(fake.runtime, request());
  await assert.rejects(startBridge(fake.runtime, preview), /Quota/);
  assert.equal(fake.burns.length, 0);
});

test("an interrupted signature blocks new burns until recovered by hash or discarded", async () => {
  const fake = createFake();
  fake.state.allowance = BigInt(100) * ONE_USDC;
  fake.state.burnError = new Error("Wallet connection lost");
  await assert.rejects(started(fake), /connection lost/);
  let [pending] = stored(fake);
  assert.equal(pending.status, "burn-requested");

  fake.state.burnError = null;
  await assert.rejects(started(fake), /interrupted/);
  assert.equal(fake.burns.length, 0);

  // Discard is allowed because no burn hash was recorded.
  discardTransfer(fake.runtime, pending);
  [pending] = stored(fake);
  assert.equal(pending.status, "discarded");
  await started(fake);
  assert.equal(fake.burns.length, 1);
});

test("a wallet rejection of the burn is recorded as discarded and burns nothing", async () => {
  const fake = createFake();
  fake.state.allowance = BigInt(100) * ONE_USDC;
  fake.state.burnError = Object.assign(new Error("User rejected the request."), { code: 4001 });
  await assert.rejects(started(fake), /rejected/);
  assert.equal(stored(fake)[0].status, "discarded");
  assert.equal(fake.burns.length, 0);
});

test("recover by burn hash rebuilds the transfer and resolves the interrupted record", async () => {
  const fake = createFake();
  fake.state.allowance = BigInt(100) * ONE_USDC;
  // The wallet broadcasts but the page reloads before the hash comes back.
  const realBurn = fake.runtime.burn;
  let broadcastHash: Hex = "0x";
  fake.runtime.burn = async (...args) => {
    broadcastHash = await realBurn(...args);
    throw new Error("Page reloaded");
  };
  await assert.rejects(started(fake));
  fake.runtime.burn = realBurn;
  assert.equal(stored(fake)[0].status, "burn-requested");

  fake.attest();
  const recovered = await recoverFromBurnHash(fake.runtime, { owner, from: "ethereum", burnTxHash: broadcastHash });
  assert.equal(recovered.status, "ready-to-mint");
  assert.equal(recovered.amount, (BigInt(10) * ONE_USDC).toString());
  assert.equal(stored(fake).length, 1, "the interrupted record was replaced, not duplicated");
  assert.equal(fake.burns.length, 1);
});

test("recovery rejects burns from another account or non-CCTP transactions", async () => {
  const fake = createFake();
  fake.state.allowance = BigInt(100) * ONE_USDC;
  fake.state.account = other;
  const preview = await previewBridge(fake.runtime, request({ owner: other }));
  const transfer = await startBridge(fake.runtime, preview);
  await assert.rejects(
    recoverFromBurnHash(fake.runtime, { owner, from: "ethereum", burnTxHash: transfer.burnTxHash! }),
    /different account/,
  );
  fake.state.receipts.set(hash(999), { status: "success", logs: [] });
  await assert.rejects(recoverFromBurnHash(fake.runtime, { owner, from: "ethereum", burnTxHash: hash(999) }), /not a CCTP V2 burn/);
});

// --- Failures ----------------------------------------------------------------------

test("a reverted burn is final and never treated as success", async () => {
  const fake = createFake();
  fake.state.burnReceipt = "reverted";
  const transfer = await started(fake);
  assert.equal(transfer.status, "burn-failed");
  fake.attest();
  assert.equal((await advanceTransfer(fake.runtime, transfer)).status, "burn-failed");
  assert.equal(canReceive(transfer, fake.state.now), false);
});

test("a failed mint can be retried without another burn", async () => {
  const fake = createFake();
  fake.state.mintReceipt = ["reverted", "success"];
  let transfer = await started(fake);
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "mint-failed");
  assert.match(transfer.lastError ?? "", /retry/);

  transfer = await receiveTransfer(fake.runtime, stored(fake)[0]);
  assert.equal(transfer.status, "completed");
  assert.equal(transfer.mintAttempts, 2);
  assert.equal(fake.burns.length, 1);
});

test("a rejected mint prompt leaves the transfer retryable", async () => {
  const fake = createFake();
  let transfer = await started(fake);
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  fake.state.mintError = Object.assign(new Error("User denied transaction signature"), { code: 4001 });
  await assert.rejects(receiveTransfer(fake.runtime, transfer), /rejected/);
  assert.equal(stored(fake)[0].status, "mint-failed");
  fake.state.mintError = null;
  assert.equal((await receiveTransfer(fake.runtime, stored(fake)[0])).status, "completed");
});

test("an already used nonce completes the transfer without sending a mint", async () => {
  const fake = createFake();
  let transfer = await started(fake);
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  fake.state.usedNonces.add(NONCE); // minted elsewhere (relayer, other tab)
  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "completed");
  assert.equal(transfer.completedBy, "already-received");
  assert.equal(fake.calls.filter((c) => c.startsWith("mint")).length, 0);
});

test("a dropped mint becomes retryable after a timeout", async () => {
  const fake = createFake();
  fake.state.mintReceipt = ["missing"];
  let transfer = await started(fake);
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "mint-submitted");
  assert.equal(canReceive(transfer, fake.state.now), false);
  fake.state.now += STALE_MINT_MS + 1;
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "mint-failed");
  assert.equal((await receiveTransfer(fake.runtime, transfer)).status, "completed");
});

test("account and network changes stop the operation before signing", async () => {
  const fake = createFake();
  const preview = await previewBridge(fake.runtime, request());
  fake.state.account = other;
  await assert.rejects(startBridge(fake.runtime, preview), /account changed/);
  assert.equal(fake.burns.length, 0);

  fake.state.account = owner;
  let transfer = await startBridge(fake.runtime, preview);
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  fake.state.account = other;
  await assert.rejects(receiveTransfer(fake.runtime, transfer), /account changed/);
  assert.equal(fake.calls.filter((c) => c.startsWith("mint")).length, 0);
  fake.state.account = owner;
  await receiveTransfer(fake.runtime, transfer);
  assert.ok(fake.calls.includes("switch:arc"), "the wallet is switched to the destination before minting");
});

test("receive is blocked without destination gas and the transfer stays claimable", async () => {
  const fake = createFake();
  let transfer = await started(fake);
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  fake.state.native.arc = BigInt(0);
  await assert.rejects(receiveTransfer(fake.runtime, transfer), /stays claimable/);
  assert.equal(stored(fake)[0].status, "ready-to-mint");
});

test("an expired fast attestation is re-attested instead of re-burned", async () => {
  const fake = createFake();
  let transfer = await started(fake, { speed: "fast" });
  assert.equal(fake.burns[0].minFinalityThreshold, 1000);
  assert.ok(fake.burns[0].maxFee > BigInt(0));
  fake.attest({ expirationBlock: BigInt(150) });
  transfer = await advanceTransfer(fake.runtime, transfer);
  fake.state.blockNumber = BigInt(200);
  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "awaiting-attestation");
  assert.deepEqual(fake.state.reattests, [NONCE]);
  assert.equal(fake.burns.length, 1);
});

test("an attestation for a different amount or recipient is rejected", async () => {
  const fake = createFake();
  let transfer = await started(fake);
  fake.attest({ tamper: { amount: BigInt(999) * ONE_USDC } });
  await assert.rejects(advanceTransfer(fake.runtime, transfer), /does not match/);
  fake.attest({ tamper: { recipient: other } });
  await assert.rejects(advanceTransfer(fake.runtime, transfer), /does not match/);
  transfer = stored(fake)[0];
  assert.equal(transfer.status, "awaiting-attestation");
  assert.equal(transfer.message, undefined);
});

// --- Circle Forwarding Service ---------------------------------------------------------

test("forwarding sets hookData and completes from Circle's verified mint", async () => {
  const fake = createFake();
  fake.state.native.arc = BigInt(0); // a new Arc user without gas
  let transfer = await started(fake, { delivery: "forwarding" });
  assert.equal(fake.burns[0].hookData, CCTP_FORWARDING_HOOK_DATA);
  assert.equal(fake.burns[0].maxFee, BigInt(50_000));

  const forwardTx = hash(4242);
  fake.state.usedNonces.add(NONCE);
  fake.state.receipts.set(forwardTx, { status: "success", logs: mintLogs(NONCE, owner, BigInt(9_980_000)) });
  fake.attest({ forwardTxHash: forwardTx });
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "completed");
  assert.equal(transfer.completedBy, "forwarding");
  assert.equal(transfer.mintTxHash, forwardTx);
  assert.equal(fake.calls.filter((c) => c.startsWith("mint")).length, 0);
});

test("if forwarding stalls the user can still receive with the same attestation", async () => {
  const fake = createFake();
  let transfer = await started(fake, { delivery: "forwarding" });
  fake.attest();
  transfer = await advanceTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "ready-to-mint");
  transfer = await receiveTransfer(fake.runtime, transfer);
  assert.equal(transfer.status, "completed");
  assert.equal(fake.burns.length, 1);
});

// --- Storage and parsing ---------------------------------------------------------------

test("tampered or malformed stored records are ignored", () => {
  const storage = new MemoryStorage();
  const valid: BridgeTransfer = {
    version: 1, id: "a", owner, from: "arc", to: "base", amount: "1000000", speed: "standard", delivery: "self",
    maxFee: "0", recipient: owner, status: "awaiting-attestation", createdAt: 1, updatedAt: 1, mintAttempts: 0,
    burnTxHash: hash(1),
  };
  saveTransfer(storage, valid);
  const raw = JSON.parse(storage.getItem(storageKeyFor(owner))!);
  raw.push({ ...valid, id: "b", amount: "-5" }, { ...valid, id: "c", status: "ready-to-mint", burnTxHash: undefined }, "junk");
  storage.setItem(storageKeyFor(owner), JSON.stringify(raw));
  assert.deepEqual(loadTransfers(storage, owner).map((t) => t.id), ["a"]);
  storage.setItem(storageKeyFor(owner), "{not json");
  assert.deepEqual(loadTransfers(storage, owner), []);
});

test("the message decoder follows the CCTP V2 layout", () => {
  const message = burnMessage({
    source: 0, destination: 26, burnToken: BRIDGE_CHAINS.ethereum.usdc, recipient: owner,
    amount: BigInt(123), sender: owner, maxFee: BigInt(7), feeExecuted: BigInt(3), expirationBlock: BigInt(99),
  });
  const decoded = decodeBurnMessage(message);
  assert.equal(decoded.sourceDomain, 0);
  assert.equal(decoded.destinationDomain, 26);
  assert.equal(decoded.nonce, NONCE);
  assert.equal(decoded.amount, BigInt(123));
  assert.equal(decoded.maxFee, BigInt(7));
  assert.equal(decoded.feeExecuted, BigInt(3));
  assert.equal(decoded.expirationBlock, BigInt(99));
  assert.equal(decoded.mintRecipient.toLowerCase(), owner);
  assert.throws(() => decodeBurnMessage("0x1234"), /malformed/);
  const expected = {
    sourceDomain: 0, destinationDomain: 26, burnToken: BRIDGE_CHAINS.ethereum.usdc, mintRecipient: owner,
    amount: BigInt(123), depositor: owner, maxFee: BigInt(7),
  };
  assert.deepEqual(parseIrisMessages({ messages: [] }, expected), { state: "not-found" });
  assert.equal(parseIrisMessages({ messages: [{ status: "complete", attestation: `0x${"11".repeat(65)}`, message }] }, expected).state, "complete");
});
