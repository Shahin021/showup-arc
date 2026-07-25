import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Address, Hash, Hex } from "viem";

const { viem, networkHelpers } = await network.create();

const DEPOSIT_AMOUNT = 2_000_000n;
const UPFRONT_AMOUNT = 3_000_000n;
const TOTAL_PRICE = 10_000_000n;
const INITIAL_BALANCE = 100_000_000n;

const PUBLIC_ACCESS = 0;
const INVITE_ONLY_ACCESS = 1;

const FREE_EVENT = 0;
const PAID_EVENT = 1;

describe("ShowUpV5 private invitations", function () {
  async function deployShowUpV5Fixture() {
    const [
      organizer,
      attendeeOne,
      attendeeTwo,
      attendeeThree,
    ] = await viem.getWalletClients();

    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();

    const mockUsdc = await viem.deployContract(
      "MockUSDC",
    );

    const showUp = await viem.deployContract(
      "ShowUpV5",
      [mockUsdc.address],
    );

    async function waitForTransaction(
      transaction: Promise<Hash>,
    ) {
      const hash = await transaction;

      await publicClient.waitForTransactionReceipt({
        hash,
      });

      return hash;
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

    async function createEvent(options?: {
      accessMode?: number;
      eventType?: number;
      capacity?: bigint;
      fullPaymentOnly?: boolean;
    }) {
      const accessMode =
        options?.accessMode ??
        INVITE_ONLY_ACCESS;

      const eventType =
        options?.eventType ??
        FREE_EVENT;

      const capacity =
        options?.capacity ?? 30n;

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
              ? "Private Paid Workshop"
              : "Private Builders Workshop",
            "A private ShowUp event on Arc.",
            "https://showup.example/metadata/private-event.json",
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
        paymentDeadline,
      };
    }

    async function createInvitation(options: {
      eventId: bigint;
      attendee: Address;
      nonce: bigint;
      expiry?: bigint;
      signer?: typeof organizer | typeof attendeeOne | typeof attendeeTwo;
    }) {
      const latestBlock =
        await publicClient.getBlock();

      const expiry =
        options.expiry ??
        latestBlock.timestamp + 3_600n;

      const signer =
        options.signer ?? organizer;

      const signature =
        await signer.signTypedData({
          account: signer.account,
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
            eventId: options.eventId,
            attendee: options.attendee,
            nonce: options.nonce,
            expiry,
          },
        });

      return {
        expiry,
        signature: signature as Hex,
      };
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
      createInvitation,
    };
  }

  it("keeps public reservations open and requires invitations for private events", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      showUp,
      waitForTransaction,
      createEvent,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const publicEvent =
      await createEvent({
        accessMode: PUBLIC_ACCESS,
      });

    const privateEvent =
      await createEvent({
        accessMode: INVITE_ONLY_ACCESS,
      });

    await waitForTransaction(
      showUp.write.reserveSeat(
        [publicEvent.eventId],
        {
          account: attendeeOne.account,
        },
      ),
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeat(
        [privateEvent.eventId],
        {
          account: attendeeTwo.account,
        },
      ),
      showUp,
      "InvitationRequired",
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          publicEvent.eventId,
          1n,
          publicEvent.eventStart,
          "0x",
        ],
        {
          account: attendeeTwo.account,
        },
      ),
      showUp,
      "InvitationNotRequired",
    );
  });

  it("allows the invited wallet to reserve a private free event", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 101n;

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
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
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
      1,
    );

    const [used, revoked] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeOne.account.address,
        nonce,
      ]);

    assert.equal(used, true);
    assert.equal(revoked, false);

    assert.equal(
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      DEPOSIT_AMOUNT,
    );
  });

  it("supports an upfront paid reservation with an invitation", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent({
        eventType: PAID_EVENT,
      });

    const nonce = 202n;

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
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
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
      await mockUsdc.read.balanceOf([
        showUp.address,
      ]),
      UPFRONT_AMOUNT,
    );
  });

  it("supports full payment at reservation time with an invitation", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent({
        eventType: PAID_EVENT,
      });

    const nonce = 303n;

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

  it("prevents another wallet from using the invitation", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      showUp,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 404n;

    const {
      expiry,
      signature,
    } = await createInvitation({
      eventId,
      attendee:
        attendeeOne.account.address,
      nonce,
    });

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeTwo.account,
        },
      ),
      showUp,
      "InvalidInvitation",
    );

    const [used] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeOne.account.address,
        nonce,
      ]);

    assert.equal(used, false);
  });

  it("rejects an invitation not signed by the organizer", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      showUp,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 505n;

    const {
      expiry,
      signature,
    } = await createInvitation({
      eventId,
      attendee:
        attendeeOne.account.address,
      nonce,
      signer: attendeeTwo,
    });

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "InvalidInvitation",
    );
  });

  it("rejects expired invitations without consuming them", async function () {
    const {
      attendeeOne,
      publicClient,
      showUp,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const latestBlock =
      await publicClient.getBlock();

    const expiry =
      latestBlock.timestamp + 60n;

    const nonce = 606n;

    const { signature } =
      await createInvitation({
        eventId,
        attendee:
          attendeeOne.account.address,
        nonce,
        expiry,
      });

    await networkHelpers.time.increaseTo(
      expiry,
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "InvitationExpired",
    );

    const [used] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeOne.account.address,
        nonce,
      ]);

    assert.equal(used, false);
  });

  it("allows the organizer to revoke an unused invitation", async function () {
    const {
      organizer,
      attendeeOne,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 707n;

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
      showUp.write.revokeInvitation(
        [
          eventId,
          attendeeOne.account.address,
          nonce,
        ],
        {
          account: organizer.account,
        },
      ),
    );

    const [used, revoked] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeOne.account.address,
        nonce,
      ]);

    assert.equal(used, false);
    assert.equal(revoked, true);

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "InvitationAlreadyRevoked",
    );
  });

  it("prevents non-organizers from revoking invitations", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      showUp,
      createEvent,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    await viem.assertions.revertWithCustomError(
      showUp.write.revokeInvitation(
        [
          eventId,
          attendeeOne.account.address,
          808n,
        ],
        {
          account: attendeeTwo.account,
        },
      ),
      showUp,
      "NotOrganizer",
    );
  });

  it("prevents replaying a used invitation", async function () {
    const {
      attendeeOne,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 909n;

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
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
      showUp,
      "InvitationAlreadyUsed",
    );
  });

  it("does not consume an invitation when the USDC transfer fails", async function () {
    const {
      attendeeOne,
      mockUsdc,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 1_010n;

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
      mockUsdc.write.approve(
        [
          showUp.address,
          0n,
        ],
        {
          account: attendeeOne.account,
        },
      ),
    );

    await assert.rejects(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
    );

    let [used] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeOne.account.address,
        nonce,
      ]);

    assert.equal(used, false);

    await waitForTransaction(
      mockUsdc.write.approve(
        [
          showUp.address,
          INITIAL_BALANCE,
        ],
        {
          account: attendeeOne.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
    );

    [used] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeOne.account.address,
        nonce,
      ]);

    assert.equal(used, true);
  });

  it("does not consume an invitation when the event is at capacity", async function () {
    const {
      attendeeOne,
      attendeeTwo,
      showUp,
      waitForTransaction,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent({
        capacity: 1n,
      });

    const inviteOne =
      await createInvitation({
        eventId,
        attendee:
          attendeeOne.account.address,
        nonce: 1_111n,
      });

    const inviteTwo =
      await createInvitation({
        eventId,
        attendee:
          attendeeTwo.account.address,
        nonce: 1_212n,
      });

    await waitForTransaction(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          1_111n,
          inviteOne.expiry,
          inviteOne.signature,
        ],
        {
          account: attendeeOne.account,
        },
      ),
    );

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          1_212n,
          inviteTwo.expiry,
          inviteTwo.signature,
        ],
        {
          account: attendeeTwo.account,
        },
      ),
      showUp,
      "EventAtCapacity",
    );

    let [used] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeTwo.account.address,
        1_212n,
      ]);

    assert.equal(used, false);

    await waitForTransaction(
      showUp.write.cancelReservation(
        [eventId],
        {
          account: attendeeOne.account,
        },
      ),
    );

    await waitForTransaction(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          1_212n,
          inviteTwo.expiry,
          inviteTwo.signature,
        ],
        {
          account: attendeeTwo.account,
        },
      ),
    );

    [used] =
      await showUp.read.getInvitationState([
        eventId,
        attendeeTwo.account.address,
        1_212n,
      ]);

    assert.equal(used, true);
  });

  it("does not consume an invitation when the organizer tries to reserve", async function () {
    const {
      organizer,
      showUp,
      createEvent,
      createInvitation,
    } = await networkHelpers.loadFixture(
      deployShowUpV5Fixture,
    );

    const { eventId } =
      await createEvent();

    const nonce = 1_313n;

    const {
      expiry,
      signature,
    } = await createInvitation({
      eventId,
      attendee:
        organizer.account.address,
      nonce,
    });

    await viem.assertions.revertWithCustomError(
      showUp.write.reserveSeatWithInvitation(
        [
          eventId,
          nonce,
          expiry,
          signature,
        ],
        {
          account: organizer.account,
        },
      ),
      showUp,
      "OrganizerCannotReserve",
    );

    const [used] =
      await showUp.read.getInvitationState([
        eventId,
        organizer.account.address,
        nonce,
      ]);

    assert.equal(used, false);
  });
});
