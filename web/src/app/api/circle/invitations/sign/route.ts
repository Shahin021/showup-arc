import {
  randomBytes,
} from "node:crypto";

import {
  initiateUserControlledWalletsClient,
} from "@circle-fin/user-controlled-wallets";

import {
  NextResponse,
} from "next/server";

import {
  getAddress,
  isAddress,
} from "viem";

import {
  arcPublicClient,
} from "@/lib/arc-public-client";

import {
  getCircleInvitationTypedData,
} from "@/lib/showup-invitation";

import {
  getShowUpAddress,
  SHOWUP_EVENT_ABI,
  ShowUpApiError,
  type ShowUpEventDetails,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignInvitationRequest = {
  userToken?: unknown;
  walletId?: unknown;
  organizerAddress?: unknown;
  eventId?: unknown;
  attendee?: unknown;
  expiryHours?: unknown;
};

type CircleChallengeData = {
  challengeId?: string;
};

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function parseEventId(
  value: unknown,
) {
  const normalized =
    readString(value);

  if (
    !/^\d+$/.test(normalized)
  ) {
    throw new ShowUpApiError(
      "Event ID is invalid.",
    );
  }

  const eventId =
    BigInt(normalized);

  if (eventId <= BigInt(0)) {
    throw new ShowUpApiError(
      "Event ID must be greater than zero.",
    );
  }

  return eventId;
}

function parseExpiryHours(
  value: unknown,
) {
  const normalized =
    value === undefined ||
    value === null ||
    value === ""
      ? "72"
      : String(value).trim();

  if (
    !/^\d+$/.test(normalized)
  ) {
    throw new ShowUpApiError(
      "Invitation expiry must be a whole number of hours.",
    );
  }

  const hours =
    Number(normalized);

  if (
    !Number.isSafeInteger(hours) ||
    hours < 1 ||
    hours > 720
  ) {
    throw new ShowUpApiError(
      "Invitation expiry must be between 1 and 720 hours.",
    );
  }

  return hours;
}

function parseAddress(
  value: unknown,
  fieldName: string,
) {
  const normalized =
    readString(value);

  if (!isAddress(normalized)) {
    throw new ShowUpApiError(
      `${fieldName} is invalid.`,
    );
  }

  return getAddress(normalized);
}

function getCircleClient() {
  const apiKey =
    process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new ShowUpApiError(
      "CIRCLE_API_KEY is not configured.",
      500,
    );
  }

  return initiateUserControlledWalletsClient({
    apiKey,
  });
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as SignInvitationRequest;

    const userToken =
      readString(body.userToken);

    const walletId =
      readString(body.walletId);

    if (!userToken) {
      throw new ShowUpApiError(
        "A valid Circle session is required.",
      );
    }

    if (!walletId) {
      throw new ShowUpApiError(
        "Connect the organizer Circle wallet first.",
      );
    }

    const eventId =
      parseEventId(
        body.eventId,
      );

    const organizerAddress =
      parseAddress(
        body.organizerAddress,
        "Organizer wallet address",
      );

    const attendee =
      parseAddress(
        body.attendee,
        "Invited wallet address",
      );

    const expiryHours =
      parseExpiryHours(
        body.expiryHours,
      );

    const eventDetails =
      (await arcPublicClient.readContract({
        address:
          getShowUpAddress(),
        abi:
          SHOWUP_EVENT_ABI,
        functionName:
          "getEvent",
        args: [
          eventId,
        ],
      })) as ShowUpEventDetails;

    if (
      eventDetails.organizer
        .toLowerCase() !==
      organizerAddress.toLowerCase()
    ) {
      throw new ShowUpApiError(
        "Only the event organizer can create invitations.",
        403,
      );
    }

    if (
      Number(
        eventDetails.accessMode,
      ) !== 1
    ) {
      throw new ShowUpApiError(
        "Invitations are only available for Invite-only events.",
      );
    }

    if (eventDetails.cancelled) {
      throw new ShowUpApiError(
        "Invitations cannot be created for a cancelled event.",
      );
    }

    if (
      attendee.toLowerCase() ===
      organizerAddress.toLowerCase()
    ) {
      throw new ShowUpApiError(
        "The organizer cannot invite their own wallet.",
      );
    }

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (
      now >=
      eventDetails.eventStart
    ) {
      throw new ShowUpApiError(
        "The event has already started.",
      );
    }

    const requestedExpiry =
      now +
      BigInt(
        expiryHours *
          60 *
          60,
      );

    const expiry =
      requestedExpiry <
      eventDetails.eventStart
        ? requestedExpiry
        : eventDetails.eventStart -
          BigInt(1);

    if (expiry <= now) {
      throw new ShowUpApiError(
        "The event starts too soon to create this invitation.",
      );
    }

    const nonceBytes =
      randomBytes(16);

    let nonce =
      BigInt(
        `0x${nonceBytes.toString(
          "hex",
        )}`,
      );

    if (nonce === BigInt(0)) {
      nonce = BigInt(1);
    }

    const invitation = {
      eventId,
      attendee,
      nonce,
      expiry,
    };

    const circleClient =
      getCircleClient();

    const circleResponse =
      await circleClient.signTypedData({
        userToken,
        walletId,
        data:
          JSON.stringify(
            getCircleInvitationTypedData(
              invitation,
            ),
          ),
      });

    const circleData =
      circleResponse.data as
        | CircleChallengeData
        | undefined;

    const challengeId =
      circleData?.challengeId;

    if (!challengeId) {
      throw new ShowUpApiError(
        "Circle did not return an invitation signature challenge.",
        502,
      );
    }

    return NextResponse.json(
      {
        challengeId,
        invitation: {
          eventId:
            eventId.toString(),
          attendee,
          nonce:
            nonce.toString(),
          expiry:
            expiry.toString(),
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof ShowUpApiError
        ? error.status
        : 500;

    console.error(
      "ShowUp invitation signature challenge failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create the invitation signature challenge.",
      },
      {
        status,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}
