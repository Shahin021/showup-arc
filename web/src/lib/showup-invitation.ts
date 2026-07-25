import type {
  Address,
} from "viem";

import {
  getShowUpAddress,
} from "@/lib/showup-server";

export const ARC_TESTNET_CHAIN_ID =
  5_042_002;

export const SHOWUP_INVITATION_TYPES = {
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
} as const;

const EIP712_DOMAIN_TYPES = [
  {
    name: "name",
    type: "string",
  },
  {
    name: "version",
    type: "string",
  },
  {
    name: "chainId",
    type: "uint256",
  },
  {
    name: "verifyingContract",
    type: "address",
  },
] as const;

export type ShowUpInvitationPayload = {
  eventId: bigint;
  attendee: Address;
  nonce: bigint;
  expiry: bigint;
};

export function getInvitationDomain() {
  return {
    name: "ShowUp",
    version: "5",
    chainId:
      ARC_TESTNET_CHAIN_ID,
    verifyingContract:
      getShowUpAddress(),
  } as const;
}

export function getViemInvitationTypedData(
  payload: ShowUpInvitationPayload,
) {
  return {
    domain:
      getInvitationDomain(),
    primaryType:
      "Invitation" as const,
    types:
      SHOWUP_INVITATION_TYPES,
    message: {
      eventId:
        payload.eventId,
      attendee:
        payload.attendee,
      nonce:
        payload.nonce,
      expiry:
        payload.expiry,
    },
  };
}

export function getCircleInvitationTypedData(
  payload: ShowUpInvitationPayload,
) {
  return {
    domain:
      getInvitationDomain(),
    primaryType:
      "Invitation",
    types: {
      EIP712Domain:
        EIP712_DOMAIN_TYPES,
      Invitation:
        SHOWUP_INVITATION_TYPES
          .Invitation,
    },
    message: {
      eventId:
        payload.eventId.toString(),
      attendee:
        payload.attendee,
      nonce:
        payload.nonce.toString(),
      expiry:
        payload.expiry.toString(),
    },
  };
}


export type ReservationInvitation = {
  nonce: bigint;
  expiry: bigint;
  signature: `0x${string}`;
};

function readInvitationString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

export function parseReservationInvitation(
  input: {
    nonce?: unknown;
    expiry?: unknown;
    signature?: unknown;
  },
) {
  const nonceValue =
    readInvitationString(
      input.nonce,
    );

  const expiryValue =
    readInvitationString(
      input.expiry,
    );

  const signatureValue =
    readInvitationString(
      input.signature,
    );

  if (!/^\d+$/.test(nonceValue)) {
    throw new Error(
      "Invitation nonce is invalid.",
    );
  }

  if (!/^\d+$/.test(expiryValue)) {
    throw new Error(
      "Invitation expiry is invalid.",
    );
  }

  if (
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(
      signatureValue,
    )
  ) {
    throw new Error(
      "Invitation signature is invalid.",
    );
  }

  const nonce =
    BigInt(nonceValue);

  const expiry =
    BigInt(expiryValue);

  if (expiry <= BigInt(0)) {
    throw new Error(
      "Invitation expiry must be greater than zero.",
    );
  }

  return {
    nonce,
    expiry,
    signature:
      signatureValue as `0x${string}`,
  } satisfies ReservationInvitation;
}
