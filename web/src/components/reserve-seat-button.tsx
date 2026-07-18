"use client";

import {
  useEffect,
  useState,
} from "react";

const CIRCLE_USER_ID_KEY =
  "showup_circle_user_id";

const CIRCLE_WALLET_READY_KEY =
  "showup_circle_wallet_ready";

const CIRCLE_WALLET_ADDRESS_KEY =
  "showup_circle_wallet_address";

const CIRCLE_WALLET_ID_KEY =
  "showup_circle_wallet_id";

const CIRCLE_WALLET_CHANGED_EVENT =
  "showup-circle-wallet-changed";

type SessionResponse = {
  userToken?: string;
  encryptionKey?: string;
  error?: string;
};

type ChallengeResponse = {
  challengeId?: string;
  alreadyApproved?: boolean;
  error?: string;
};

type ReservationStatusResponse = {
  reservation?: {
    status: number;
    label: string;
    active: boolean;
  };

  deposit?: {
    amount: string;
    formatted: string;
  };

  usdc?: {
    balance: string;
    balanceFormatted: string;
    allowance: string;
    allowanceFormatted: string;
    enoughBalance: boolean;
    enoughAllowance: boolean;
    needsApproval: boolean;
  };

  event?: {
    open: boolean;
    cancelled: boolean;
    capacityAvailable: boolean;
    reservedSeats: string;
  };

  canReserve?: boolean;
  error?: string;
};

type ReserveSeatButtonProps = {
  eventId: string;
  depositFormatted: string;
  onReservationConfirmed?: (
    reservedSeats: string,
  ) => void;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(
      resolve,
      milliseconds,
    );
  });
}

function getErrorMessage(
  error: unknown,
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "Unable to complete the reservation.";
}

async function requestCircleSession(
  userId: string,
): Promise<{
  userToken: string;
  encryptionKey: string;
}> {
  const response = await fetch(
    "/api/circle/session",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userId,
      }),
    },
  );

  const data =
    (await response.json()) as SessionResponse;

  if (
    !response.ok ||
    !data.userToken ||
    !data.encryptionKey
  ) {
    throw new Error(
      data.error ??
        "Unable to create a secure Circle session.",
    );
  }

  return {
    userToken: data.userToken,
    encryptionKey:
      data.encryptionKey,
  };
}

async function executeCircleChallenge(
  challengeId: string,
  userToken: string,
  encryptionKey: string,
) {
  const appId =
    process.env
      .NEXT_PUBLIC_CIRCLE_APP_ID;

  if (!appId) {
    throw new Error(
      "Circle App ID is not configured.",
    );
  }

  const {
    W3SSdk,
  } = await import(
    "@circle-fin/w3s-pw-web-sdk"
  );

  const circleSdk =
    new W3SSdk({
      appSettings: {
        appId,
      },
    });

  await circleSdk.getDeviceId();

  circleSdk.setAuthentication({
    userToken,
    encryptionKey,
  });

  await new Promise<void>(
    (resolve, reject) => {
      const timeout =
        window.setTimeout(
          () => {
            reject(
              new Error(
                "Circle approval timed out. No transaction was submitted.",
              ),
            );
          },
          10 * 60 * 1000,
        );

      circleSdk.execute(
        challengeId,
        (error, result) => {
          window.clearTimeout(
            timeout,
          );

          if (error) {
            reject(
              new Error(
                error.message ||
                  `Circle authorization failed${
                    error.code
                      ? ` (${error.code})`
                      : ""
                  }.`,
              ),
            );
            return;
          }

          console.info(
            "Circle transaction challenge result:",
            {
              type: result?.type,
              status: result?.status,
            },
          );

          if (!result) {
            reject(
              new Error(
                "Circle did not return an authorization result.",
              ),
            );
            return;
          }

          if (
            result.status === "FAILED" ||
            result.status === "EXPIRED"
          ) {
            reject(
              new Error(
                `Circle authorization ended with status: ${result.status}.`,
              ),
            );
            return;
          }

          /*
           * COMPLETE, PENDING and IN_PROGRESS all continue
           * to the existing onchain polling below.
           */
          resolve();
        },
      );
    },
  );
}

