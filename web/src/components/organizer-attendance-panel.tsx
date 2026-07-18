"use client";

import {
  useCallback,
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
  error?: string;
};

type AttendeeDetails = {
  attendee: string;
  status: number;
  label: string;
  reservedAt: string;
  updatedAt: string;
  active: boolean;
  attended: boolean;
};

type AttendeesResponse = {
  organizer?: string;

  deposit?: {
    amount: string;
    formatted: string;
  };

  timing?: {
    eventStart: string;
    eventEnd: string;
    resolutionDeadline: string;
    attendanceWindowOpen: boolean;
  };

  attendeeCount?: string;
  attendees?: AttendeeDetails[];
  error?: string;
};

type OrganizerAttendancePanelProps = {
  eventId: string;
  organizer: string;
  depositFormatted: string;
  eventStart: string;
  resolutionDeadline: string;
  onAttendanceConfirmed?: (
    attendee: string,
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

function shortenAddress(
  address: string,
) {
  if (address.length <= 14) {
    return address;
  }

  return `${address.slice(
    0,
    6,
  )}...${address.slice(-4)}`;
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

  return "Unable to confirm attendance.";
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
    (await response
      .json()) as SessionResponse;

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
            "Circle attendance challenge result:",
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

async function requestAttendees(
  eventId: string,
) {
  const response = await fetch(
    `/api/events/${encodeURIComponent(
      eventId,
    )}/attendees`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  const data =
    (await response
      .json()) as AttendeesResponse;

  if (!response.ok) {
    throw new Error(
      data.error ??
        "Unable to load attendees.",
    );
  }

  return data;
}

export default function OrganizerAttendancePanel({
  eventId,
  organizer,
  depositFormatted,
  eventStart,
  resolutionDeadline,
  onAttendanceConfirmed,
}: OrganizerAttendancePanelProps) {
  const [isOrganizer, setIsOrganizer] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [busyAttendee, setBusyAttendee] =
    useState("");

  const [attendees, setAttendees] =
    useState<AttendeeDetails[]>([]);

  const [
    attendanceWindowOpen,
    setAttendanceWindowOpen,
  ] = useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const loadAttendees =
    useCallback(async () => {
      setLoading(true);
      setError("");

      try {
        const data =
          await requestAttendees(
            eventId,
          );

        setAttendees(
          data.attendees ?? [],
        );

        setAttendanceWindowOpen(
          Boolean(
            data.timing
              ?.attendanceWindowOpen,
          ),
        );
      } catch (loadError) {
        setError(
          getErrorMessage(
            loadError,
          ),
        );
      } finally {
        setLoading(false);
      }
    }, [eventId]);

  useEffect(() => {
    function refreshOrganizerState() {
      const walletReady =
        window.localStorage.getItem(
          CIRCLE_WALLET_READY_KEY,
        ) === "true";

      const walletAddress =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        ) ?? "";

      const organizerConnected =
        walletReady &&
        walletAddress.toLowerCase() ===
          organizer.toLowerCase();

      setIsOrganizer(
        organizerConnected,
      );

      setError("");
      setMessage("");

      if (organizerConnected) {
        void loadAttendees();
      } else {
        setAttendees([]);
        setBusyAttendee("");
      }
    }

    refreshOrganizerState();

    window.addEventListener(
      CIRCLE_WALLET_CHANGED_EVENT,
      refreshOrganizerState,
    );

    return () => {
      window.removeEventListener(
        CIRCLE_WALLET_CHANGED_EVENT,
        refreshOrganizerState,
      );
    };
  }, [
    organizer,
    loadAttendees,
  ]);

  async function handleConfirmAttendance(
    attendee: string,
  ) {
    if (busyAttendee) {
      return;
    }

    setBusyAttendee(
      attendee,
    );

    setError("");
    setMessage(
      "Creating a secure Circle session...",
    );

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
          "Connect the organizer Circle wallet first.",
        );
      }

      if (
        walletAddress.toLowerCase() !==
        organizer.toLowerCase()
      ) {
        throw new Error(
          "Only the organizer wallet can confirm attendance.",
        );
      }

      const session =
        await requestCircleSession(
          circleUserId,
        );

      setMessage(
        "Preparing attendance confirmation...",
      );

      const response = await fetch(
        "/api/circle/events/confirm-attendance",
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
            attendee,
          }),
        },
      );

      const data =
        (await response
          .json()) as ChallengeResponse;

      if (
        !response.ok ||
        !data.challengeId
      ) {
        throw new Error(
          data.error ??
            "Unable to prepare attendance confirmation.",
        );
      }

      setMessage(
        `Enter your Circle PIN to confirm ${shortenAddress(
          attendee,
        )}. Their ${depositFormatted} USDC deposit will be refunded.`,
      );

      await executeCircleChallenge(
        data.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage(
        "Waiting for attendance confirmation on Arc Testnet...",
      );

      let confirmed = false;

      for (
        let attempt = 0;
        attempt < 45;
        attempt += 1
      ) {
        const currentData =
          await requestAttendees(
            eventId,
          );

        const currentAttendees =
          currentData.attendees ??
          [];

        const updatedAttendee =
          currentAttendees.find(
            (item) =>
              item.attendee.toLowerCase() ===
              attendee.toLowerCase(),
          );

        setAttendees(
          currentAttendees,
        );

        setAttendanceWindowOpen(
          Boolean(
            currentData.timing
              ?.attendanceWindowOpen,
          ),
        );

        if (
          updatedAttendee
            ?.attended
        ) {
          confirmed = true;
          break;
        }

        await wait(2000);
      }

      if (!confirmed) {
        throw new Error(
          "The transaction was submitted but attendance has not been confirmed yet. Refresh shortly.",
        );
      }

      setMessage(
        `Attendance confirmed. ${depositFormatted} USDC was returned to ${shortenAddress(
          attendee,
        )}.`,
      );

      onAttendanceConfirmed?.(
        attendee,
      );
    } catch (confirmError) {
      console.error(
        "ShowUp attendance confirmation failed:",
        confirmError,
      );

      setError(
        getErrorMessage(
          confirmError,
        ),
      );

      setMessage("");
    } finally {
      setBusyAttendee("");
    }
  }

  if (!isOrganizer) {
    return null;
  }

  return (
    <section className="mt-6 rounded-3xl border border-[#74f2c2]/15 bg-[#0b1916]/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#74f2c2]">
            Organizer controls
          </p>

          <h3 className="mt-2 text-xl font-semibold text-white">
            Attendance check-in
          </h3>

          <p className="mt-2 max-w-xl text-sm leading-6 text-white/45">
            Confirm attendance to return each attendee&apos;s{" "}
            {depositFormatted} USDC commitment deposit.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadAttendees();
          }}
          disabled={
            loading ||
            Boolean(
              busyAttendee,
            )
          }
          className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/55 transition hover:border-[#74f2c2]/25 hover:bg-[#74f2c2]/10 hover:text-[#b7ffe3] disabled:cursor-wait disabled:opacity-50"
        >
          {loading
            ? "Refreshing..."
            : "Refresh"}
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-xs leading-5 text-white/45">
        {attendanceWindowOpen ? (
          <span className="text-[#aaffdc]">
            Check-in is open until{" "}
            {formatTimestamp(
              resolutionDeadline,
            )}
            .
          </span>
        ) : (
          <span>
            Check-in is available from{" "}
            {formatTimestamp(
              eventStart,
            )}{" "}
            until{" "}
            {formatTimestamp(
              resolutionDeadline,
            )}
            .
          </span>
        )}
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-400/15 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 rounded-2xl border border-[#74f2c2]/15 bg-[#74f2c2]/[0.07] px-4 py-3 text-sm text-[#b7ffe3]">
          {message}
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        {loading &&
        attendees.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-white/40">
            Loading attendees...
          </div>
        ) : null}

        {!loading &&
        attendees.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-sm text-white/40">
            No attendee wallets have reserved this event yet.
          </div>
        ) : null}

        {attendees.map(
          (attendee) => {
            const processing =
              busyAttendee.toLowerCase() ===
              attendee.attendee.toLowerCase();

            return (
              <div
                key={
                  attendee.attendee
                }
                className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm text-white/70">
                    {
                      attendee.attendee
                    }
                  </p>

                  <p className="mt-2 text-xs text-white/35">
                    Reserved{" "}
                    {formatTimestamp(
                      attendee.reservedAt,
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      attendee.status ===
                      3
                        ? "bg-[#74f2c2]/10 text-[#aaffdc]"
                        : attendee.status ===
                            1
                          ? "bg-amber-300/10 text-amber-100"
                          : "bg-white/[0.06] text-white/40"
                    }`}
                  >
                    {
                      attendee.label
                    }
                  </span>

                  {attendee.active ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleConfirmAttendance(
                          attendee.attendee,
                        );
                      }}
                      disabled={
                        !attendanceWindowOpen ||
                        Boolean(
                          busyAttendee,
                        )
                      }
                      className="rounded-xl bg-[#74f2c2] px-4 py-2.5 text-xs font-semibold text-[#07110f] transition hover:bg-[#8ff6cf] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {processing
                        ? "Confirming..."
                        : "Confirm attendance"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          },
        )}
      </div>
    </section>
  );
}
