"use client";

import Link from "next/link";
import {
  type FormEvent,
  useMemo,
  useState,
} from "react";
import CircleWalletButton from "@/components/circle-wallet-button";

const CIRCLE_USER_ID_KEY = "showup_circle_user_id";
const CIRCLE_WALLET_READY_KEY = "showup_circle_wallet_ready";
const CIRCLE_WALLET_ADDRESS_KEY =
  "showup_circle_wallet_address";
const CIRCLE_WALLET_ID_KEY = "showup_circle_wallet_id";
const EVENT_SUBMISSIONS_KEY = "showup_event_submissions";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#74f2c2]/60 focus:bg-[#74f2c2]/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

const labelClassName =
  "block text-sm font-medium text-white/75";

type SubmissionState =
  | "idle"
  | "preparing"
  | "awaiting"
  | "submitted"
  | "error";

type SessionResponse = {
  userId?: string;
  userToken?: string;
  encryptionKey?: string;
  error?: string;
};

type ChallengeResponse = {
  challengeId?: string;
  refId?: string;
  createdAfter?: string;
  error?: string;
};

type StoredSubmission = {
  refId: string;
  title: string;
  description: string;
  deposit: string;
  capacity: string;
  unlimited: boolean;
  eventStart: string;
  eventEnd: string;
  walletAddress: string;
  status: "submitted";
  createdAt: string;
};

function formatDate(value: string) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong while creating the event.";
}

async function requestCircleSession(
  userId: string,
): Promise<{
  userToken: string;
  encryptionKey: string;
}> {
  const response = await fetch("/api/circle/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      userId,
    }),
  });

  const data = (await response.json()) as SessionResponse;

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
    encryptionKey: data.encryptionKey,
  };
}

async function executeCircleChallenge(
  challengeId: string,
  userToken: string,
  encryptionKey: string,
) {
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

  if (!appId) {
    throw new Error("Circle App ID is not configured.");
  }

  const { W3SSdk } = await import(
    "@circle-fin/w3s-pw-web-sdk"
  );

  const circleSdk = new W3SSdk({
    appSettings: {
      appId,
    },
  });

  await circleSdk.getDeviceId();

  circleSdk.setAuthentication({
    userToken,
    encryptionKey,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(
        new Error(
          "Circle approval timed out. No transaction was submitted.",
        ),
      );
    }, 10 * 60 * 1000);

    circleSdk.execute(
      challengeId,
      (error, result) => {
        window.clearTimeout(timeout);

        if (error) {
          reject(
            new Error(
              error.message ||
                `Circle authorization failed${
                  error.code ? ` (${error.code})` : ""
                }.`,
            ),
          );

          return;
        }

        if (!result || result.status !== "COMPLETE") {
          reject(
            new Error(
              "Circle authorization was not completed.",
            ),
          );

          return;
        }

        resolve();
      },
    );
  });
}

function saveSubmission(submission: StoredSubmission) {
  let submissions: StoredSubmission[] = [];

  try {
    const stored = window.localStorage.getItem(
      EVENT_SUBMISSIONS_KEY,
    );

    if (stored) {
      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        submissions = parsed;
      }
    }
  } catch {
    submissions = [];
  }

  const updated = [
    submission,
    ...submissions.filter(
      (item) => item.refId !== submission.refId,
    ),
  ].slice(0, 50);

  window.localStorage.setItem(
    EVENT_SUBMISSIONS_KEY,
    JSON.stringify(updated),
  );
}