async function requestReservationStatus(
  eventId: string,
  walletAddress: string,
) {
  const response = await fetch(
    `/api/events/${encodeURIComponent(
      eventId,
    )}/reservation-status?attendee=${encodeURIComponent(
      walletAddress,
    )}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  const data =
    (await response.json()) as ReservationStatusResponse;

  if (!response.ok) {
    throw new Error(
      data.error ??
        "Unable to check reservation status.",
    );
  }

  return data;
}

async function waitForStatus(
  eventId: string,
  walletAddress: string,
  predicate: (
    status: ReservationStatusResponse,
  ) => boolean,
  timeoutMessage: string,
) {
  for (
    let attempt = 0;
    attempt < 45;
    attempt += 1
  ) {
    const status =
      await requestReservationStatus(
        eventId,
        walletAddress,
      );

    if (predicate(status)) {
      return status;
    }

    await wait(2000);
  }

  throw new Error(
    timeoutMessage,
  );
}

export default function ReserveSeatButton({
  eventId,
  depositFormatted,
  onReservationConfirmed,
}: ReserveSeatButtonProps) {
  const [busy, setBusy] =
    useState(false);

  const [reserved, setReserved] =
    useState(false);

  const [message, setMessage] =
    useState(
      "Connect your Circle wallet to reserve this seat.",
    );

  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function checkStatusForWallet(
      walletAddress: string,
    ) {
      try {
        const status =
          await requestReservationStatus(
            eventId,
            walletAddress,
          );

        const currentWalletAddress =
          window.localStorage.getItem(
            CIRCLE_WALLET_ADDRESS_KEY,
          ) ?? "";

        if (
          cancelled ||
          currentWalletAddress.toLowerCase() !==
            walletAddress.toLowerCase()
        ) {
          return;
        }

        setError("");

        if (
          status.reservation?.active
        ) {
          setReserved(true);
          setMessage(
            "This wallet has already reserved a seat.",
          );
          return;
        }

        setReserved(false);

        if (
          !status.usdc
            ?.enoughBalance
        ) {
          setMessage(
            `This reservation requires ${depositFormatted} USDC. Current balance: ${
              status.usdc
                ?.balanceFormatted ??
              "0"
            } USDC.`,
          );
          return;
        }

        if (
          status.usdc
            .needsApproval
        ) {
          setMessage(
            `Circle will first approve ${depositFormatted} USDC, then reserve the seat.`,
          );
          return;
        }

        setMessage(
          `Ready to reserve with a ${depositFormatted} USDC commitment deposit.`,
        );
      } catch {
        const currentWalletAddress =
          window.localStorage.getItem(
            CIRCLE_WALLET_ADDRESS_KEY,
          ) ?? "";

        if (
          cancelled ||
          currentWalletAddress.toLowerCase() !==
            walletAddress.toLowerCase()
        ) {
          return;
        }

        setReserved(false);
        setMessage(
          "Unable to refresh this wallet's reservation status. Please try again.",
        );
      }
    }

    function refreshActiveWallet() {
      const walletReady =
        window.localStorage.getItem(
          CIRCLE_WALLET_READY_KEY,
        ) === "true";

      const walletAddress =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        ) ?? "";

      setReserved(false);
      setError("");

      if (
        !walletReady ||
        !walletAddress
      ) {
        setMessage(
          "Connect your Circle wallet to reserve this seat.",
        );
        return;
      }

      setMessage(
        "Checking this wallet's reservation status...",
      );

      void checkStatusForWallet(
        walletAddress,
      );
    }

    refreshActiveWallet();

    window.addEventListener(
      CIRCLE_WALLET_CHANGED_EVENT,
      refreshActiveWallet,
    );

    return () => {
      cancelled = true;

      window.removeEventListener(
        CIRCLE_WALLET_CHANGED_EVENT,
        refreshActiveWallet,
      );
    };
  }, [
    eventId,
    depositFormatted,
  ]);

  async function handleReserve() {
    if (busy || reserved) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const circleUserId =
        window.localStorage.getItem(
          CIRCLE_USER_ID_KEY,
        ) ?? "";

      const walletReady =
        window.localStorage.getItem(
          CIRCLE_WALLET_READY_KEY,
        ) === "true";

      const walletAddress =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        ) ?? "";

      const walletId =
        window.localStorage.getItem(
          CIRCLE_WALLET_ID_KEY,
        ) ?? "";

      if (
        !circleUserId ||
        !walletReady ||
        !walletAddress ||
        !walletId
      ) {
        throw new Error(
          "Connect your Circle wallet before reserving a seat.",
        );
      }

      setMessage(
        "Creating a secure Circle session...",
      );

      const session =
        await requestCircleSession(
          circleUserId,
        );

      setMessage(
        "Checking USDC balance and reservation status...",
      );

      let status =
        await requestReservationStatus(
          eventId,
          walletAddress,
        );

      if (
        status.reservation?.active
      ) {
        setReserved(true);
        setMessage(
          "This wallet has already reserved a seat.",
        );
        return;
      }

      const reservationStatus =
        status.reservation?.status ??
        0;

      if (
        reservationStatus !== 0 &&
        reservationStatus !== 2
      ) {
        throw new Error(
          `This reservation cannot be created because its current status is ${
            status.reservation
              ?.label ??
            "unknown"
          }.`,
        );
      }

      if (
        !status.event?.open
      ) {
        throw new Error(
          "Reservations are closed for this event.",
        );
      }

      if (
        !status.event
          .capacityAvailable
      ) {
        throw new Error(
          "This event has reached capacity.",
        );
      }

      if (
        !status.usdc
          ?.enoughBalance
      ) {
        throw new Error(
          `Insufficient USDC balance. This reservation requires ${depositFormatted} USDC.`,
        );
      }

      if (
        status.usdc
          .needsApproval
      ) {
        setMessage(
          `Preparing approval for exactly ${depositFormatted} USDC...`,
        );

        const approvalResponse =
          await fetch(
            "/api/circle/usdc/approve",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              cache: "no-store",
              body: JSON.stringify({
                userToken:
                  session.userToken,
                walletId,
                eventId,
              }),
            },
          );

        const approvalData =
          (await approvalResponse.json()) as ChallengeResponse;

        if (
          !approvalResponse.ok
        ) {
          throw new Error(
            approvalData.error ??
              "Unable to prepare USDC approval.",
          );
        }

        if (
          !approvalData
            .alreadyApproved
        ) {
          if (
            !approvalData.challengeId
          ) {
            throw new Error(
              "Circle did not return an approval challenge.",
            );
          }

          setMessage(
            `Enter your Circle PIN to approve ${depositFormatted} USDC.`,
          );

          await executeCircleChallenge(
            approvalData.challengeId,
            session.userToken,
            session.encryptionKey,
          );
        }

        setMessage(
          "Waiting for the USDC approval to be confirmed on Arc Testnet...",
        );

        status =
          await waitForStatus(
            eventId,
            walletAddress,
            (currentStatus) =>
              Boolean(
                currentStatus
                  .usdc
                  ?.enoughAllowance,
              ),
            "The USDC approval was submitted but has not been confirmed yet. Please try again shortly.",
          );
      }

      if (
        !status.usdc
          ?.enoughAllowance
      ) {
        throw new Error(
          "USDC approval has not been confirmed yet.",
        );
      }

      setMessage(
        "Preparing the ShowUp reservation...",
      );

      const reserveResponse =
        await fetch(
          "/api/circle/events/reserve",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              userToken:
                session.userToken,
              walletId,
              eventId,
            }),
          },
        );

      const reserveData =
        (await reserveResponse.json()) as ChallengeResponse;

      if (
        !reserveResponse.ok ||
        !reserveData.challengeId
      ) {
        throw new Error(
          reserveData.error ??
            "Unable to prepare the reservation transaction.",
        );
      }

      setMessage(
        `Enter your Circle PIN to lock the ${depositFormatted} USDC deposit and reserve your seat.`,
      );

      await executeCircleChallenge(
        reserveData.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage(
        "Waiting for the reservation to be confirmed on Arc Testnet...",
      );

      const confirmedStatus =
        await waitForStatus(
          eventId,
          walletAddress,
          (currentStatus) =>
            Boolean(
              currentStatus
                .reservation
                ?.active,
            ),
          "The reservation was submitted but has not been confirmed yet. Please refresh shortly.",
        );

      onReservationConfirmed?.(
        confirmedStatus.event
          ?.reservedSeats ?? "",
      );

      setReserved(true);
      setMessage(
        "Seat reserved successfully. Your USDC deposit is now secured by ShowUp.",
      );
    } catch (reserveError) {
      console.error(
        "ShowUp reservation failed:",
        reserveError,
      );

      const errorMessage =
        getErrorMessage(
          reserveError,
        );

      setError(errorMessage);
      setMessage(
        "The reservation was not completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handleReserve}
        disabled={
          busy || reserved
        }
        className={`w-full rounded-2xl py-4 font-semibold transition ${
          reserved
            ? "cursor-default border border-[#74f2c2]/25 bg-[#74f2c2]/10 text-[#b7ffe3]"
            : busy
              ? "cursor-wait bg-[#74f2c2] text-[#07110f] opacity-65"
              : "bg-[#74f2c2] text-[#07110f] hover:bg-[#8ff6cf]"
        }`}
      >
        {reserved
          ? "Seat reserved"
          : busy
            ? "Processing reservation..."
            : `Reserve seat — ${depositFormatted} USDC`}
      </button>

      <p
        aria-live="polite"
        className={`mt-3 text-center text-xs leading-5 ${
          error
            ? "text-red-300"
            : reserved
              ? "text-[#aaffdc]"
              : "text-white/35"
        }`}
      >
        {error || message}
      </p>
    </div>
  );
}
