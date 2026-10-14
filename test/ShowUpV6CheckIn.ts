import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Address, Hash, Hex } from "viem";

const { viem, networkHelpers } = await network.create();

const CAP = 50_000_000n; // 50 USDC
const DEPOSIT = 2_000_000n;
const UPFRONT = 3_000_000n;
const PRICE = 10_000_000n;
const INITIAL_BALANCE = 1_000_000_000n;

const FREE = 0;
const PAID = 1;
const PUBLIC = 0;

const STATUS = {
  Reserved: 1,
  Attended: 3,
  NoShow: 4,
  Completed: 8,
} as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

describe("ShowUpV6 check-in, caps and organizer stats", function () {
  async function fixture() {
    const [organizer, attendeeOne, attendeeTwo, attendeeThree, outsider] =
      await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();

    const usdc = await viem.deployContract("MockBlocklistUSDC");
    const showUp = await viem.deployContract("ShowUpV6", [usdc.address, CAP]);
    const otherShowUp = await viem.deployContract("ShowUpV6", [
      usdc.address,
      CAP,
    ]);

    async function wait(tx: Promise<Hash>) {
      const hash = await tx;
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    }

    for (const wallet of [attendeeOne, attendeeTwo, attendeeThree, outsider]) {
      await wait(usdc.write.mint([wallet.account.address, INITIAL_BALANCE]));
      await wait(
        usdc.write.approve([showUp.address, INITIAL_BALANCE], {
          account: wallet.account,
        }),
      );
    }

    async function now() {
      return (await publicClient.getBlock()).timestamp;
    }

    async function createEvent(options?: {
      eventType?: number;
      depositAmount?: bigint;
      totalPrice?: bigint;
      fullPaymentOnly?: boolean;
    }) {
      const t = await now();
      const eventType = options?.eventType ?? FREE;
      const timeline = {
        cancellationDeadline: t + 3_600n,
        eventStart: t + 7_200n,
        eventEnd: t + 10_800n,
        resolutionDeadline: t + 14_400n,
        paymentDeadline:
          eventType === PAID && !options?.fullPaymentOnly ? t + 5_400n : 0n,
      };
      await wait(
        showUp.write.createEvent(
          [
            "Check-in test",
            "",
            "https://showup.example/m.json",
            eventType,
            PUBLIC,
            options?.depositAmount ?? (eventType === PAID ? UPFRONT : DEPOSIT),
            options?.totalPrice ?? (eventType === PAID ? PRICE : 0n),
            0n,
            timeline.cancellationDeadline,
            timeline.eventStart,
            timeline.eventEnd,
            timeline.resolutionDeadline,
            timeline.paymentDeadline,
          ],
          { account: organizer.account },
        ),
      );
      return { eventId: await showUp.read.eventCount(), ...timeline };
    }

    async function signCheckIn(options: {
      eventId: bigint;
      codeAttendee?: Address;
      issuedAt: bigint;
      expiry: bigint;
      signer?: typeof organizer;
      verifyingContract?: Address;
      chainId?: number;
    }) {
      const signer = options.signer ?? organizer;
      return (await signer.signTypedData({
        account: signer.account,
        domain: {
          name: "ShowUp",
          version: "6",
          chainId: options.chainId ?? chainId,
          verifyingContract: options.verifyingContract ?? showUp.address,
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
        message: {
          eventId: options.eventId,
          attendee: options.codeAttendee ?? ZERO,
          issuedAt: options.issuedAt,
          expiry: options.expiry,
        },
      })) as Hex;
    }

    /** Signs a fresh open code valid for 5 minutes from the current block. */
    async function openCode(eventId: bigint, codeAttendee: Address = ZERO) {
      const issuedAt = await now();
      const expiry = issuedAt + 300n;
      const signature = await signCheckIn({
        eventId,
        codeAttendee,
        issuedAt,
        expiry,
      });
      return { codeAttendee, issuedAt, expiry, signature };
    }

    async function checkIn(
      eventId: bigint,
      code: Awaited<ReturnType<typeof openCode>>,
      wallet = attendeeOne,
    ) {
      return wait(
        showUp.write.checkIn(
          [eventId, code.codeAttendee, code.issuedAt, code.expiry, code.signature],
          { account: wallet.account },
        ),
      );
    }

    return {
      organizer,
      attendeeOne,
      attendeeTwo,
      attendeeThree,
      outsider,
      publicClient,
      chainId,
      usdc,
      showUp,
      otherShowUp,
      wait,
      now,
      createEvent,
      signCheckIn,
      openCode,
      checkIn,
    };
  }

  describe("self check-in", function () {
    it("refunds the free-event deposit when the attendee checks in with an open code", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      const balanceBefore = await f.usdc.read.balanceOf([
        f.attendeeOne.account.address,
      ]);

      await networkHelpers.time.increaseTo(event.eventStart);
      await f.checkIn(event.eventId, await f.openCode(event.eventId));

      const reservation = await f.showUp.read.getReservation([
        event.eventId,
        f.attendeeOne.account.address,
      ]);
      assert.equal(reservation.status, STATUS.Attended);
      assert.equal(
        await f.showUp.read.isCheckedIn([
          event.eventId,
          f.attendeeOne.account.address,
        ]),
        true,
      );
      assert.equal(
        await f.usdc.read.balanceOf([f.attendeeOne.account.address]),
        balanceBefore + DEPOSIT,
      );
      assert.equal(await f.showUp.read.totalEscrowed(), 0n);
    });

    it("lets several attendees use the same open code", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      for (const wallet of [f.attendeeOne, f.attendeeTwo]) {
        await f.wait(
          f.showUp.write.reserveSeat([event.eventId], {
            account: wallet.account,
          }),
        );
      }
      await networkHelpers.time.increaseTo(event.eventStart);
      const code = await f.openCode(event.eventId);
      await f.checkIn(event.eventId, code, f.attendeeOne);
      await f.checkIn(event.eventId, code, f.attendeeTwo);
      assert.equal(await f.showUp.read.totalEscrowed(), 0n);
    });

    it("accepts a personal code only from the attendee it names", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      for (const wallet of [f.attendeeOne, f.attendeeTwo]) {
        await f.wait(
          f.showUp.write.reserveSeat([event.eventId], {
            account: wallet.account,
          }),
        );
      }
      await networkHelpers.time.increaseTo(event.eventStart);
      const code = await f.openCode(
        event.eventId,
        f.attendeeOne.account.address,
      );

      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, code, f.attendeeTwo),
        f.showUp,
        "InvalidCheckInCode",
      );
      await f.checkIn(event.eventId, code, f.attendeeOne);
    });

    it("pays the organizer the ticket price when a fully paid attendee checks in", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent({ eventType: PAID });
      await f.wait(
        f.showUp.write.reserveSeatAndPayFull([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      const organizerBefore = await f.usdc.read.balanceOf([
        f.organizer.account.address,
      ]);
      await networkHelpers.time.increaseTo(event.eventStart);
      await f.checkIn(event.eventId, await f.openCode(event.eventId));
      assert.equal(
        await f.usdc.read.balanceOf([f.organizer.account.address]),
        organizerBefore + PRICE,
      );
      const stats = await f.showUp.read.getOrganizerStats([
        f.organizer.account.address,
      ]);
      assert.equal(stats.selfCheckIns, 1n);
    });

    it("does not let an unpaid (payment due) reservation check in", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent({ eventType: PAID });
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart);
      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, await f.openCode(event.eventId)),
        f.showUp,
        "ReservationNotActive",
      );
    });

    it("rejects check-in without a reservation, and a second check-in", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart);
      const code = await f.openCode(event.eventId);

      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, code, f.outsider),
        f.showUp,
        "ReservationNotActive",
      );
      await f.checkIn(event.eventId, code);
      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, code),
        f.showUp,
        "ReservationNotActive",
      );
    });

    it("prevents the organizer from marking a checked-in attendee as a no-show", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart);
      await f.checkIn(event.eventId, await f.openCode(event.eventId));
      await networkHelpers.time.increaseTo(event.eventEnd);

      await viem.assertions.revertWithCustomError(
        f.showUp.write.settleNoShow(
          [event.eventId, f.attendeeOne.account.address],
          { account: f.organizer.account },
        ),
        f.showUp,
        "ReservationNotActive",
      );
      await viem.assertions.revertWithCustomError(
        f.showUp.write.batchSettleNoShow(
          [event.eventId, [f.attendeeOne.account.address]],
          { account: f.organizer.account },
        ),
        f.showUp,
        "ReservationNotActive",
      );
    });

    it("prevents check-in after the organizer settled a no-show", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventEnd);
      await f.wait(
        f.showUp.write.settleNoShow(
          [event.eventId, f.attendeeOne.account.address],
          { account: f.organizer.account },
        ),
      );
      // The check-in window has closed as well.
      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, await f.openCode(event.eventId)),
        f.showUp,
        "CheckInWindowClosed",
      );
    });

    it("only opens check-in between the event start and the event end", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );

      // One second before the start (the next block lands on eventStart - 1).
      await networkHelpers.time.setNextBlockTimestamp(event.eventStart - 1n);
      const earlySignature = await f.signCheckIn({
        eventId: event.eventId,
        issuedAt: event.eventStart - 100n,
        expiry: event.eventStart + 100n,
      });
      await viem.assertions.revertWithCustomError(
        f.showUp.write.checkIn(
          [
            event.eventId,
            ZERO,
            event.eventStart - 100n,
            event.eventStart + 100n,
            earlySignature,
          ],
          { account: f.attendeeOne.account },
        ),
        f.showUp,
        "CheckInWindowClosed",
      );

      // Exactly at eventEnd the window is closed (the no-show window opens).
      const lateSignature = await f.signCheckIn({
        eventId: event.eventId,
        issuedAt: event.eventEnd - 100n,
        expiry: event.eventEnd + 100n,
      });
      await networkHelpers.time.setNextBlockTimestamp(event.eventEnd);
      await viem.assertions.revertWithCustomError(
        f.showUp.write.checkIn(
          [
            event.eventId,
            ZERO,
            event.eventEnd - 100n,
            event.eventEnd + 100n,
            lateSignature,
          ],
          { account: f.attendeeOne.account },
        ),
        f.showUp,
        "CheckInWindowClosed",
      );
    });

    it("accepts a check-in one second before the event ends", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      const issuedAt = event.eventEnd - 100n;
      const expiry = event.eventEnd + 100n;
      const signature = await f.signCheckIn({
        eventId: event.eventId,
        issuedAt,
        expiry,
      });
      await networkHelpers.time.setNextBlockTimestamp(event.eventEnd - 1n);
      await f.checkIn(event.eventId, {
        codeAttendee: ZERO,
        issuedAt,
        expiry,
        signature,
      });
    });

    it("rejects expired, not-yet-valid and over-long codes", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart + 1_000n);
      const t = await f.now();

      async function attempt(issuedAt: bigint, expiry: bigint) {
        const signature = await f.signCheckIn({
          eventId: event.eventId,
          issuedAt,
          expiry,
        });
        return f.showUp.write.checkIn(
          [event.eventId, ZERO, issuedAt, expiry, signature],
          { account: f.attendeeOne.account },
        );
      }

      // Expiry equal to the next block's timestamp is already expired.
      await networkHelpers.time.setNextBlockTimestamp(t + 10n);
      await viem.assertions.revertWithCustomError(
        attempt(t - 100n, t + 10n),
        f.showUp,
        "CheckInCodeExpired",
      );
      await viem.assertions.revertWithCustomError(
        attempt(t + 500n, t + 600n),
        f.showUp,
        "CheckInCodeNotYetValid",
      );
      // 15 minutes + 1 second.
      await viem.assertions.revertWithCustomError(
        attempt(t, t + 901n),
        f.showUp,
        "CheckInCodeLifetimeTooLong",
      );
      await viem.assertions.revertWithCustomError(
        attempt(t, t),
        f.showUp,
        "InvalidCheckInCode",
      );
      // Exactly 15 minutes is allowed.
      const now = await f.now();
      await f.wait(attempt(now - 1n, now - 1n + 900n));
    });

    it("rejects codes signed by someone else, for another event, contract or chain", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      const otherEvent = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart);
      const issuedAt = await f.now();
      const expiry = issuedAt + 300n;

      const variants = [
        { signer: f.attendeeTwo },
        { eventIdSigned: otherEvent.eventId },
        { verifyingContract: f.otherShowUp.address },
        { chainId: 1 },
      ];

      for (const variant of variants) {
        const signature = await f.signCheckIn({
          eventId: variant.eventIdSigned ?? event.eventId,
          issuedAt,
          expiry,
          signer: variant.signer,
          verifyingContract: variant.verifyingContract,
          chainId: variant.chainId,
        });
        await viem.assertions.revertWithCustomError(
          f.showUp.write.checkIn(
            [event.eventId, ZERO, issuedAt, expiry, signature],
            { account: f.attendeeOne.account },
          ),
          f.showUp,
          "InvalidCheckInCode",
        );
      }

      // A signature over different issuedAt/expiry values does not verify.
      const signature = await f.signCheckIn({
        eventId: event.eventId,
        issuedAt,
        expiry,
      });
      await viem.assertions.revertWithCustomError(
        f.showUp.write.checkIn(
          [event.eventId, ZERO, issuedAt, expiry + 1n, signature],
          { account: f.attendeeOne.account },
        ),
        f.showUp,
        "InvalidCheckInCode",
      );
    });

    it("matches the on-chain digest helper", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      const digest = await f.showUp.read.hashCheckInCode([
        event.eventId,
        ZERO,
        100n,
        200n,
      ]);
      assert.match(digest, /^0x[0-9a-f]{64}$/);
    });

    it("does not allow check-in on a cancelled event", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await f.wait(
        f.showUp.write.cancelEvent([event.eventId], {
          account: f.organizer.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart);
      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, await f.openCode(event.eventId)),
        f.showUp,
        "EventIsCancelled",
      );
    });

    it("leaves the reservation untouched when the refund transfer fails, so it can be retried", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      await f.wait(
        f.showUp.write.reserveSeat([event.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      await networkHelpers.time.increaseTo(event.eventStart);
      const code = await f.openCode(event.eventId);

      await f.wait(f.usdc.write.setBlocked([f.attendeeOne.account.address, true]));
      await viem.assertions.revertWithCustomError(
        f.checkIn(event.eventId, code),
        f.usdc,
        "AccountBlocked",
      );
      const reservation = await f.showUp.read.getReservation([
        event.eventId,
        f.attendeeOne.account.address,
      ]);
      assert.equal(reservation.status, STATUS.Reserved);
      assert.equal(await f.showUp.read.totalEscrowed(), DEPOSIT);

      await f.wait(f.usdc.write.setBlocked([f.attendeeOne.account.address, false]));
      await f.checkIn(event.eventId, code);
      assert.equal(await f.showUp.read.totalEscrowed(), 0n);
    });
  });

  describe("reservation cap", function () {
    it("rejects a zero cap at deployment", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await assert.rejects(
        viem.deployContract("ShowUpV6", [f.usdc.address, 0n]),
        /InvalidMaxReservationAmount/,
      );
    });

    it("caps the free-event deposit at the configured maximum", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await f.createEvent({ depositAmount: CAP });
      await viem.assertions.revertWithCustomError(
        f.createEvent({ depositAmount: CAP + 1n }),
        f.showUp,
        "ReservationAmountTooHigh",
      );
    });

    it("caps the full ticket price of paid events, not just the deposit", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      await f.createEvent({
        eventType: PAID,
        depositAmount: 1_000_000n,
        totalPrice: CAP,
      });
      await viem.assertions.revertWithCustomError(
        f.createEvent({
          eventType: PAID,
          depositAmount: 1_000_000n,
          totalPrice: CAP + 1n,
        }),
        f.showUp,
        "ReservationAmountTooHigh",
      );
    });

    it("exposes the cap publicly", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      assert.equal(await f.showUp.read.maxReservationAmount(), CAP);
    });
  });

  describe("organizer stats", function () {
    it("records created, cancelled, confirmed, checked-in, no-show and default outcomes", async function () {
      const f = await networkHelpers.loadFixture(fixture);

      const free = await f.createEvent();
      for (const wallet of [f.attendeeOne, f.attendeeTwo, f.attendeeThree]) {
        await f.wait(
          f.showUp.write.reserveSeat([free.eventId], {
            account: wallet.account,
          }),
        );
      }
      const paid = await f.createEvent({ eventType: PAID });
      await f.wait(
        f.showUp.write.reserveSeat([paid.eventId], {
          account: f.attendeeOne.account,
        }),
      );
      const cancelled = await f.createEvent();
      await f.wait(
        f.showUp.write.cancelEvent([cancelled.eventId], {
          account: f.organizer.account,
        }),
      );

      await networkHelpers.time.increaseTo(free.eventStart);
      await f.checkIn(free.eventId, await f.openCode(free.eventId), f.attendeeOne);
      await f.wait(
        f.showUp.write.confirmAttendance(
          [free.eventId, f.attendeeTwo.account.address],
          { account: f.organizer.account },
        ),
      );
      // The paid reservation never paid the balance: default it.
      await f.wait(
        f.showUp.write.markPaymentDefault(
          [paid.eventId, f.attendeeOne.account.address],
          { account: f.outsider.account },
        ),
      );
      await networkHelpers.time.increaseTo(free.eventEnd);
      await f.wait(
        f.showUp.write.settleNoShow(
          [free.eventId, f.attendeeThree.account.address],
          { account: f.organizer.account },
        ),
      );

      const stats = await f.showUp.read.getOrganizerStats([
        f.organizer.account.address,
      ]);
      assert.equal(stats.eventsCreated, 3n);
      assert.equal(stats.eventsCancelled, 1n);
      assert.equal(stats.selfCheckIns, 1n);
      assert.equal(stats.attendanceConfirmed, 1n);
      assert.equal(stats.noShowsSettled, 1n);
      assert.equal(stats.noShowAmountCollected, DEPOSIT);
      assert.equal(stats.paymentDefaults, 1n);
      assert.equal(await f.showUp.read.totalEscrowed(), 0n);
    });
  });

  describe("batch failure isolation", function () {
    it("reverts the whole batch when one refund recipient is blocklisted, and succeeds without them", async function () {
      const f = await networkHelpers.loadFixture(fixture);
      const event = await f.createEvent();
      for (const wallet of [f.attendeeOne, f.attendeeTwo]) {
        await f.wait(
          f.showUp.write.reserveSeat([event.eventId], {
            account: wallet.account,
          }),
        );
      }
      await networkHelpers.time.increaseTo(event.eventStart);
      await f.wait(f.usdc.write.setBlocked([f.attendeeTwo.account.address, true]));

      await viem.assertions.revertWithCustomError(
        f.showUp.write.batchConfirmAttendance(
          [
            event.eventId,
            [f.attendeeOne.account.address, f.attendeeTwo.account.address],
          ],
          { account: f.organizer.account },
        ),
        f.usdc,
        "AccountBlocked",
      );
      assert.equal(await f.showUp.read.totalEscrowed(), DEPOSIT * 2n);

      await f.wait(
        f.showUp.write.batchConfirmAttendance(
          [event.eventId, [f.attendeeOne.account.address]],
          { account: f.organizer.account },
        ),
      );
      assert.equal(await f.showUp.read.totalEscrowed(), DEPOSIT);
    });
  });
});
