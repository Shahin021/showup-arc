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

  reservation?: {
    status: number;
    label: string;
    paymentDeadline?: string;
    paymentDue?: boolean;
    completed?: boolean;
    paymentDefaulted?: boolean;
  };

  remainingPayment?: {
    amount: string;
    formatted: string;
    paymentDeadline: string;
    paymentWindowOpen: boolean;
    paymentDeadlinePassed: boolean;

    balance: string;
    balanceFormatted: string;

    allowance: string;
    allowanceFormatted: string;

    enoughBalance: boolean;
    enoughAllowance: boolean;
    needsApproval: boolean;
    canPay: boolean;
  };

  error?: string;
};

type PayRemainingBalanceButtonProps = {
  eventId: string;

  onPaymentCompleted?: () => void;
};

function wait(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function formatTimestamp(
  timestamp: string,
) {
  const seconds =
    Number(timestamp);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "Not available";
  }

  return new Date(
    seconds * 1000,
  ).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
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

  return "Unable to complete the remaining payment.";
}

async function requestCircleSession(
  userId: string,
): Promise<{
  userToken: string;
  encryptionKey: string;
}> {
  const response =
    await fetch(
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
    userToken:
      data.userToken,

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
  const response =
    await fetch(
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
        "Unable to check the remaining-payment status.",
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

export default function PayRemainingBalanceButton({
  eventId,
  onPaymentCompleted,
}: PayRemainingBalanceButtonProps) {
  const [
    visible,
    setVisible,
  ] = useState(false);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    reservationStatus,
    setReservationStatus,
  ] = useState(0);

  const [
    remainingFormatted,
    setRemainingFormatted,
  ] = useState("0");

  const [
    paymentDeadline,
    setPaymentDeadline,
  ] = useState("0");

  const [
    paymentWindowOpen,
    setPaymentWindowOpen,
  ] = useState(false);

  const [
    paymentDeadlinePassed,
    setPaymentDeadlinePassed,
  ] = useState(false);

  const [
    enoughBalance,
    setEnoughBalance,
  ] = useState(false);

  const [
    needsApproval,
    setNeedsApproval,
  ] = useState(false);

  const [
    walletConnected,
    setWalletConnected,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

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

        const remainingPayment =
          status.remainingPayment;

        const paidPaymentState =
          status.eventType === 1 &&
          (
            currentStatus === 7 ||
            currentStatus === 8 ||
            currentStatus === 9
          );

        setVisible(
          paidPaymentState,
        );

        setReservationStatus(
          currentStatus,
        );

        setRemainingFormatted(
          remainingPayment
            ?.formatted ?? "0",
        );

        setPaymentDeadline(
          remainingPayment
            ?.paymentDeadline ??
            status.reservation
              ?.paymentDeadline ??
            "0",
        );

        setPaymentWindowOpen(
          Boolean(
            remainingPayment
              ?.paymentWindowOpen,
          ),
        );

        setPaymentDeadlinePassed(
          Boolean(
            remainingPayment
              ?.paymentDeadlinePassed,
          ),
        );

        setEnoughBalance(
          Boolean(
            remainingPayment
              ?.enoughBalance,
          ),
        );

        setNeedsApproval(
          Boolean(
            remainingPayment
              ?.needsApproval,
          ),
        );

        setError("");

        if (!paidPaymentState) {
          setMessage("");
          return;
        }

        if (currentStatus === 8) {
          setMessage(
            "The remaining balance has been paid. This reservation is complete.",
          );

          return;
        }

        if (currentStatus === 9) {
          setMessage(
            "This reservation was marked as payment defaulted.",
          );

          return;
        }

        if (
          remainingPayment
            ?.paymentDeadlinePassed
        ) {
          setMessage(
            "The remaining-payment deadline has passed. Payment can no longer be completed.",
          );

          return;
        }

        if (
          !remainingPayment
            ?.enoughBalance
        ) {
          setMessage(
            `The remaining payment is ${
              remainingPayment
                ?.formatted ?? "0"
            } USDC. Current balance: ${
              remainingPayment
                ?.balanceFormatted ?? "0"
            } USDC.`,
          );

          return;
        }

        if (
          remainingPayment
            ?.needsApproval
        ) {
          setMessage(
            `Circle will first approve the ${remainingPayment.formatted} USDC remaining balance, then complete the payment.`,
          );

          return;
        }

        setMessage(
          `Ready to pay the remaining ${remainingPayment?.formatted ?? "0"} USDC.`,
        );
      } catch (
        statusError
      ) {
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

        setVisible(false);

        setError(
          getErrorMessage(
            statusError,
          ),
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

      setVisible(false);
      setReservationStatus(0);
      setRemainingFormatted("0");
      setPaymentDeadline("0");
      setPaymentWindowOpen(false);
      setPaymentDeadlinePassed(false);
      setEnoughBalance(false);
      setNeedsApproval(false);
      setMessage("");
      setError("");

      if (
        !walletReady ||
        !walletAddress
      ) {
        setWalletConnected(false);
        return;
      }

      setWalletConnected(true);

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
  }, [eventId]);

  async function handlePayment() {
    if (
      busy ||
      !walletConnected ||
      reservationStatus !== 7 ||
      !paymentWindowOpen ||
      paymentDeadlinePassed ||
      !enoughBalance
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
          "Connect the Circle wallet that owns this reservation.",
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
        "Checking the remaining-payment status...",
      );

      let status =
        await requestReservationStatus(
          eventId,
          walletAddress,
        );

      const payment =
        status.remainingPayment;

      if (
        status.eventType !== 1 ||
        status.reservation
          ?.status !== 7
      ) {
        throw new Error(
          "This reservation does not currently have a remaining payment due.",
        );
      }

      if (
        !payment
          ?.paymentWindowOpen ||
        payment
          .paymentDeadlinePassed
      ) {
        throw new Error(
          "The remaining-payment window has closed.",
        );
      }

      if (
        !payment.enoughBalance
      ) {
        throw new Error(
          `Insufficient USDC balance. The remaining payment is ${payment.formatted} USDC.`,
        );
      }

      setRemainingFormatted(
        payment.formatted,
      );

      setPaymentDeadline(
        payment.paymentDeadline,
      );

      if (
        payment.needsApproval
      ) {
        setMessage(
          `Preparing approval for the ${payment.formatted} USDC remaining balance...`,
        );

        const approvalResponse =
          await fetch(
            "/api/circle/usdc/approve-remaining-balance",
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
              "Unable to prepare the remaining-balance approval.",
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
            `Enter your Circle PIN to approve ${payment.formatted} USDC.`,
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
              currentStatus,
            ) =>
              Boolean(
                currentStatus
                  .remainingPayment
                  ?.enoughAllowance,
              ),
            "The USDC approval was submitted but has not been confirmed yet. Please try again shortly.",
          );
      }

      if (
        !status
          .remainingPayment
          ?.enoughAllowance
      ) {
        throw new Error(
          "The remaining-balance USDC approval has not been confirmed yet.",
        );
      }

      setMessage(
        "Preparing the remaining payment...",
      );

      const paymentResponse =
        await fetch(
          "/api/circle/events/pay-remaining-balance",
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

      const paymentData =
        (await paymentResponse.json()) as ChallengeResponse;

      if (
        !paymentResponse.ok ||
        !paymentData.challengeId
      ) {
        throw new Error(
          paymentData.error ??
            "Unable to prepare the remaining payment.",
        );
      }

      setMessage(
        `Enter your Circle PIN to pay the remaining ${remainingFormatted} USDC.`,
      );

      await executeCircleChallenge(
        paymentData.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage(
        "Waiting for the payment to be confirmed on Arc Testnet...",
      );

      await waitForStatus(
        eventId,
        walletAddress,
        (
          currentStatus,
        ) =>
          currentStatus
            .reservation
            ?.status === 8,
        "The payment was submitted but has not been confirmed yet. Refresh shortly.",
      );

      setReservationStatus(8);
      setPaymentWindowOpen(false);
      setNeedsApproval(false);

      setMessage(
        "Remaining balance paid successfully. Your reservation is now complete.",
      );

      onPaymentCompleted?.();
    } catch (
      paymentError
    ) {
      console.error(
        "ShowUp remaining payment failed:",
        paymentError,
      );

      setError(
        getErrorMessage(
          paymentError,
        ),
      );

      setMessage(
        "The remaining payment was not completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!visible) {
    return null;
  }

  if (
    reservationStatus === 8
  ) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] p-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">
          Payment completed
        </p>

        <p className="mt-2 text-sm leading-6 text-emerald-100/70">
          {message}
        </p>
      </div>
    );
  }

  if (
    reservationStatus === 9
  ) {
    return (
      <div className="mt-4 rounded-2xl border border-orange-300/20 bg-orange-300/[0.07] p-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-orange-200">
          Payment defaulted
        </p>

        <p className="mt-2 text-sm leading-6 text-orange-100/70">
          {message}
        </p>
      </div>
    );
  }

  const paymentDisabled =
    busy ||
    !paymentWindowOpen ||
    paymentDeadlinePassed ||
    !enoughBalance;

  return (
    <div className="mt-4 rounded-2xl border border-violet-300/20 bg-violet-300/[0.065] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-violet-200">
            Remaining payment due
          </p>

          <p className="mt-2 text-2xl font-semibold">
            {remainingFormatted}

            <span className="ml-2 text-sm text-white/40">
              USDC
            </span>
          </p>
        </div>

        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
          Payment due
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-white/45">
        Deadline:{" "}
        {formatTimestamp(
          paymentDeadline,
        )}
      </p>

      <button
        type="button"
        onClick={() => {
          void handlePayment();
        }}
        disabled={
          paymentDisabled
        }
        className="mt-4 w-full rounded-xl bg-violet-200 px-4 py-3 text-sm font-semibold text-[#140c1d] transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy
          ? "Processing payment..."
          : paymentDeadlinePassed
            ? "Payment deadline passed"
            : !enoughBalance
              ? "Insufficient USDC balance"
              : needsApproval
                ? `Approve and pay ${remainingFormatted} USDC`
                : `Pay ${remainingFormatted} USDC`}
      </button>

      <p
        aria-live="polite"
        className={`mt-3 text-center text-xs leading-5 ${
          error
            ? "text-red-300"
            : "text-white/40"
        }`}
      >
        {error || message}
      </p>
    </div>
  );
}
