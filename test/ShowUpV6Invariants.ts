import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Address, Hash, Hex } from "viem";

/**
 * Randomized operation sequences against ShowUpV6. After every step the
 * contract's bookkeeping must match what an independent model computes from
 * reservation statuses, and the token balance held by the contract must
 * cover every open obligation exactly.
 */

const { viem, networkHelpers } = await network.create();

const CAP = 50_000_000n;
const DEPOSIT = 2_000_000n;
const UPFRONT = 3_000_000n;
const PRICE = 10_000_000n;
const INITIAL_BALANCE = 1_000_000_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// ReservationStatus enum
const S = {
  None: 0,
  Reserved: 1,
  Cancelled: 2,
  Attended: 3,
  NoShow: 4,
  FallbackRefunded: 5,
  EventCancelledRefunded: 6,
  PaymentDue: 7,
  Completed: 8,
  PaymentDefaulted: 9,
} as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runSequence(seed: number, steps: number) {
  const rand = mulberry32(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(rand() * items.length)];

  const wallets = await viem.getWalletClients();
  const [organizer, ...rest] = wallets;
  const attendees = rest.slice(0, 4);
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const usdc = await viem.deployContract("MockBlocklistUSDC");
  const showUp = await viem.deployContract("ShowUpV6", [usdc.address, CAP]);

  const wait = async (tx: Promise<Hash>) => {
    const hash = await tx;
    await publicClient.waitForTransactionReceipt({ hash });
  };

  for (const wallet of attendees) {
    await wait(usdc.write.mint([wallet.account.address, INITIAL_BALANCE]));
    await wait(
      usdc.write.approve([showUp.address, INITIAL_BALANCE], {
        account: wallet.account,
      }),
    );
  }
  const totalSupply = await usdc.read.totalSupply();

  const now = async () => (await publicClient.getBlock()).timestamp;

  // Three events with different shapes, sharing one timeline.
  const t0 = await now();
  const timeline = {
    cancellationDeadline: t0 + 3_600n,
    paymentDeadline: t0 + 5_400n,
    eventStart: t0 + 7_200n,
    eventEnd: t0 + 10_800n,
    resolutionDeadline: t0 + 14_400n,
  };
  const shapes = [
    { type: 0, deposit: DEPOSIT, price: 0n, paymentDeadline: 0n, capacity: 3n },
    {
      type: 1,
      deposit: UPFRONT,
      price: PRICE,
      paymentDeadline: timeline.paymentDeadline,
      capacity: 0n,
    },
    { type: 1, deposit: UPFRONT, price: PRICE, paymentDeadline: 0n, capacity: 2n },
  ];
  for (const shape of shapes) {
    await wait(
      showUp.write.createEvent(
        [
          "Fuzz",
          "",
          "https://showup.example/f.json",
          shape.type,
          0,
          shape.deposit,
          shape.price,
          shape.capacity,
          timeline.cancellationDeadline,
          timeline.eventStart,
          timeline.eventEnd,
          timeline.resolutionDeadline,
          shape.paymentDeadline,
        ],
        { account: organizer.account },
      ),
    );
  }
  const eventIds = [1n, 2n, 3n];

  async function signCode(eventId: bigint) {
    const issuedAt = await now();
    const expiry = issuedAt + 600n;
    const signature = (await organizer.signTypedData({
      account: organizer.account,
      domain: {
        name: "ShowUp",
        version: "6",
        chainId,
        verifyingContract: showUp.address,
      },
      types: {
        CheckIn: [
          { name: "eventId", type: "uint256" },
          { name: "attendee", type: "address" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
        ],
      },
      primaryType: "CheckIn",
      message: { eventId, attendee: ZERO, issuedAt, expiry },
    })) as Hex;
    return { issuedAt, expiry, signature };
  }

  type Action = () => Promise<unknown>;
  const actions: Record<string, (eventId: bigint, who: (typeof attendees)[number]) => Action> = {
    reserve: (e, w) => () =>
      showUp.write.reserveSeat([e], { account: w.account }),
    reserveFull: (e, w) => () =>
      showUp.write.reserveSeatAndPayFull([e], { account: w.account }),
    // Only event 2 takes deposits with a later balance payment.
    payRemaining: (_e, w) => () =>
      showUp.write.payRemainingBalance([2n], { account: w.account }),
    cancelReservation: (e, w) => () =>
      showUp.write.cancelReservation([e], { account: w.account }),
    confirm: (e, w) => () =>
      showUp.write.confirmAttendance([e, w.account.address], {
        account: organizer.account,
      }),
    batchConfirm: (e) => () =>
      showUp.write.batchConfirmAttendance(
        [e, attendees.slice(0, 1 + Math.floor(rand() * 4)).map((a) => a.account.address)],
        { account: organizer.account },
      ),
    noShow: (e, w) => () =>
      showUp.write.settleNoShow([e, w.account.address], {
        account: organizer.account,
      }),
    batchNoShow: (e) => () =>
      showUp.write.batchSettleNoShow(
        [e, attendees.slice(0, 1 + Math.floor(rand() * 4)).map((a) => a.account.address)],
        { account: organizer.account },
      ),
    markDefault: (_e, w) => () =>
      showUp.write.markPaymentDefault([2n, w.account.address], {
        account: attendees[0].account,
      }),
    fallback: (e, w) => () =>
      showUp.write.claimFallbackRefund([e], { account: w.account }),
    // Only event 3 can be cancelled, so the other two live long enough to
    // reach attendance and no-show settlement.
    cancelEvent: () => () =>
      showUp.write.cancelEvent([3n], { account: organizer.account }),
    cancelledRefund: (_e, w) => () =>
      showUp.write.claimCancelledEventRefund([3n], { account: w.account }),
    checkIn: (e, w) => async () => {
      const code = await signCode(e);
      return showUp.write.checkIn(
        [e, ZERO, code.issuedAt, code.expiry, code.signature],
        { account: w.account },
      );
    },
    block: (_e, w) => () =>
      usdc.write.setBlocked([w.account.address, rand() < 0.25]),
    advance: () => () =>
      networkHelpers.time.increase(BigInt(1 + Math.floor(rand() * 120))),
  };
  // Weight the actions that open reservations so the settlement paths have
  // something to act on.
  const names = [
    ...Object.keys(actions),
    "reserve",
    "reserve",
    "reserveFull",
    "payRemaining",
    "payRemaining",
    "cancelledRefund",
    "cancelledRefund",
    "markDefault",
    "markDefault",
  ];

  const succeeded: Record<string, number> = {};
  // Walk through the event's lifecycle in phases so every window is visited:
  // open, after the payment deadline, during the event, after it ended, and
  // after the resolution deadline.
  const phaseStarts = [
    t0,
    timeline.paymentDeadline + 1n,
    timeline.eventStart,
    timeline.eventEnd,
    timeline.resolutionDeadline + 1n,
  ];
  const stepsPerPhase = Math.ceil(steps / phaseStarts.length);

  for (let step = 0; step < steps; step++) {
    if (step % stepsPerPhase === 0) {
      const target = phaseStarts[step / stepsPerPhase];
      if (target > (await now())) {
        await networkHelpers.time.increaseTo(target);
      }
    }
    const name = pick(names);
    const eventId = pick(eventIds);
    const who = pick(attendees);
    try {
      const result = await actions[name](eventId, who)();
      if (typeof result === "string") {
        await publicClient.waitForTransactionReceipt({ hash: result as Hash });
      }
      succeeded[name] = (succeeded[name] ?? 0) + 1;
    } catch {
      // Reverts are expected for most random actions.
    }
    await checkInvariants(`seed ${seed}, step ${step} (${name})`);
  }
  return succeeded;

  async function checkInvariants(label: string) {
    const contractBalance = await usdc.read.balanceOf([showUp.address]);
    const totalEscrowed = await showUp.read.totalEscrowed();
    assert.equal(totalEscrowed, contractBalance, `${label}: escrow vs balance`);

    let sumEventEscrow = 0n;
    for (const [index, eventId] of eventIds.entries()) {
      const shape = shapes[index];
      const details = await showUp.read.getEvent([eventId]);
      let expectedEscrow = 0n;
      let expectedSeats = 0n;
      for (const wallet of attendees) {
        const reservation = await showUp.read.getReservation([
          eventId,
          wallet.account.address,
        ]);
        const status = reservation.status;
        if (shape.type === 0 && status === S.Reserved) expectedEscrow += shape.deposit;
        if (shape.type === 1 && status === S.PaymentDue) expectedEscrow += shape.deposit;
        if (shape.type === 1 && status === S.Completed) expectedEscrow += shape.price;
        if (
          status !== S.None &&
          status !== S.Cancelled &&
          status !== S.PaymentDefaulted
        ) {
          expectedSeats += 1n;
        }
        const checkedIn = await showUp.read.isCheckedIn([
          eventId,
          wallet.account.address,
        ]);
        if (checkedIn) {
          assert.equal(status, S.Attended, `${label}: checked-in must be attended`);
        }
      }
      assert.equal(details.escrowedAmount, expectedEscrow, `${label}: event ${eventId} escrow`);
      assert.equal(details.reservedSeats, expectedSeats, `${label}: event ${eventId} seats`);
      if (details.capacity !== 0n) {
        assert.ok(details.reservedSeats <= details.capacity, `${label}: capacity`);
      }
      sumEventEscrow += details.escrowedAmount;
    }
    assert.equal(sumEventEscrow, totalEscrowed, `${label}: sum of events`);

    // Conservation: no USDC is created or destroyed by the contract.
    let held = contractBalance + (await usdc.read.balanceOf([organizer.account.address]));
    for (const wallet of attendees) {
      held += await usdc.read.balanceOf([wallet.account.address]);
    }
    assert.equal(held, totalSupply, `${label}: conservation`);
  }
}

describe("ShowUpV6 randomized invariants", function () {
  const coverage: Record<string, number> = {};

  for (const seed of [1, 7, 42, 1337, 9001, 31337]) {
    it(`keeps escrow, seats and balances consistent (seed ${seed})`, async function () {
      const succeeded = await runSequence(seed, 400);
      for (const [name, count] of Object.entries(succeeded)) {
        coverage[name] = (coverage[name] ?? 0) + count;
      }
    });
  }

  it("exercised every settlement path across the seeds", function () {
    // Guard against a sequence that only produced reverts.
    const groups = [
      ["reserve"],
      ["reserveFull"],
      ["payRemaining"],
      ["cancelReservation"],
      ["confirm", "batchConfirm"],
      ["noShow", "batchNoShow"],
      ["markDefault"],
      ["fallback"],
      ["cancelEvent"],
      ["cancelledRefund"],
      ["checkIn"],
    ];
    for (const group of groups) {
      const total = group.reduce((sum, name) => sum + (coverage[name] ?? 0), 0);
      assert.ok(
        total > 0,
        `${group.join("/")} never succeeded: ${JSON.stringify(coverage)}`,
      );
    }
  });
});
