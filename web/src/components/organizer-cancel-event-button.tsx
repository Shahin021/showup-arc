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

type OrganizerCancelEventButtonProps = {
  eventId: string;
  organizer: string;
  eventStart: string;
};

type SessionResponse = {
  userToken?: string;
  encryptionKey?: string;
  error?: string;
};

type ChallengeResponse = {
  challengeId?: string;
  error?: string;
};

type EventsResponse = {
  events?: Array<{
    id: string;
    cancelled: boolean;
  }>;
  error?: string;
};

type ConnectedOrganizerWallet = {
  circleUserId: string;
  walletId: string;
  walletAddress: string;
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

function getErrorMessage(
  error: unknown,
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "Unable to cancel this event.";
}

function getConnectedOrganizerWallet(
  organizer: string,
): ConnectedOrganizerWallet {
  const circleUserId =
    window.localStorage
      .getItem(
        CIRCLE_USER_ID_KEY,
      )
      ?.trim() ?? "";

  const walletReady =
    window.localStorage.getItem(
      CIRCLE_WALLET_READY_KEY,
    ) === "true";

  const walletAddress =
    window.localStorage
      .getItem(
        CIRCLE_WALLET_ADDRESS_KEY,
      )
      ?.trim() ?? "";

  const walletId =
    window.localStorage
      .getItem(
        CIRCLE_WALLET_ID_KEY,
      )
      ?.trim() ?? "";

  if (
    !circleUserId ||
    !walletReady ||
    !walletAddress ||
    !walletId
  ) {
    throw new Error(
      "Connect the organizer Circle wallet first.",
    );
  }

  if (
    walletAddress.toLowerCase() !==
    organizer.toLowerCase()
  ) {
    throw new Error(
      "Only the organizer wallet can cancel this event.",
    );
  }

  return {
    circleUserId,
    walletId,
    walletAddress,
  };
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

async function requestCancelChallenge(
  input: {
    userToken: string;
    walletId: string;
    eventId: string;
  },
) {
  const response =
    await fetch(
      "/api/circle/events/cancel-event",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          userToken:
            input.userToken,
          walletId:
            input.walletId,
          eventId:
            input.eventId,
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
        "Unable to prepare event cancellation.",
    );
  }

  return data.challengeId;
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

async function readCancellationState(
  eventId: string,
) {
  const response =
    await fetch(
      `/api/events?fresh=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

  const data =
    (await response.json()) as EventsResponse;

  if (!response.ok) {
    throw new Error(
      data.error ??
        "Unable to refresh the event.",
    );
  }

  const event =
    data.events?.find(
      (item) =>
        item.id === eventId,
    );

  return Boolean(
    event?.cancelled,
  );
}

export default function OrganizerCancelEventButton({
  eventId,
  organizer,
  eventStart,
}: OrganizerCancelEventButtonProps) {
  const [
    confirmationOpen,
    setConfirmationOpen,
  ] = useState(false);

  const [
    cancelling,
    setCancelling,
  ] = useState(false);

  const [
    cancelled,
    setCancelled,
  ] = useState(false);

  const [
    checkingState,
    setCheckingState,
  ] = useState(true);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  const eventStartSeconds =
    Number(eventStart);

  const eventHasStarted =
    Number.isFinite(
      eventStartSeconds,
    ) &&
    eventStartSeconds > 0 &&
    Date.now() >=
      eventStartSeconds * 1000;

  useEffect(() => {
    let active = true;

    async function loadState() {
      try {
        const isCancelled =
          await readCancellationState(
            eventId,
          );

        if (active) {
          setCancelled(
            isCancelled,
          );
        }
      } catch {
        // The cancellation API performs the authoritative checks.
      } finally {
        if (active) {
          setCheckingState(false);
        }
      }
    }

    void loadState();

    return () => {
      active = false;
    };
  }, [eventId]);

  async function handleCancelEvent() {
    if (cancelling) {
      return;
    }

    setCancelling(true);
    setError("");
    setMessage(
      "Creating a secure Circle session...",
    );

    try {
      if (eventHasStarted) {
        throw new Error(
          "The event cannot be cancelled after it has started.",
        );
      }

      const connectedWallet =
        getConnectedOrganizerWallet(
          organizer,
        );

      const session =
        await requestCircleSession(
          connectedWallet.circleUserId,
        );

      setMessage(
        "Preparing the cancellation transaction...",
      );

      const challengeId =
        await requestCancelChallenge({
          userToken:
            session.userToken,
          walletId:
            connectedWallet.walletId,
          eventId,
        });

      setMessage(
        "Approve the cancellation with your Circle PIN.",
      );

      await executeCircleChallenge(
        challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage(
        "Cancellation submitted. Waiting for Arc Testnet confirmation...",
      );

      let confirmed = false;

      for (
        let attempt = 0;
        attempt < 45;
        attempt += 1
      ) {
        try {
          const isCancelled =
            await readCancellationState(
              eventId,
            );

          if (isCancelled) {
            confirmed = true;
            break;
          }
        } catch {
          // Retry while the transaction is being confirmed.
        }

        await wait(2000);
      }

      if (!confirmed) {
        throw new Error(
          "The transaction was submitted, but cancellation has not been confirmed yet. Refresh shortly.",
        );
      }

      setCancelled(true);
      setConfirmationOpen(false);

      setMessage(
        "Event cancelled successfully. Attendees can now claim their USDC refunds from their own wallets.",
      );

      window.dispatchEvent(
        new CustomEvent(
          "showup-event-cancelled",
          {
            detail: {
              eventId,
            },
          },
        ),
      );

      window.setTimeout(
        () => {
          window.location.reload();
        },
        1500,
      );
    } catch (
      cancellationError
    ) {
      console.error(
        "ShowUp event cancellation failed:",
        cancellationError,
      );

      setError(
        getErrorMessage(
          cancellationError,
        ),
      );

      setMessage("");
    } finally {
      setCancelling(false);
    }
  }

  if (checkingState) {
    return null;
  }

  if (cancelled) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-4">
        <p className="text-sm font-semibold text-emerald-100">
          Event cancelled
        </p>

        <p className="mt-2 text-xs leading-5 text-emerald-100/65">
          Attendees can now connect their original payment wallets and claim their USDC refunds.
        </p>

        {message ? (
          <p className="mt-3 text-xs leading-5 text-emerald-100/75">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  if (eventHasStarted) {
    return (
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-xs leading-5 text-white/40">
        This event has already started and can no longer be cancelled.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-red-300/15 bg-red-300/[0.045] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-red-100">
            Cancel event
          </p>

          <p className="mt-1 text-xs leading-5 text-red-100/55">
            Cancelling is permanent. Each attendee will need to claim their refund using the wallet that paid.
          </p>
        </div>

        {!confirmationOpen ? (
          <button
            type="button"
            onClick={() => {
              setError("");
              setMessage("");
              setConfirmationOpen(
                true,
              );
            }}
            disabled={cancelling}
            className="shrink-0 rounded-xl border border-red-300/25 bg-red-300/10 px-4 py-2.5 text-xs font-semibold text-red-100 transition hover:border-red-300/40 hover:bg-red-300/15 disabled:cursor-wait disabled:opacity-50"
          >
            Cancel event
          </button>
        ) : null}
      </div>

      {confirmationOpen ? (
        <div className="mt-4 rounded-xl border border-red-300/20 bg-black/15 p-4">
          <p className="text-sm font-medium text-red-100">
            Are you sure you want to cancel this event?
          </p>

          <p className="mt-2 text-xs leading-5 text-red-100/55">
            This action cannot be reversed. The contract will unlock cancelled-event refund claims for active attendees.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setConfirmationOpen(
                  false,
                );
                setError("");
                setMessage("");
              }}
              disabled={cancelling}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-white/60 transition hover:border-white/20 hover:bg-white/[0.04] disabled:cursor-wait disabled:opacity-50"
            >
              Keep event
            </button>

            <button
              type="button"
              onClick={() => {
                void handleCancelEvent();
              }}
              disabled={cancelling}
              className="rounded-xl bg-red-300 px-4 py-2.5 text-xs font-semibold text-[#210707] transition hover:bg-red-200 disabled:cursor-wait disabled:opacity-50"
            >
              {cancelling
                ? "Cancelling..."
                : "Confirm cancellation"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs leading-5 text-red-100/80">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-100/80">
          {message}
        </div>
      ) : null}
    </div>
  );
}
