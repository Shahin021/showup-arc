import {
  initiateUserControlledWalletsClient,
} from "@circle-fin/user-controlled-wallets";

import {
  NextResponse,
} from "next/server";

import {
  getAddress,
  isAddress,
  type Hex,
} from "viem";

import {
  arcPublicClient,
} from "@/lib/arc-public-client";

import {
  getViemInvitationTypedData,
} from "@/lib/showup-invitation";

import {
  getShowUpAddress,
  SHOWUP_EVENT_ABI,
  ShowUpApiError,
  type ShowUpEventDetails,
} from "@/lib/showup-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvitationResultRequest = {
  userToken?: unknown;
  challengeId?: unknown;
  eventId?: unknown;
  attendee?: unknown;
  nonce?: unknown;
  expiry?: unknown;
  signature?: unknown;
};

type CircleChallenge = {
  status?: unknown;
  type?: unknown;
  signature?: unknown;
  walletAddress?: unknown;
  errorMessage?: unknown;
};

type CircleChallengeResponse = {
  challenge?: CircleChallenge;
};

const COMPLETED_STATUSES =
  new Set([
    "COMPLETE",
    "COMPLETED",
  ]);

const FAILED_STATUSES =
  new Set([
    "FAILED",
    "EXPIRED",
    "DENIED",
  ]);

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function parseUint(
  value: unknown,
  fieldName: string,
  allowZero = false,
) {
  const normalized =
    readString(value);

  if (
    !/^\d+$/.test(normalized)
  ) {
    throw new ShowUpApiError(
      `${fieldName} is invalid.`,
    );
  }

  const parsed =
    BigInt(normalized);

  if (
    allowZero
      ? parsed < BigInt(0)
      : parsed <= BigInt(0)
  ) {
    throw new ShowUpApiError(
      `${fieldName} must be greater than zero.`,
    );
  }

  return parsed;
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

function readCircleSignatureValue(
  value: unknown,
) {
  const directValue =
    readString(value);

  if (directValue) {
    return directValue;
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return "";
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  return (
    readString(
      record.signature,
    ) ||
    readString(
      record.value,
    ) ||
    readString(
      record.data,
    )
  );
}

function normalizeCircleSignature(
  value: unknown,
) {
  const rawSignature =
    readCircleSignatureValue(
      value,
    );

  if (!rawSignature) {
    throw new ShowUpApiError(
      "Circle completed the challenge but did not return an invitation signature.",
      502,
    );
  }

  const signatureBody =
    rawSignature.replace(
      /^0x/i,
      "",
    );

  if (
    !signatureBody ||
    !/^(?:[0-9a-fA-F]{2})+$/.test(
      signatureBody,
    )
  ) {
    throw new ShowUpApiError(
      "Circle returned an invitation signature in an unsupported format.",
      502,
    );
  }

  return `0x${signatureBody}` as Hex;
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
        )) as InvitationResultRequest;

    const userToken =
      readString(body.userToken);

    const challengeId =
      readString(body.challengeId);

    if (!userToken) {
      throw new ShowUpApiError(
        "A valid Circle session is required.",
      );
    }

    if (!challengeId) {
      throw new ShowUpApiError(
        "Invitation challenge ID is required.",
      );
    }

    const eventId =
      parseUint(
        body.eventId,
        "Event ID",
      );

    const attendee =
      parseAddress(
        body.attendee,
        "Invited wallet address",
      );

    const nonce =
      parseUint(
        body.nonce,
        "Invitation nonce",
        true,
      );

    const expiry =
      parseUint(
        body.expiry,
        "Invitation expiry",
      );

    const callbackSignature =
      readString(
        body.signature,
      );

    const circleClient =
      getCircleClient();

    const circleResponse =
      await circleClient.getUserChallenge({
        userToken,
        challengeId,
      });

    const responseData =
      circleResponse.data as
        | CircleChallengeResponse
        | undefined;

    const challenge =
      responseData?.challenge;

    if (!challenge) {
      throw new ShowUpApiError(
        "Circle did not return the invitation challenge.",
        502,
      );
    }

    const status =
      String(
        challenge.status ?? "",
      ).toUpperCase();

    if (
      !COMPLETED_STATUSES.has(
        status,
      )
    ) {
      if (
        FAILED_STATUSES.has(
          status,
        )
      ) {
        const errorMessage =
          readString(
            challenge.errorMessage,
          );

        throw new ShowUpApiError(
          errorMessage ||
            `The signature challenge ended with status ${status}.`,
          409,
        );
      }

      return NextResponse.json(
        {
          completed: false,
          status:
            status || "PENDING",
        },
        {
          status: 202,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const challengeType =
      String(
        challenge.type ?? "",
      ).toUpperCase();

    if (
      challengeType &&
      challengeType !==
        "SIGN_TYPEDDATA" &&
      challengeType !==
        "SIGN_TYPED_DATA"
    ) {
      throw new ShowUpApiError(
        "The completed Circle challenge is not a typed-data signature.",
        409,
      );
    }

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
      Number(
        eventDetails.accessMode,
      ) !== 1
    ) {
      throw new ShowUpApiError(
        "This event is not Invite-only.",
      );
    }

    const signature =
      normalizeCircleSignature(
        callbackSignature ||
          challenge.signature,
      );

    const signedBy =
      getAddress(
        eventDetails.organizer,
      );

    const now =
      BigInt(
        Math.floor(
          Date.now() / 1000,
        ),
      );

    if (expiry <= now) {
      throw new ShowUpApiError(
        "The invitation expired before it could be created.",
        409,
      );
    }

    const invitation = {
      eventId,
      attendee,
      nonce,
      expiry,
    };

    const typedData =
      getViemInvitationTypedData(
        invitation,
      );

    const signatureValid =
      await arcPublicClient.verifyTypedData({
        address:
          signedBy,
        domain:
          typedData.domain,
        primaryType:
          typedData.primaryType,
        types:
          typedData.types,
        message:
          typedData.message,
        signature:
          signature as Hex,
      });

    if (!signatureValid) {
      throw new ShowUpApiError(
        "The organizer signature does not match this invitation.",
        409,
      );
    }

    const searchParams =
      new URLSearchParams({
        attendee,
        nonce:
          nonce.toString(),
        expiry:
          expiry.toString(),
        signature,
      });

    const invitePath =
      `/events/${eventId.toString()}?${searchParams.toString()}`;

    return NextResponse.json(
      {
        completed: true,
        status,
        signedBy,
        invitation: {
          eventId:
            eventId.toString(),
          attendee,
          nonce:
            nonce.toString(),
          expiry:
            expiry.toString(),
          signature,
        },
        invitePath,
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
      "ShowUp invitation signature result failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to retrieve the invitation signature.",
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
