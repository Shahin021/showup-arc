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
  eventType?: number;
  eventTypeLabel?: string;

  reservation?: {
    status: number;
    label: string;
    active: boolean;
    reservedAt?: string;
    updatedAt?: string;
    paymentDeadline?: string;
    paymentDue?: boolean;
    completed?: boolean;
    paymentDefaulted?: boolean;
  };

  deposit?: {
    amount: string;
    formatted: string;
  };

  totalPrice?: {
    amount: string;
    formatted: string;
  };

  remainingBalance?: {
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
    eventType?: number;
    eventTypeLabel?: string;
    capacityAvailable: boolean;
    capacity?: string;
    reservedSeats: string;
    eventStart: string;
    eventEnd: string;
    resolutionDeadline: string;
    canClaimCancelledEventRefund: boolean;
    canClaimFallbackRefund: boolean;
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
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
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

function hasPositiveAmount(
  value: string | undefined,
) {
  try {
    return BigInt(
      value ?? "0",
    ) > BigInt(0);
  } catch {
    return false;
  }
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
                "Circle authorization timed out. No transaction was submitted.",
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
              status:
                result?.status,
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
            result.status ===
              "FAILED" ||
            result.status ===
              "EXPIRED"
          ) {
            reject(
              new Error(
                `Circle authorization ended with status: ${result.status}.`,
              ),
            );

            return;
          }

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

function getActiveReservationMessage(
  status: number,
  isPaidEvent: boolean,
) {
  if (status === 3) {
    return "Attendance has been confirmed for this reservation.";
  }

  if (status === 4) {
    return "This reservation has been settled as a no-show.";
  }

  if (status === 7) {
    return "Your seat is reserved. The remaining event payment is now due.";
  }

  if (status === 8) {
    return "Your reservation is fully paid and completed.";
  }

  if (status === 9) {
    return "The remaining payment deadline passed and this reservation is in payment default.";
  }

  if (isPaidEvent) {
    return "This wallet already has an active paid reservation.";
  }

  return "This wallet has already reserved a seat.";
}

export default function ReserveSeatButton({
  eventId,
  depositFormatted,
  onReservationConfirmed,
}: ReserveSeatButtonProps) {
  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    reserved,
    setReserved,
  ] = useState(false);

  const [
    reservationStatus,
    setReservationStatus,
  ] = useState(0);

  const [
    eventType,
    setEventType,
  ] =
    useState<number | null>(
      null,
    );

  const [
    depositAmount,
    setDepositAmount,
  ] = useState("0");

  const [
    displayedDeposit,
    setDisplayedDeposit,
  ] = useState(
    depositFormatted,
  );

  const [
    eventOpen,
    setEventOpen,
  ] = useState(false);

  const [
    eventCancelled,
    setEventCancelled,
  ] = useState(false);

  const [
    canReserve,
    setCanReserve,
  ] = useState(false);

  const [
    walletConnected,
    setWalletConnected,
  ] = useState(false);

  const [
    canClaimCancelledEventRefund,
    setCanClaimCancelledEventRefund,
  ] = useState(false);

  const [
    canClaimFallbackRefund,
    setCanClaimFallbackRefund,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState(
    "Connect your Circle wallet to reserve this seat.",
  );

  const [
    error,
    setError,
  ] = useState("");

  const isPaidEvent =
    eventType === 1;

  const hasDeposit =
    hasPositiveAmount(
      depositAmount,
    );

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

        const currentStatus =
          status.reservation
            ?.status ?? 0;

        const currentEventType =
          status.eventType ??
          status.event
            ?.eventType ??
          0;

        const currentDepositAmount =
          status.deposit
            ?.amount ?? "0";

        const currentDepositFormatted =
          status.deposit
            ?.formatted ??
          depositFormatted;

        const currentIsPaidEvent =
          currentEventType === 1;

        const currentHasDeposit =
          hasPositiveAmount(
            currentDepositAmount,
          );

        setError("");

        setReservationStatus(
          currentStatus,
        );

        setEventType(
          currentEventType,
        );

        setDepositAmount(
          currentDepositAmount,
        );

        setDisplayedDeposit(
          currentDepositFormatted,
        );

        setEventOpen(
          Boolean(
            status.event?.open,
          ),
        );

        setEventCancelled(
          Boolean(
            status.event
              ?.cancelled,
          ),
        );

        setCanReserve(
          Boolean(
            status.canReserve,
          ),
        );

        setCanClaimCancelledEventRefund(
          currentHasDeposit &&
            Boolean(
              status.event
                ?.canClaimCancelledEventRefund,
            ),
        );

        setCanClaimFallbackRefund(
          currentHasDeposit &&
            Boolean(
              status.event
                ?.canClaimFallbackRefund,
            ),
        );

        if (
          currentStatus === 5 ||
          currentStatus === 6
        ) {
          setReserved(false);

          setMessage(
            "The available refund has already been claimed by this wallet.",
          );

          return;
        }

        if (
          status.event?.cancelled &&
          currentStatus === 1 &&
          !currentHasDeposit
        ) {
          setReserved(true);

          setMessage(
            "This event was cancelled. No refund is required because no USDC was locked.",
          );

          return;
        }

        if (
          status.reservation
            ?.active
        ) {
          setReserved(true);

          setMessage(
            getActiveReservationMessage(
              currentStatus,
              currentIsPaidEvent,
            ),
          );

          return;
        }

        setReserved(false);

        if (
          status.event?.cancelled
        ) {
          setMessage(
            "Reservations are closed because this event was cancelled.",
          );

          return;
        }

        if (
          !status.event?.open
        ) {
          setMessage(
            "Reservations are closed for this event.",
          );

          return;
        }

        if (
          status.usdc
            ?.enoughBalance ===
          false
        ) {
          setMessage(
            currentIsPaidEvent
              ? `This paid reservation requires ${currentDepositFormatted} USDC upfront. Current balance: ${
                  status.usdc
                    ?.balanceFormatted ??
                  "0"
                } USDC.`
              : `This reservation requires a ${currentDepositFormatted} USDC refundable deposit. Current balance: ${
                  status.usdc
                    ?.balanceFormatted ??
                  "0"
                } USDC.`,
          );

          return;
        }

        if (
          currentHasDeposit &&
          status.usdc
            ?.needsApproval
        ) {
          setMessage(
            currentIsPaidEvent
              ? `Circle will first approve the ${currentDepositFormatted} USDC upfront payment, then reserve the seat.`
              : `Circle will first approve the ${currentDepositFormatted} USDC refundable deposit, then reserve the seat.`,
          );

          return;
        }

        if (
          !currentHasDeposit
        ) {
          setMessage(
            "Ready to reserve. No USDC deposit is required.",
          );

          return;
        }

        setMessage(
          currentIsPaidEvent
            ? `Ready to reserve with an upfront payment of ${currentDepositFormatted} USDC.`
            : `Ready to reserve with a refundable commitment deposit of ${currentDepositFormatted} USDC.`,
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
        setCanReserve(false);

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
      setReservationStatus(0);
      setEventType(null);
      setDepositAmount("0");
      setDisplayedDeposit(
        depositFormatted,
      );
      setEventOpen(false);
      setEventCancelled(false);
      setCanReserve(false);
      setCanClaimCancelledEventRefund(
        false,
      );
      setCanClaimFallbackRefund(
        false,
      );
      setError("");

      if (
        !walletReady ||
        !walletAddress
      ) {
        setWalletConnected(false);

        setMessage(
          "Connect your Circle wallet to reserve this seat.",
        );

        return;
      }

      setWalletConnected(true);

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
    if (
      busy ||
      reserved ||
      !walletConnected ||
      !canReserve
    ) {
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

      const currentStatus =
        status.reservation
          ?.status ?? 0;

      const currentEventType =
        status.eventType ??
        status.event?.eventType ??
        0;

      const currentIsPaidEvent =
        currentEventType === 1;

      const currentDepositAmount =
        status.deposit?.amount ??
        "0";

      const currentDepositFormatted =
        status.deposit
          ?.formatted ??
        displayedDeposit;

      const currentHasDeposit =
        hasPositiveAmount(
          currentDepositAmount,
        );

      setReservationStatus(
        currentStatus,
      );

      setEventType(
        currentEventType,
      );

      setDepositAmount(
        currentDepositAmount,
      );

      setDisplayedDeposit(
        currentDepositFormatted,
      );

      setEventOpen(
        Boolean(
          status.event?.open,
        ),
      );

      setEventCancelled(
        Boolean(
          status.event
            ?.cancelled,
        ),
      );

      setCanReserve(
        Boolean(
          status.canReserve,
        ),
      );

      if (
        status.reservation
          ?.active
      ) {
        setReserved(true);

        setMessage(
          getActiveReservationMessage(
            currentStatus,
            currentIsPaidEvent,
          ),
        );

        return;
      }

      if (
        currentStatus !== 0 &&
        currentStatus !== 2
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
        status.usdc
          ?.enoughBalance ===
        false
      ) {
        throw new Error(
          currentIsPaidEvent
            ? `Insufficient USDC balance. This paid reservation requires ${currentDepositFormatted} USDC upfront.`
            : `Insufficient USDC balance. This reservation requires a ${currentDepositFormatted} USDC deposit.`,
        );
      }

      if (
        currentHasDeposit &&
        status.usdc
          ?.needsApproval
      ) {
        setMessage(
          currentIsPaidEvent
            ? `Preparing approval for the ${currentDepositFormatted} USDC upfront payment...`
            : `Preparing approval for the ${currentDepositFormatted} USDC refundable deposit...`,
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
            currentIsPaidEvent
              ? `Enter your Circle PIN to approve the ${currentDepositFormatted} USDC upfront payment.`
              : `Enter your Circle PIN to approve the ${currentDepositFormatted} USDC refundable deposit.`,
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
            (
              currentStatusResponse,
            ) =>
              Boolean(
                currentStatusResponse
                  .usdc
                  ?.enoughAllowance,
              ),
            "The USDC approval was submitted but has not been confirmed yet. Please try again shortly.",
          );
      }

      if (
        currentHasDeposit &&
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

      if (!currentHasDeposit) {
        setMessage(
          "Enter your Circle PIN to reserve this seat. No USDC will be transferred.",
        );
      } else if (
        currentIsPaidEvent
      ) {
        setMessage(
          `Enter your Circle PIN to lock the ${currentDepositFormatted} USDC upfront payment and reserve your seat.`,
        );
      } else {
        setMessage(
          `Enter your Circle PIN to lock the ${currentDepositFormatted} USDC refundable deposit and reserve your seat.`,
        );
      }

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
          (
            currentStatusResponse,
          ) =>
            Boolean(
              currentStatusResponse
                .reservation
                ?.active,
            ),
          "The reservation was submitted but has not been confirmed yet. Please refresh shortly.",
        );

      const confirmedReservationStatus =
        confirmedStatus
          .reservation?.status ??
        1;

      setReservationStatus(
        confirmedReservationStatus,
      );

      setReserved(true);
      setCanReserve(false);

      onReservationConfirmed?.(
        confirmedStatus.event
          ?.reservedSeats ?? "",
      );

      if (!currentHasDeposit) {
        setMessage(
          "Seat reserved successfully. No USDC deposit was required.",
        );
      } else if (
        currentIsPaidEvent
      ) {
        setMessage(
          "Seat reserved successfully. Your upfront payment is now secured by ShowUp.",
        );
      } else {
        setMessage(
          "Seat reserved successfully. Your refundable USDC deposit is now secured by ShowUp.",
        );
      }
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

  async function handleClaimRefund(
    refundType:
      | "cancelled"
      | "fallback",
  ) {
    if (busy) {
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
          "Connect the Circle wallet that made this reservation.",
        );
      }

      setMessage(
        "Creating a secure Circle session...",
      );

      const session =
        await requestCircleSession(
          circleUserId,
        );

      const endpoint =
        refundType ===
        "cancelled"
          ? "/api/circle/events/claim-cancelled-refund"
          : "/api/circle/events/claim-fallback-refund";

      setMessage(
        refundType ===
          "cancelled"
          ? "Preparing your cancelled-event refund..."
          : "Preparing your fallback refund...",
      );

      const response =
        await fetch(
          endpoint,
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

      const data =
        (await response.json()) as ChallengeResponse;

      if (
        !response.ok ||
        !data.challengeId
      ) {
        throw new Error(
          data.error ??
            "Unable to prepare the refund transaction.",
        );
      }

      setMessage(
        "Enter your Circle PIN to claim the available USDC refund.",
      );

      await executeCircleChallenge(
        data.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage(
        "Waiting for the refund to be confirmed on Arc Testnet...",
      );

      const expectedStatus =
        refundType ===
        "cancelled"
          ? 6
          : 5;

      await waitForStatus(
        eventId,
        walletAddress,
        (
          currentStatus,
        ) =>
          currentStatus
            .reservation
            ?.status ===
          expectedStatus,
        "The refund was submitted but has not been confirmed yet. Refresh shortly.",
      );

      setReserved(false);

      setReservationStatus(
        expectedStatus,
      );

      setCanReserve(false);

      setCanClaimCancelledEventRefund(
        false,
      );

      setCanClaimFallbackRefund(
        false,
      );

      setMessage(
        "The available USDC refund was returned to this wallet successfully.",
      );
    } catch (refundError) {
      console.error(
        "ShowUp attendee refund failed:",
        refundError,
      );

      setError(
        getErrorMessage(
          refundError,
        ),
      );

      setMessage(
        "The refund was not completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function getButtonLabel() {
    if (busy) {
      return "Processing reservation...";
    }

    if (
      reservationStatus === 7
    ) {
      return "Payment due";
    }

    if (
      reservationStatus === 8
    ) {
      return "Payment completed";
    }

    if (
      reservationStatus === 9
    ) {
      return "Payment defaulted";
    }

    if (
      reservationStatus === 3
    ) {
      return "Attendance confirmed";
    }

    if (
      reservationStatus === 4
    ) {
      return "No-show settled";
    }

    if (reserved) {
      return isPaidEvent
        ? "Paid seat reserved"
        : "Seat reserved";
    }

    if (!walletConnected) {
      return "Connect Circle wallet";
    }

    if (eventCancelled) {
      return "Event cancelled";
    }

    if (
      !eventOpen ||
      !canReserve
    ) {
      return "Reservation unavailable";
    }

    if (!hasDeposit) {
      return "Reserve free seat";
    }

    if (isPaidEvent) {
      return `Reserve seat — ${displayedDeposit} USDC upfront`;
    }

    return `Reserve seat — ${displayedDeposit} USDC deposit`;
  }

  const mainButtonDisabled =
    busy ||
    reserved ||
    !walletConnected ||
    !eventOpen ||
    !canReserve;

  const messageClassName =
    error
      ? "text-red-300"
      : reservationStatus === 9
        ? "text-amber-200"
        : reserved ||
            reservationStatus ===
              5 ||
            reservationStatus ===
              6
          ? "text-[#aaffdc]"
          : "text-white/35";

  return (
    <div className="mt-6">
      {canClaimCancelledEventRefund ? (
        <button
          type="button"
          onClick={() => {
            void handleClaimRefund(
              "cancelled",
            );
          }}
          disabled={busy}
          className="w-full rounded-2xl border border-[#74f2c2]/30 bg-[#74f2c2] py-4 font-semibold text-[#07110f] transition hover:bg-[#8ff6cf] disabled:cursor-wait disabled:opacity-60"
        >
          {busy
            ? "Processing refund..."
            : "Claim cancelled-event refund"}
        </button>
      ) : canClaimFallbackRefund ? (
        <button
          type="button"
          onClick={() => {
            void handleClaimRefund(
              "fallback",
            );
          }}
          disabled={busy}
          className="w-full rounded-2xl border border-[#74f2c2]/30 bg-[#74f2c2] py-4 font-semibold text-[#07110f] transition hover:bg-[#8ff6cf] disabled:cursor-wait disabled:opacity-60"
        >
          {busy
            ? "Processing refund..."
            : "Claim fallback refund"}
        </button>
      ) : reservationStatus === 5 ||
        reservationStatus === 6 ? (
        <button
          type="button"
          disabled
          className="w-full cursor-default rounded-2xl border border-[#74f2c2]/25 bg-[#74f2c2]/10 py-4 font-semibold text-[#b7ffe3]"
        >
          Refund claimed
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            void handleReserve();
          }}
          disabled={
            mainButtonDisabled
          }
          className={`w-full rounded-2xl py-4 font-semibold transition ${
            reserved
              ? "cursor-default border border-[#74f2c2]/25 bg-[#74f2c2]/10 text-[#b7ffe3]"
              : busy
                ? "cursor-wait bg-[#74f2c2] text-[#07110f] opacity-65"
                : mainButtonDisabled
                  ? "cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/35"
                  : "bg-[#74f2c2] text-[#07110f] hover:bg-[#8ff6cf]"
          }`}
        >
          {getButtonLabel()}
        </button>
      )}

      <p
        aria-live="polite"
        className={`mt-3 text-center text-xs leading-5 ${messageClassName}`}
      >
        {error || message}
      </p>
    </div>
  );
}
