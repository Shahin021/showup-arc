import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Hash } from "viem";

const { viem, networkHelpers } = await network.create();

const DEPOSIT_AMOUNT = 2_000_000n;
const INITIAL_BALANCE = 100_000_000n;
const ONE_DAY = 86_400n;
const SEVEN_DAYS = 7n * ONE_DAY;

describe("ShowUp security and edge cases", function () {
  async function deployFixture() {
    const [
      organizer,
      attendeeOne,
      attendeeTwo,
      outsider,
    ] = await viem.getWalletClients();

    const publicClient = await viem.getPublicClient();

    const mockUsdc = await viem.deployContract(
      "MockUSDC",
    );

    const showUp = await viem.deployContract(
      "ShowUp",
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

    for (const wallet of [
      attendeeOne,
      attendeeTwo,
      outsider,
    ]) {
      await waitForTransaction(
        mockUsdc.write.mint([
          wallet.account.address,
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
            account: wallet.account,
          },
        ),
      );
    }

    async function createEvent(options?: {
      capacity?: bigint;
      title?: string;
      description?: string;
      resolutionPeriod?: bigint;
    }) {
      const latestBlock =
        await publicClient.getBlock();

      const now = latestBlock.timestamp;

      const cancellationDeadline =
        now + 3_600n;

      const eventStart =
        now + 7_200n;

      const eventEnd =
        now + 10_800n;

      const resolutionPeriod =
        options?.resolutionPeriod ?? 3_600n;

      const resolutionDeadline =
        eventEnd + resolutionPeriod;

      await waitForTransaction(
        showUp.write.createEvent(
          [
            options?.title ??
              "Arc Builders Workshop",
            options?.description ??
              "A practical workshop using Arc and USDC.",
            DEPOSIT_AMOUNT,
            options?.capacity ?? 30n,
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
      attendee = attendeeOne,
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
      outsider,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    };
  }

  it("prevents the same attendee from reserving twice", async function () {
    const {
      attendeeOne,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const { eventId } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeat(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "ReservationNotAvailable",
    );
  });

  it("prevents non-organizers from confirming attendance", async function () {
    const {
      attendeeOne,
      outsider,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.confirmAttendance(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: outsider.account,
        },
      ),
      showUp,
      "NotOrganizer",
    );
  });

  it("prevents cancellation after the free cancellation deadline", async function () {
    const {
      attendeeOne,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      cancellationDeadline,
    } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      cancellationDeadline + 1n,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.cancelReservation(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "CancellationDeadlinePassed",
    );
  });

  it("prevents reservations after the event has started", async function () {
    const {
      attendeeOne,
      showUp,
      createEvent,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent();

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeat(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "ReservationsClosed",
    );
  });

  it("prevents no-show settlement before the event ends", async function () {
    const {
      organizer,
      attendeeOne,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const { eventId } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await viem.assertions.revertWithCustomError(
      showUp.write.settleNoShow(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "NoShowWindowClosed",
    );
  });

  it("prevents no-show settlement after the resolution deadline", async function () {
    const {
      organizer,
      attendeeOne,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      resolutionDeadline,
    } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      resolutionDeadline + 1n,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.settleNoShow(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "NoShowWindowClosed",
    );
  });

  it("prevents fallback refunds before the resolution deadline", async function () {
    const {
      attendeeOne,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const { eventId } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await viem.assertions.revertWithCustomError(
      showUp.write.claimFallbackRefund(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "ResolutionDeadlineNotReached",
    );
  });

  it("prevents organizers from cancelling an event after it starts", async function () {
    const {
      organizer,
      showUp,
      createEvent,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent();

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.cancelEvent(
        [eventId],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "EventHasStarted",
    );
  });

  it("rejects resolution periods longer than seven days", async function () {
    const {
      organizer,
      showUp,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const publicClient =
      await viem.getPublicClient();

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
      eventEnd + SEVEN_DAYS + 1n;

    await viem.assertions.revertWithCustomError(
      showUp.write.createEvent(
        [
          "Long Resolution Event",
          "This event attempts to lock deposits for too long.",
          DEPOSIT_AMOUNT,
          30n,
          cancellationDeadline,
          eventStart,
          eventEnd,
          resolutionDeadline,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "ResolutionPeriodTooLong",
    );
  });

  it("rejects an event title longer than the contract limit", async function () {
    const {
      organizer,
      showUp,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const publicClient =
      await viem.getPublicClient();

    const latestBlock =
      await publicClient.getBlock();

    const now = latestBlock.timestamp;

    await viem.assertions.revertWithCustomError(
      showUp.write.createEvent(
        [
          "A".repeat(321),
          "Description",
          DEPOSIT_AMOUNT,
          30n,
          now + 3_600n,
          now + 7_200n,
          now + 10_800n,
          now + 14_400n,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "TitleTooLong",
    );
  });

  it("rejects descriptions longer than the contract limit", async function () {
    const {
      organizer,
      showUp,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const publicClient =
      await viem.getPublicClient();

    const latestBlock =
      await publicClient.getBlock();

    const now = latestBlock.timestamp;

    await viem.assertions.revertWithCustomError(
      showUp.write.createEvent(
        [
          "Valid title",
          "D".repeat(961),
          DEPOSIT_AMOUNT,
          30n,
          now + 3_600n,
          now + 7_200n,
          now + 10_800n,
          now + 14_400n,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "DescriptionTooLong",
    );
  });

  it("rejects batches larger than the allowed maximum", async function () {
    const {
      organizer,
      attendeeOne,
      showUp,
      createEvent,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent({
      capacity: 0n,
    });

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    const oversizedBatch = Array.from(
      { length: 101 },
      () => attendeeOne.account.address,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.batchConfirmAttendance(
        [
          eventId,
          oversizedBatch,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "InvalidBatchSize",
    );
  });

  it("prevents claiming a cancelled-event refund twice", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const { eventId } = await createEvent();

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

    await viem.assertions.revertWithCustomError(
      showUp.write.claimCancelledEventRefund(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "ReservationNotActive",
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        attendeeOne.account.address,
      ]),
      INITIAL_BALANCE,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("keeps batch attendance atomic when one entry is invalid", async function () {
    const {
      organizer,
      attendeeOne,
      showUp,
      createEvent,
      reserveSeat,
    } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const {
      eventId,
      eventStart,
    } = await createEvent();

    await reserveSeat(eventId, attendeeOne);

    await networkHelpers.time.increaseTo(
      eventStart,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.batchConfirmAttendance(
        [
          eventId,
          [
            attendeeOne.account.address,
            attendeeOne.account.address,
          ],
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "ReservationNotActive",
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

    assert.equal(
      await showUp.read.totalEscrowed(),
      DEPOSIT_AMOUNT,
    );
  });
});