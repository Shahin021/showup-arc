import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Hash } from "viem";

const { viem, networkHelpers } = await network.create();

const DEPOSIT_AMOUNT = 2_000_000n;
const UPFRONT_AMOUNT = 3_000_000n;
const TOTAL_PRICE = 10_000_000n;
const PAYMENT_GRACE_PERIOD = 3n * 24n * 60n * 60n;
const INITIAL_BALANCE = 100_000_000n;

describe("ShowUpV3", function () {
  async function deployShowUpFixture() {
    const [
      organizer,
      attendeeOne,
      attendeeTwo,
      attendeeThree,
    ] = await viem.getWalletClients();

    const publicClient = await viem.getPublicClient();

    const mockUsdc = await viem.deployContract(
      "MockUSDC",
    );

    const showUp = await viem.deployContract(
      "ShowUpV3",
      [mockUsdc.address],
    );

    async function waitForTransaction(
      transaction: Promise<Hash>,
    ) {
      const hash = await transaction;

      await publicClient.waitForTransactionReceipt({
        hash,
      });
    }

    for (const attendee of [
      attendeeOne,
      attendeeTwo,
      attendeeThree,
    ]) {
      await waitForTransaction(
        mockUsdc.write.mint([
          attendee.account.address,
          INITIAL_BALANCE,
        ]),
      );

      await waitForTransaction(
        mockUsdc.write.approve(
          [
            showUp.address,
            INITIAL_BALANCE,
          ],
          {
            account: attendee.account,
          },
        ),
      );
    }

    async function createEvent(
      capacity: bigint = 30n,
    ) {
      const latestBlock =
        await publicClient.getBlock();

      const now = latestBlock.timestamp;

      const cancellationDeadline =
        now + 3_600n;

      const eventStart =
        now + 7_200n;

      const eventEnd =
        now + 10_800n;

      const resolutionDeadline =
        now + 14_400n;

      await waitForTransaction(
        showUp.write.createEvent(
          [
            "Arc Builders Workshop",
            "A practical workshop for builders using Arc and USDC.",
            "https://showup.example/metadata/arc-builders-workshop.json",
            0,
            DEPOSIT_AMOUNT,
            0n,
            capacity,
            cancellationDeadline,
            eventStart,
            eventEnd,
            resolutionDeadline,
          ],
          {
            account: organizer.account,
          },
        ),
      );

      const eventId =
        await showUp.read.eventCount();

      return {
        eventId,
        cancellationDeadline,
        eventStart,
        eventEnd,
        resolutionDeadline,
      };
    }

    async function createPaidEvent(
      capacity: bigint = 30n,
    ) {
      const latestBlock =
        await publicClient.getBlock();

      const now = latestBlock.timestamp;

      const cancellationDeadline =
        now + 3_600n;

      const eventStart =
        now + 7_200n;

      const eventEnd =
        now + 10_800n;

      const resolutionDeadline =
        now + 14_400n;

      await waitForTransaction(
        showUp.write.createEvent(
          [
            "Arc Paid Workshop",
            "A paid workshop using Arc and USDC.",
            "https://showup.example/metadata/arc-paid-workshop.json",
            1,
            UPFRONT_AMOUNT,
            TOTAL_PRICE,
            capacity,
            cancellationDeadline,
            eventStart,
            eventEnd,
            resolutionDeadline,
          ],
          {
            account: organizer.account,
          },
        ),
      );

      const eventId =
        await showUp.read.eventCount();

      return {
        eventId,
        cancellationDeadline,
        eventStart,
        eventEnd,
        resolutionDeadline,
      };
    }

    async function reserveSeat(
      eventId: bigint,
      attendee:
        | typeof attendeeOne
        | typeof attendeeTwo
        | typeof attendeeThree,
    ) {
      await waitForTransaction(
        showUp.write.reserveSeat(
          [eventId],
          {
            account: attendee.account,
          },
        ),
      );
    }

    return {
      organizer,
      attendeeOne,
      attendeeTwo,
      attendeeThree,
      publicClient,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createPaidEvent,
      reserveSeat,
    };
  }

  it("supports events with unlimited capacity", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      attendeeThree,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const { eventId } =
      await createEvent(0n);

    const [unlimitedBefore, remainingBefore] =
      await showUp.read.getCapacityState([
        eventId,
      ]);

    assert.equal(unlimitedBefore, true);
    assert.equal(remainingBefore, 0n);

    await reserveSeat(eventId, attendeeOne);
    await reserveSeat(eventId, attendeeTwo);
    await reserveSeat(eventId, attendeeThree);

    const eventDetails =
      await showUp.read.getEvent([eventId]);

    assert.equal(eventDetails.capacity, 0n);
    assert.equal(eventDetails.reservedSeats, 3n);

    assert.equal(
      eventDetails.escrowedAmount,
      DEPOSIT_AMOUNT * 3n,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      DEPOSIT_AMOUNT * 3n,
    );

    const [unlimitedAfter] =
      await showUp.read.getCapacityState([
        eventId,
      ]);

    assert.equal(unlimitedAfter, true);
  });

  it("enforces a limited event capacity", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const { eventId } =
      await createEvent(1n);

    await reserveSeat(eventId, attendeeOne);

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeat(
        [eventId],
        {
          account: attendeeTwo.account,
        },
      ),
      showUp,
      "EventAtCapacity",
    );

    const [unlimited, remaining] =
      await showUp.read.getCapacityState([
        eventId,
      ]);

    assert.equal(unlimited, false);
    assert.equal(remaining, 0n);
  });

  it("locks USDC when an attendee reserves", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const { eventId } =
      await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE - DEPOSIT_AMOUNT,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      DEPOSIT_AMOUNT,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      1,
    );
  });

  it("refunds an attendee who cancels before the deadline", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const { eventId } =
      await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);

    await waitForTransaction(
      showUp.write.cancelReservation(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      0n,
    );

    const eventDetails =
      await showUp.read.getEvent([eventId]);

    assert.equal(
      eventDetails.reservedSeats,
      0n,
    );

    assert.equal(
      eventDetails.escrowedAmount,
      0n,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      2,
    );
  });

  it("refunds the deposit after attendance is confirmed", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await waitForTransaction(
      showUp.write.confirmAttendance(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      3,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("transfers a no-show deposit to the organizer", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      eventEnd,
    } = await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventEnd,
    );

    await waitForTransaction(
      showUp.write.settleNoShow(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        organizer.account.address,
      ]),
      DEPOSIT_AMOUNT,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      4,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("allows an unresolved attendee to claim a fallback refund", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      resolutionDeadline,
    } = await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      resolutionDeadline + 1n,
    );

    await waitForTransaction(
      showUp.write.claimFallbackRefund(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      5,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("refunds attendees when the organizer cancels the event", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const { eventId } =
      await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);

    await waitForTransaction(
      showUp.write.cancelEvent(
        [eventId],
        {
          account: organizer.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write.claimCancelledEventRefund(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      6,
    );

    const eventDetails =
      await showUp.read.getEvent([eventId]);

    assert.equal(eventDetails.cancelled, true);
    assert.equal(
      eventDetails.escrowedAmount,
      0n,
    );
  });

  it("supports batch attendance confirmation", async function () {
    const {
      organizer,
      attendeeOne,
      attendeeTwo,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent(30n);

    await reserveSeat(eventId, attendeeOne);
    await reserveSeat(eventId, attendeeTwo);

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await waitForTransaction(
      showUp.write.batchConfirmAttendance(
        [
          eventId,
          [
            attendeeOne.account.address,
            attendeeTwo.account.address,
          ],
        ],
        {
          account: organizer.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeTwo.account.address,
      ]),
      INITIAL_BALANCE,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );

    const reservationOne =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    const reservationTwo =
      await showUp.read.getReservation([
        eventId,
        attendeeTwo.account.address,
      ]);

    assert.equal(
      Number(reservationOne.status),
      3,
    );

    assert.equal(
      Number(reservationTwo.status),
      3,
    );
  });


  it("locks the upfront payment for a paid event reservation", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      createPaidEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const { eventId } =
      await createPaidEvent();

    await reserveSeat(eventId, attendeeOne);

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE - UPFRONT_AMOUNT,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      UPFRONT_AMOUNT,
    );

    const eventDetails =
      await showUp.read.getEvent([eventId]);

    assert.equal(
      Number(eventDetails.eventType),
      1,
    );

    assert.equal(
      eventDetails.depositAmount,
      UPFRONT_AMOUNT,
    );

    assert.equal(
      eventDetails.totalPrice,
      TOTAL_PRICE,
    );

    assert.equal(
      eventDetails.escrowedAmount,
      UPFRONT_AMOUNT,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      UPFRONT_AMOUNT,
    );
  });

  it("moves a paid attendee to payment due after attendance confirmation", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createPaidEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createPaidEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await waitForTransaction(
      showUp.write.confirmAttendance(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      7,
    );

    assert.equal(
      reservation.paymentDeadline >
        eventStart,
      true,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        organizer.account.address,
      ]),
      0n,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      UPFRONT_AMOUNT,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      UPFRONT_AMOUNT,
    );
  });

  it("pays the full ticket price to the organizer after the remaining balance is paid", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createPaidEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createPaidEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await waitForTransaction(
      showUp.write.confirmAttendance(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write.payRemainingBalance(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE - TOTAL_PRICE,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        organizer.account.address,
      ]),
      TOTAL_PRICE,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      0n,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      8,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("transfers only the upfront payment to the organizer for a paid-event no-show", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createPaidEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployShowUpFixture,
    );

    const {
      eventId,
      eventEnd,
    } = await createPaidEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventEnd,
    );

    await waitForTransaction(
      showUp.write.settleNoShow(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        organizer.account.address,
      ]),
      UPFRONT_AMOUNT,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      0n,
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      4,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });
});