export default function CreateEventPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deposit, setDeposit] = useState("2");
  const [capacity, setCapacity] = useState("30");
  const [unlimitedCapacity, setUnlimitedCapacity] =
    useState(false);

  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [cancellationHours, setCancellationHours] =
    useState("24");

  const [resolutionHours, setResolutionHours] =
    useState("12");

  const [message, setMessage] = useState("");
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");

  const availableSeats = useMemo(() => {
    if (unlimitedCapacity) {
      return "Unlimited";
    }

    const parsedCapacity = Number(capacity);

    if (
      !Number.isSafeInteger(parsedCapacity) ||
      parsedCapacity < 1
    ) {
      return "0";
    }

    return String(parsedCapacity);
  }, [capacity, unlimitedCapacity]);

  const buttonLabel =
    submissionState === "preparing"
      ? "Preparing transaction..."
      : submissionState === "awaiting"
        ? "Waiting for Circle approval..."
        : submissionState === "submitted"
          ? "Event transaction submitted"
          : "Create event on Arc";

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      submissionState === "preparing" ||
      submissionState === "awaiting"
    ) {
      return;
    }

    setMessage("");
    setSubmissionState("preparing");

    try {
      const normalizedTitle = title.trim();
      const normalizedDescription = description.trim();

      if (
        !normalizedTitle ||
        !deposit ||
        !eventStart ||
        !eventEnd
      ) {
        throw new Error(
          "Complete all required fields before continuing.",
        );
      }

      if (!/^\d+(?:\.\d{1,6})?$/.test(deposit)) {
        throw new Error(
          "Deposit must be a valid USDC amount with up to 6 decimal places.",
        );
      }

      if (Number(deposit) <= 0) {
        throw new Error(
          "Commitment deposit must be greater than zero.",
        );
      }

      const normalizedCapacity = unlimitedCapacity
        ? "0"
        : capacity.trim();

      if (
        !unlimitedCapacity &&
        (!/^\d+$/.test(normalizedCapacity) ||
          Number(normalizedCapacity) < 1)
      ) {
        throw new Error(
          "Capacity must be a positive whole number.",
        );
      }

      const startDate = new Date(eventStart);
      const endDate = new Date(eventEnd);

      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        throw new Error(
          "Enter valid event start and end times.",
        );
      }

      if (endDate <= startDate) {
        throw new Error(
          "Event end must be later than event start.",
        );
      }

      const parsedCancellationHours =
        Number(cancellationHours);

      const parsedResolutionHours =
        Number(resolutionHours);

      if (
        !Number.isSafeInteger(parsedCancellationHours) ||
        parsedCancellationHours < 1
      ) {
        throw new Error(
          "Cancellation period must be a positive whole number.",
        );
      }

      if (
        !Number.isSafeInteger(parsedResolutionHours) ||
        parsedResolutionHours < 1 ||
        parsedResolutionHours > 168
      ) {
        throw new Error(
          "Resolution period must be between 1 and 168 hours.",
        );
      }

      const cancellationDeadline =
        startDate.getTime() -
        parsedCancellationHours * 60 * 60 * 1000;

      if (cancellationDeadline <= Date.now()) {
        throw new Error(
          "The cancellation deadline must still be in the future. Move the event later or shorten the cancellation period.",
        );
      }

      const circleUserId =
        window.localStorage.getItem(
          CIRCLE_USER_ID_KEY,
        ) ?? "";

      const walletReady =
        window.localStorage.getItem(
          CIRCLE_WALLET_READY_KEY,
        ) === "true";

      const walletId =
        window.localStorage.getItem(
          CIRCLE_WALLET_ID_KEY,
        ) ?? "";

      const walletAddress =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        ) ?? "";

      if (
        !circleUserId ||
        !walletReady ||
        !walletId ||
        !walletAddress
      ) {
        throw new Error(
          "Connect your Circle wallet before creating an event.",
        );
      }

      setMessage(
        "Creating a secure Circle transaction challenge...",
      );

      const session =
        await requestCircleSession(circleUserId);

      const challengeResponse = await fetch(
        "/api/circle/events/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            userToken: session.userToken,
            walletId,
            title: normalizedTitle,
            description: normalizedDescription,
            deposit,
            capacity: normalizedCapacity,
            eventStart: startDate.toISOString(),
            eventEnd: endDate.toISOString(),
            cancellationHours,
            resolutionHours,
          }),
        },
      );

      const challengeData =
        (await challengeResponse.json()) as ChallengeResponse;

      if (
        !challengeResponse.ok ||
        !challengeData.challengeId
      ) {
        throw new Error(
          challengeData.error ??
            "Unable to prepare the event transaction.",
        );
      }

      setSubmissionState("awaiting");
      setMessage(
        "Confirm the transaction with your Circle PIN.",
      );

      await executeCircleChallenge(
        challengeData.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      const refId =
        challengeData.refId ??
        `showup-event-${Date.now()}`;

      saveSubmission({
        refId,
        title: normalizedTitle,
        description: normalizedDescription,
        deposit,
        capacity: normalizedCapacity,
        unlimited: unlimitedCapacity,
        eventStart,
        eventEnd,
        walletAddress,
        status: "submitted",
        createdAt: new Date().toISOString(),
      });

      setSubmissionState("submitted");
      setMessage(
        `Circle authorization completed. Your event transaction was submitted to Arc Testnet. Reference: ${refId}`,
      );
    } catch (error) {
      console.error(
        "ShowUp event submission failed:",
        error,
      );

      setSubmissionState("error");
      setMessage(getErrorMessage(error));
    }
  }

  return (
    <main className="min-h-screen bg-[#07110f] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#74f2c2] text-lg font-black text-[#07110f]">
              S
            </div>

            <div>
              <p className="text-lg font-semibold tracking-tight">
                ShowUp
              </p>

              <p className="text-xs text-white/45">
                Built on Arc
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden rounded-full border border-white/10 px-5 py-2.5 text-sm text-white/65 transition hover:border-white/25 hover:text-white sm:block"
            >
              Back home
            </Link>

            <CircleWalletButton />
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-[#35d69e]/10 blur-[140px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-20">
          <div className="mb-12 max-w-3xl">
            <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-sm text-[#9dffda]">
              <span className="h-2 w-2 rounded-full bg-[#74f2c2]" />
              Live on Arc Testnet
            </div>

            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              Create an accountable event.
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/55">
              Publish transparent attendance rules and a
              refundable USDC commitment deposit directly on
              Arc.
            </p>
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <form
              onSubmit={handleSubmit}
              className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 sm:p-8"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-6">
                <div>
                  <h2 className="text-2xl font-semibold">
                    Event details
                  </h2>

                  <p className="mt-2 text-sm text-white/40">
                    These values will be written onchain.
                  </p>
                </div>

                <div className="rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-3 py-1.5 text-xs text-[#9dffda]">
                  Arc Testnet
                </div>
              </div>

              <div className="mt-7">
                <label className={labelClassName}>
                  Event title
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <input
                    value={title}
                    onChange={(event) =>
                      setTitle(event.target.value)
                    }
                    className={inputClassName}
                    placeholder="Arc Builders Workshop"
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="mt-6">
                <label className={labelClassName}>
                  Short description

                  <textarea
                    value={description}
                    onChange={(event) =>
                      setDescription(event.target.value)
                    }
                    className={`${inputClassName} min-h-28 resize-none`}
                    placeholder="Describe what attendees will experience."
                    maxLength={240}
                  />
                </label>

                <p className="mt-2 text-right text-xs text-white/30">
                  {description.length} / 240
                </p>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className={labelClassName}>
                  Commitment deposit
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <div className="relative">
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={deposit}
                      onChange={(event) =>
                        setDeposit(event.target.value)
                      }
                      className={`${inputClassName} pr-20`}
                    />

                    <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm font-medium text-[#74f2c2]">
                      USDC
                    </span>
                  </div>
                </label>

                <div>
                  <label className={labelClassName}>
                    Event capacity
                    <span className="ml-1 text-[#74f2c2]">
                      *
                    </span>

                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={capacity}
                      disabled={unlimitedCapacity}
                      onChange={(event) =>
                        setCapacity(event.target.value)
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-white/55">
                    <input
                      type="checkbox"
                      checked={unlimitedCapacity}
                      onChange={(event) =>
                        setUnlimitedCapacity(
                          event.target.checked,
                        )
                      }
                      className="h-4 w-4 accent-[#74f2c2]"
                    />

                    Unlimited capacity
                  </label>
                </div>
              </div>

              <div className="mt-8 border-t border-white/10 pt-7">
                <h3 className="text-lg font-semibold">
                  Event timeline
                </h3>

                <p className="mt-2 text-sm text-white/40">
                  All deadlines are converted into onchain Unix
                  timestamps.
                </p>

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <label className={labelClassName}>
                    Event start
                    <span className="ml-1 text-[#74f2c2]">
                      *
                    </span>

                    <input
                      type="datetime-local"
                      value={eventStart}
                      onChange={(event) =>
                        setEventStart(event.target.value)
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label className={labelClassName}>
                    Event end
                    <span className="ml-1 text-[#74f2c2]">
                      *
                    </span>

                    <input
                      type="datetime-local"
                      value={eventEnd}
                      onChange={(event) =>
                        setEventEnd(event.target.value)
                      }
                      className={inputClassName}
                    />
                  </label>
                </div>

                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <label className={labelClassName}>
                    Free cancellation period

                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={cancellationHours}
                        onChange={(event) =>
                          setCancellationHours(
                            event.target.value,
                          )
                        }
                        className={`${inputClassName} pr-20`}
                      />

                      <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm text-white/35">
                        hours
                      </span>
                    </div>

                    <span className="mt-2 block text-xs font-normal leading-5 text-white/30">
                      Cancellation closes this many hours before
                      the event.
                    </span>
                  </label>

                  <label className={labelClassName}>
                    Organizer resolution period

                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="168"
                        step="1"
                        value={resolutionHours}
                        onChange={(event) =>
                          setResolutionHours(
                            event.target.value,
                          )
                        }
                        className={`${inputClassName} pr-20`}
                      />

                      <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm text-white/35">
                        hours
                      </span>
                    </div>

                    <span className="mt-2 block text-xs font-normal leading-5 text-white/30">
                      Unresolved reservations can claim a fallback
                      refund after this period.
                    </span>
                  </label>
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                <p className="text-sm leading-6 text-[#c7ffea]">
                  Creating an event does not lock a deposit.
                  Deposits enter escrow only when attendees reserve
                  seats.
                </p>
              </div>

              {message ? (
                <div
                  className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-6 ${
                    submissionState === "error"
                      ? "border-red-400/20 bg-red-400/10 text-red-200"
                      : submissionState === "submitted"
                        ? "border-[#74f2c2]/30 bg-[#74f2c2]/10 text-[#c7ffea]"
                        : "border-white/10 bg-white/[0.04] text-white/65"
                  }`}
                >
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={
                  submissionState === "preparing" ||
                  submissionState === "awaiting"
                }
                className="mt-6 w-full rounded-2xl bg-[#74f2c2] py-4 font-semibold text-[#07110f] transition hover:bg-[#9dffda] disabled:cursor-wait disabled:opacity-60"
              >
                {buttonLabel}
              </button>

              <p className="mt-4 text-center text-xs text-white/30">
                No transaction is sent until you approve it inside
                Circle&apos;s secure PIN window.
              </p>
            </form>

            <aside className="lg:sticky lg:top-8">
              <div className="rounded-[30px] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/30">
                <div className="rounded-[24px] border border-white/10 bg-[#0b1916] p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#74f2c2]">
                        Live preview
                      </p>

                      <h2 className="mt-3 break-words text-2xl font-semibold">
                        {title.trim() || "Untitled event"}
                      </h2>

                      <p className="mt-2 break-words text-sm leading-6 text-white/45">
                        {description.trim() ||
                          "Your event description will appear here."}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-2xl bg-[#74f2c2] px-3 py-2 text-center text-[#07110f]">
                      <p className="text-xs font-semibold uppercase">
                        {eventStart
                          ? new Date(
                              eventStart,
                            ).toLocaleString(undefined, {
                              month: "short",
                            })
                          : "DATE"}
                      </p>

                      <p className="text-xl font-black">
                        {eventStart
                          ? new Date(eventStart).getDate()
                          : "--"}
                      </p>
                    </div>
                  </div>

                  <div className="my-6 h-px bg-white/10" />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        Commitment deposit
                      </p>

                      <p className="mt-2 text-xl font-semibold">
                        {deposit || "0"} USDC
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        Available seats
                      </p>

                      <p className="mt-2 break-words text-xl font-semibold">
                        {availableSeats}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                    <div>
                      <p className="text-xs text-white/30">
                        Starts
                      </p>

                      <p className="mt-1 text-sm font-medium text-white/70">
                        {formatDate(eventStart)}
                      </p>
                    </div>

                    <div className="h-px bg-white/10" />

                    <div>
                      <p className="text-xs text-white/30">
                        Ends
                      </p>

                      <p className="mt-1 text-sm font-medium text-white/70">
                        {formatDate(eventEnd)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                    <p className="text-sm font-medium leading-6 text-[#b7ffe3]">
                      Attend or cancel on time and the full
                      commitment deposit returns.
                    </p>
                  </div>

                  <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                    <p className="text-xs text-white/30">
                      ShowUp contract
                    </p>

                    <p className="mt-1 break-all font-mono text-xs leading-5 text-white/55">
                      0x0506cF7B5408C046F0f693a52394F481C0922B2D
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
