import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Address, Hash, Hex } from "viem";

const { viem, networkHelpers } = await network.create();

const FREE_EVENT = 0;
const PAID_EVENT = 1;

const PUBLIC_ACCESS = 0;
const INVITE_ONLY_ACCESS = 1;

const DEPOSIT_AMOUNT = 2_000_000n;
const UPFRONT_AMOUNT = 3_000_000n;
const TOTAL_PRICE = 10_000_000n;
const INITIAL_BALANCE = 100_000_000n;

describe("ShowUpV5 regression", function () {
  async function deployFixture() {
    const [
      organizer,
      attendeeOne,
      attendeeTwo,
    ] = await viem.getWalletClients();

    const publicClient =
      await viem.getPublicClient();

    const chainId =
      await publicClient.getChainId();

    const mockUsdc =
      await viem.deployContract(
        "MockUSDC",
      );

    const showUp =
      await viem.deployContract(
        "ShowUpV5",
        [mockUsdc.address],
      );

    async function waitForTransaction(
      transaction: Promise<Hash>,
    ) {
      const hash = await transaction;

      await publicClient
        .waitForTransactionReceipt({
          hash,
        });

      return hash;
    }

    for (const attendee of [
      attendeeOne,
      attendeeTwo,
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

    async function createEvent(options?: {
      eventType?: number;
      accessMode?: number;
      capacity?: bigint;
      fullPaymentOnly?: boolean;
    }) {
      const eventType =
        options?.eventType ??
        FREE_EVENT;

      const accessMode =
        options?.accessMode ??
        PUBLIC_ACCESS;

      const capacity =
        options?.capacity ?? 30n;

      const latestBlock =
        await publicClient.getBlock();

      const now =
        latestBlock.timestamp;

      const cancellationDeadline =
        now + 3_600n;

      const eventStart =
        now + 7_200n;

      const eventEnd =
        now + 10_800n;

      const resolutionDeadline =
        now + 14_400n;

      const paymentDeadline =
        eventType === PAID_EVENT &&
        !options?.fullPaymentOnly
          ? now + 5_400n
          : 0n;

      const depositAmount =
        eventType === PAID_EVENT
          ? UPFRONT_AMOUNT
          : DEPOSIT_AMOUNT;

      const totalPrice =
        eventType === PAID_EVENT
          ? TOTAL_PRICE
          : 0n;

      await waitForTransaction(
        showUp.write.createEvent(
          [
            eventType === PAID_EVENT
              ? "V5 Paid Event"
              : "V5 Free Event",
            "ShowUp V5 regression test event.",
            "https://showup.example/metadata/v5-regression.json",
            eventType,
            accessMode,
            depositAmount,
            totalPrice,
            capacity,
            cancellationDeadline,
            eventStart,
            eventEnd,
            resolutionDeadline,
            paymentDeadline,
          ],
          {
            account:
              organizer.account,
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
        paymentDeadline,
      };
    }

    async function createInvitation(options: {
      eventId: bigint;
      attendee: Address;
      nonce: bigint;
    }) {
      const latestBlock =
        await publicClient.getBlock();

      const expiry =
        latestBlock.timestamp +
        3_000n;

      const signature =
        await organizer.signTypedData({
          account:
            organizer.account,
          domain: {
            name: "ShowUp",
            version: "5",
            chainId,
            verifyingContract:
              showUp.address,
          },
          types: {
            Invitation: [
              {
                name: "eventId",
                type: "uint256",
              },
              {
                name: "attendee",
                type: "address",
              },
              {
                name: "nonce",
                type: "uint256",
              },
              {
                name: "expiry",
                type: "uint256",
              },
            ],
          },
          primaryType: "Invitation",
          message: {
            eventId:
              options.eventId,
            attendee:
              options.attendee,
            nonce:
              options.nonce,
            expiry,
          },
        });

      return {
        expiry,
        signature:
          signature as Hex,
      };
    }

    return {
      organizer,
      attendeeOne,
      attendeeTwo,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    };
  }

  it("refunds a public free reservation cancelled before the deadline", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const { eventId } =
      await createEvent();

    await waitForTransaction(
      showUp.write.reserveSeat(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write.cancelReservation(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    const eventDetails =
      await showUp.read.getEvent([
        eventId,
      ]);

    assert.equal(
      Number(reservation.status),
      2,
    );

    assert.equal(
      eventDetails.reservedSeats,
      0n,
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

  it("refunds the free-event deposit after attendance", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const {
      eventId,
      eventStart,
    } = await createEvent();

    await waitForTransaction(
      showUp.write.reserveSeat(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    await networkHelpers.time
      .increaseTo(eventStart);

    await waitForTransaction(
      showUp.write.confirmAttendance(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account:
            organizer.account,
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
      3,
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

  it("supports upfront payment, remaining payment and attendance settlement", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const {
      eventId,
      eventStart,
    } = await createEvent({
      eventType: PAID_EVENT,
    });

    await waitForTransaction(
      showUp.write.reserveSeat(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    let reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      7,
    );

    await waitForTransaction(
      showUp.write.payRemainingBalance(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    assert.equal(
      Number(reservation.status),
      8,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      TOTAL_PRICE,
    );

    await networkHelpers.time
      .increaseTo(eventStart);

    await waitForTransaction(
      showUp.write.confirmAttendance(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account:
            organizer.account,
        },
      ),
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

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("settles a fully paid no-show to the organizer", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const {
      eventId,
      eventEnd,
    } = await createEvent({
      eventType: PAID_EVENT,
    });

    await waitForTransaction(
      showUp.write.reserveSeatAndPayFull(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    await networkHelpers.time
      .increaseTo(eventEnd);

    await waitForTransaction(
      showUp.write.settleNoShow(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account:
            organizer.account,
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
      4,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        organizer.account.address,
      ]),
      TOTAL_PRICE,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("defaults an unpaid paid reservation and releases the seat", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const {
      eventId,
      paymentDeadline,
    } = await createEvent({
      eventType: PAID_EVENT,
      capacity: 1n,
    });

    await waitForTransaction(
      showUp.write.reserveSeat(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    await networkHelpers.time
      .increaseTo(
        paymentDeadline + 1n,
      );

    await waitForTransaction(
      showUp.write.markPaymentDefault(
        [
          eventId,
          attendeeOne.account.address,
        ],
        {
          account:
            organizer.account,
        },
      ),
    );

    const reservation =
      await showUp.read.getReservation([
        eventId,
        attendeeOne.account.address,
      ]);

    const eventDetails =
      await showUp.read.getEvent([
        eventId,
      ]);

    assert.equal(
      Number(reservation.status),
      9,
    );

    assert.equal(
      eventDetails.reservedSeats,
      0n,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        organizer.account.address,
      ]),
      UPFRONT_AMOUNT,
    );

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("refunds a full paid reservation through fallback", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const {
      eventId,
      resolutionDeadline,
    } = await createEvent({
      eventType: PAID_EVENT,
    });

    await waitForTransaction(
      showUp.write.reserveSeatAndPayFull(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    await networkHelpers.time
      .increaseTo(
        resolutionDeadline + 1n,
      );

    await waitForTransaction(
      showUp.write.claimFallbackRefund(
        [eventId],
        {
          account:
            attendeeOne.account,
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
      5,
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

  it("refunds an upfront paid reservation after event cancellation", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const { eventId } =
      await createEvent({
        eventType: PAID_EVENT,
      });

    await waitForTransaction(
      showUp.write.reserveSeat(
        [eventId],
        {
          account:
            attendeeOne.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write.cancelEvent(
        [eventId],
        {
          account:
            organizer.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write
        .claimCancelledEventRefund(
          [eventId],
          {
            account:
              attendeeOne.account,
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
      6,
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

  it("refunds a private fully paid reservation after event cancellation", async function () {
    const {
      organizer,
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const { eventId } =
      await createEvent({
        eventType: PAID_EVENT,
        accessMode:
          INVITE_ONLY_ACCESS,
      });

    const nonce = 9_001n;

    const {
      expiry,
      signature,
    } = await createInvitation({
      eventId,
      attendee:
        attendeeOne.account.address,
      nonce,
    });

    await waitForTransaction(
      showUp.write
        .reserveSeatAndPayFullWithInvitation(
          [
            eventId,
            nonce,
            expiry,
            signature,
          ],
          {
            account:
              attendeeOne.account,
          },
        ),
    );

    await waitForTransaction(
      showUp.write.cancelEvent(
        [eventId],
        {
          account:
            organizer.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write
        .claimCancelledEventRefund(
          [eventId],
          {
            account:
              attendeeOne.account,
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
      6,
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

    assert.equal(
      await showUp.read.totalEscrowed(),
      0n,
    );
  });

  it("supports full-payment-only public paid events", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers
      .loadFixture(deployFixture);

    const { eventId } =
      await createEvent({
        eventType: PAID_EVENT,
        fullPaymentOnly: true,
      });

    await viem.assertions
      .revertWithCustomError(
        showUp.write.reserveSeat(
          [eventId],
          {
            account:
              attendeeOne.account,
          },
        ),
        showUp,
        "DepositReservationsClosed",
      );

    await waitForTransaction(
      showUp.write.reserveSeatAndPayFull(
        [eventId],
        {
          account:
            attendeeOne.account,
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
      8,
    );

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      TOTAL_PRICE,
    );
  });
});
