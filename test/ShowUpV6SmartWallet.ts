import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeFunctionData, type Address, type Hash, type Hex } from "viem";

/**
 * Organizers using smart contract wallets (for example Circle SCA wallets)
 * sign check-in codes and invitations that ShowUpV6 verifies via ERC-1271.
 */

const { viem, networkHelpers } = await network.create();

const CAP = 50_000_000n;
const DEPOSIT = 2_000_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ATTENDED = 3;

describe("ShowUpV6 with an ERC-1271 smart-wallet organizer", function () {
  async function fixture() {
    const [owner, attendee, stranger] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();

    const usdc = await viem.deployContract("MockUSDC");
    const showUp = await viem.deployContract("ShowUpV6", [usdc.address, CAP]);
    const smartWallet = await viem.deployContract("MockERC1271Wallet", [
      owner.account.address,
    ]);

    const wait = async (tx: Promise<Hash>) => {
      const hash = await tx;
      await publicClient.waitForTransactionReceipt({ hash });
    };

    await wait(usdc.write.mint([attendee.account.address, 100_000_000n]));
    await wait(
      usdc.write.approve([showUp.address, 100_000_000n], {
        account: attendee.account,
      }),
    );

    const now = (await publicClient.getBlock()).timestamp;
    const timeline = {
      eventStart: now + 7_200n,
      eventEnd: now + 10_800n,
    };

    async function createEventAsSmartWallet(accessMode: number) {
      const data = encodeFunctionData({
        abi: showUp.abi,
        functionName: "createEvent",
        args: [
          "Smart wallet event",
          "",
          "https://showup.example/sw.json",
          0,
          accessMode,
          DEPOSIT,
          0n,
          0n,
          now + 3_600n,
          timeline.eventStart,
          timeline.eventEnd,
          now + 14_400n,
          0n,
        ],
      });
      await wait(
        smartWallet.write.execute([showUp.address, data], {
          account: owner.account,
        }),
      );
      return showUp.read.eventCount();
    }

    const domain = {
      name: "ShowUp",
      version: "6",
      chainId,
      verifyingContract: showUp.address,
    } as const;

    async function signCheckIn(
      signer: typeof owner,
      eventId: bigint,
      issuedAt: bigint,
      expiry: bigint,
    ) {
      return (await signer.signTypedData({
        account: signer.account,
        domain,
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
    }

    return {
      owner,
      attendee,
      stranger,
      publicClient,
      usdc,
      showUp,
      smartWallet,
      wait,
      timeline,
      domain,
      createEventAsSmartWallet,
      signCheckIn,
    };
  }

  it("records the smart wallet as the organizer", async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const eventId = await f.createEventAsSmartWallet(0);
    const event = await f.showUp.read.getEvent([eventId]);
    assert.equal(event.organizer.toLowerCase(), f.smartWallet.address.toLowerCase());
  });

  it("accepts a check-in code signed by the wallet's owner (ERC-1271)", async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const eventId = await f.createEventAsSmartWallet(0);
    await f.wait(
      f.showUp.write.reserveSeat([eventId], { account: f.attendee.account }),
    );
    await networkHelpers.time.increaseTo(f.timeline.eventStart);
    const issuedAt = (await f.publicClient.getBlock()).timestamp;
    const expiry = issuedAt + 300n;
    const signature = await f.signCheckIn(f.owner, eventId, issuedAt, expiry);

    await f.wait(
      f.showUp.write.checkIn([eventId, ZERO, issuedAt, expiry, signature], {
        account: f.attendee.account,
      }),
    );

    const reservation = await f.showUp.read.getReservation([
      eventId,
      f.attendee.account.address,
    ]);
    assert.equal(reservation.status, ATTENDED);
  });

  it("rejects a code the smart wallet does not validate", async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const eventId = await f.createEventAsSmartWallet(0);
    await f.wait(
      f.showUp.write.reserveSeat([eventId], { account: f.attendee.account }),
    );
    await networkHelpers.time.increaseTo(f.timeline.eventStart);
    const issuedAt = (await f.publicClient.getBlock()).timestamp;
    const expiry = issuedAt + 300n;
    const signature = await f.signCheckIn(f.stranger, eventId, issuedAt, expiry);

    await viem.assertions.revertWithCustomError(
      f.showUp.write.checkIn([eventId, ZERO, issuedAt, expiry, signature], {
        account: f.attendee.account,
      }),
      f.showUp,
      "InvalidCheckInCode",
    );
  });

  it("verifies the smart wallet's code the same way the web app does (viem verifyTypedData)", async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const eventId = await f.createEventAsSmartWallet(0);
    const message = { eventId, attendee: ZERO, issuedAt: 100n, expiry: 400n };
    const types = {
      CheckIn: [
        { name: "eventId", type: "uint256" },
        { name: "attendee", type: "address" },
        { name: "issuedAt", type: "uint64" },
        { name: "expiry", type: "uint64" },
      ],
    } as const;
    const valid = await f.publicClient.verifyTypedData({
      address: f.smartWallet.address,
      domain: f.domain,
      types,
      primaryType: "CheckIn",
      message,
      signature: await f.signCheckIn(f.owner, eventId, 100n, 400n),
    });
    const invalid = await f.publicClient.verifyTypedData({
      address: f.smartWallet.address,
      domain: f.domain,
      types,
      primaryType: "CheckIn",
      message,
      signature: await f.signCheckIn(f.stranger, eventId, 100n, 400n),
    });
    assert.equal(valid, true);
    assert.equal(invalid, false);
  });

  it("accepts an invitation signed by the wallet's owner (ERC-1271)", async function () {
    const f = await networkHelpers.loadFixture(fixture);
    const eventId = await f.createEventAsSmartWallet(1);
    const expiry = (await f.publicClient.getBlock()).timestamp + 3_600n;
    const signature = (await f.owner.signTypedData({
      account: f.owner.account,
      domain: f.domain,
      types: {
        Invitation: [
          { name: "eventId", type: "uint256" },
          { name: "attendee", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      },
      primaryType: "Invitation",
      message: {
        eventId,
        attendee: f.attendee.account.address,
        nonce: 1n,
        expiry,
      },
    })) as Hex;

    await f.wait(
      f.showUp.write.reserveSeatWithInvitation([eventId, 1n, expiry, signature], {
        account: f.attendee.account,
      }),
    );
  });
});
