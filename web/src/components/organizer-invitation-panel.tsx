"use client";

import {
  type FormEvent,
  useEffect,
  useState,
} from "react";

import {
  getAddress,
  isAddress,
} from "viem";

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

type InvitationPayload = {
  eventId: string;
  attendee: string;
  nonce: string;
  expiry: string;
};

type SignedInvitation = InvitationPayload & {
  signature: string;
};

type SignResponse = {
  challengeId?: string;
  invitation?: InvitationPayload;
  error?: string;
};

type ResultResponse = {
  completed?: boolean;
  status?: string;
  invitePath?: string;
  invitation?: SignedInvitation;
  error?: string;
};

type CompletedResult = ResultResponse & {
  completed: true;
  invitePath: string;
  invitation: SignedInvitation;
};

type PanelState =
  | "idle"
  | "preparing"
  | "awaiting"
  | "checking"
  | "ready"
  | "error";

type OrganizerInvitationPanelProps = {
  eventId: string;
  organizer: string;
  eventStart: string;
  accessMode: number;
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

  return "Unable to create the invitation.";
}

function shortenAddress(
  address: string,
) {
  if (address.length < 12) {
    return address;
  }

  return `${address.slice(
    0,
    6,
  )}...${address.slice(-4)}`;
}

function formatExpiry(
  expiry: string,
) {
  const seconds =
    Number(expiry);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "Unknown";
  }

  return new Date(
    seconds * 1000,
  ).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function getCircleSession(
  userId: string,
) {
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

async function executeChallenge(
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

  const sdk =
    new W3SSdk({
      appSettings: {
        appId,
      },
    });

  await sdk.getDeviceId();

  sdk.setAuthentication({
    userToken,
    encryptionKey,
  });

  return await new Promise<string>(
    (resolve, reject) => {
      const timeout =
        window.setTimeout(
          () => {
            reject(
              new Error(
                "Circle authorization timed out.",
              ),
            );
          },
          10 * 60 * 1000,
        );

      sdk.execute(
        challengeId,
        (error, result) => {
          window.clearTimeout(
            timeout,
          );

          if (error) {
            reject(
              new Error(
                error.message ||
                  "Circle authorization failed.",
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

          const signatureResult =
            result as typeof result & {
              data?: {
                signature?: unknown;
              };
            };

          const signatureValue =
            signatureResult
              .data
              ?.signature;

          const signature =
            typeof signatureValue ===
              "string"
              ? signatureValue.trim()
              : "";

          if (!signature) {
            reject(
              new Error(
                "Circle completed the authorization but did not return the callback signature.",
              ),
            );

            return;
          }

          resolve(
            signature,
          );
        },
      );
    },
  );
}

async function getInvitationResult(
  userToken: string,
  challengeId: string,
  invitation: InvitationPayload,
  circleSignature: string,
) {
  const response =
    await fetch(
      "/api/circle/invitations/result",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          userToken,
          challengeId,
          eventId:
            invitation.eventId,
          attendee:
            invitation.attendee,
          nonce:
            invitation.nonce,
          expiry:
            invitation.expiry,
          signature:
            circleSignature,
        }),
      },
    );

  const data =
    (await response.json()) as ResultResponse;

  if (
    !response.ok &&
    response.status !== 202
  ) {
    throw new Error(
      data.error ??
        "Unable to retrieve the invitation signature.",
    );
  }

  return data;
}

async function waitForResult(
  userToken: string,
  challengeId: string,
  invitation: InvitationPayload,
  circleSignature: string,
): Promise<CompletedResult> {
  for (
    let attempt = 0;
    attempt < 45;
    attempt += 1
  ) {
    const result =
      await getInvitationResult(
        userToken,
        challengeId,
        invitation,
        circleSignature,
      );

    if (
      result.completed === true &&
      result.invitePath &&
      result.invitation
    ) {
      return result as CompletedResult;
    }

    await wait(2000);
  }

  throw new Error(
    "Circle has not returned the final invitation signature yet.",
  );
}

async function copyText(
  value: string,
) {
  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(
      value,
    );

    return;
  }

  const textarea =
    document.createElement(
      "textarea",
    );

  textarea.value = value;
  textarea.style.position =
    "fixed";
  textarea.style.opacity =
    "0";

  document.body.appendChild(
    textarea,
  );

  textarea.focus();
  textarea.select();

  const copied =
    document.execCommand(
      "copy",
    );

  document.body.removeChild(
    textarea,
  );

  if (!copied) {
    throw new Error(
      "Unable to copy the invitation link.",
    );
  }
}

export default function OrganizerInvitationPanel({
  eventId,
  organizer,
  eventStart,
  accessMode,
}: OrganizerInvitationPanelProps) {
  const [
    connectedAddress,
    setConnectedAddress,
  ] = useState("");

  const [
    attendeeAddress,
    setAttendeeAddress,
  ] = useState("");

  const [
    expiryHours,
    setExpiryHours,
  ] = useState("72");

  const [
    panelState,
    setPanelState,
  ] = useState<PanelState>(
    "idle",
  );

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    inviteUrl,
    setInviteUrl,
  ] = useState("");

  const [
    invitation,
    setInvitation,
  ] =
    useState<SignedInvitation | null>(
      null,
    );

  useEffect(() => {
    function syncWallet() {
      const ready =
        window.localStorage.getItem(
          CIRCLE_WALLET_READY_KEY,
        );

      const address =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        );

      setConnectedAddress(
        ready === "true" &&
        address
          ? address
          : "",
      );
    }

    syncWallet();

    window.addEventListener(
      "storage",
      syncWallet,
    );

    window.addEventListener(
      CIRCLE_WALLET_CHANGED_EVENT,
      syncWallet,
    );

    return () => {
      window.removeEventListener(
        "storage",
        syncWallet,
      );

      window.removeEventListener(
        CIRCLE_WALLET_CHANGED_EVENT,
        syncWallet,
      );
    };
  }, []);

  const isOrganizer =
    Boolean(
      connectedAddress &&
      organizer &&
      connectedAddress.toLowerCase() ===
        organizer.toLowerCase(),
    );

  const [
    eventStarted,
    setEventStarted,
  ] = useState(false);

  useEffect(() => {
    function refreshStartState() {
      const startSeconds =
        Number(eventStart);

      setEventStarted(
        Number.isFinite(
          startSeconds,
        ) &&
          startSeconds > 0 &&
          Date.now() >=
            startSeconds * 1000,
      );
    }

    const timeoutId =
      window.setTimeout(
        refreshStartState,
        0,
      );

    const intervalId =
      window.setInterval(
        refreshStartState,
        1_000,
      );

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [eventStart]);

  const busy =
    panelState ===
      "preparing" ||
    panelState ===
      "awaiting" ||
    panelState ===
      "checking";

  if (
    accessMode !== 1 ||
    !isOrganizer
  ) {
    return null;
  }

  async function handleSubmit(
    submitEvent: FormEvent<HTMLFormElement>,
  ) {
    submitEvent.preventDefault();

    if (busy) {
      return;
    }

    setMessage("");
    setInviteUrl("");
    setInvitation(null);

    try {
      const normalizedAttendee =
        attendeeAddress.trim();

      if (
        !isAddress(
          normalizedAttendee,
        )
      ) {
        throw new Error(
          "Enter a valid invited wallet address.",
        );
      }

      const attendee =
        getAddress(
          normalizedAttendee,
        );

      if (
        attendee.toLowerCase() ===
        organizer.toLowerCase()
      ) {
        throw new Error(
          "The organizer cannot invite their own wallet.",
        );
      }

      if (
        !/^\d+$/.test(
          expiryHours,
        )
      ) {
        throw new Error(
          "Invitation validity must be a whole number of hours.",
        );
      }

      const parsedHours =
        Number(expiryHours);

      if (
        !Number.isSafeInteger(
          parsedHours,
        ) ||
        parsedHours < 1 ||
        parsedHours > 720
      ) {
        throw new Error(
          "Invitation validity must be between 1 and 720 hours.",
        );
      }

      const userId =
        window.localStorage.getItem(
          CIRCLE_USER_ID_KEY,
        );

      const walletId =
        window.localStorage.getItem(
          CIRCLE_WALLET_ID_KEY,
        );

      const walletAddress =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        );

      if (
        !userId ||
        !walletId ||
        !walletAddress
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
          "Connect the organizer wallet for this event.",
        );
      }

      setPanelState(
        "preparing",
      );

      setMessage(
        "Preparing the invitation signature...",
      );

      const session =
        await getCircleSession(
          userId,
        );

      const response =
        await fetch(
          "/api/circle/invitations/sign",
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
              organizerAddress:
                walletAddress,
              eventId,
              attendee,
              expiryHours:
                parsedHours,
            }),
          },
        );

      const data =
        (await response.json()) as SignResponse;

      if (
        !response.ok ||
        !data.challengeId ||
        !data.invitation
      ) {
        throw new Error(
          data.error ??
            "Unable to prepare the invitation signature.",
        );
      }

      setPanelState(
        "awaiting",
      );

      setMessage(
        "Confirm the invitation with your Circle PIN.",
      );

      const circleSignature =
        await executeChallenge(
          data.challengeId,
          session.userToken,
          session.encryptionKey,
        );

      setPanelState(
        "checking",
      );

      setMessage(
        "Verifying the organizer signature...",
      );

      const result =
        await waitForResult(
          session.userToken,
          data.challengeId,
          data.invitation,
          circleSignature,
        );

      const absoluteUrl =
        new URL(
          result.invitePath,
          window.location.origin,
        ).toString();

      setInviteUrl(
        absoluteUrl,
      );

      setInvitation(
        result.invitation,
      );

      setPanelState(
        "ready",
      );

      setMessage(
        "Invitation created successfully.",
      );
    } catch (error) {
      console.error(
        "Invitation creation failed:",
        error,
      );

      setPanelState(
        "error",
      );

      setMessage(
        getErrorMessage(error),
      );
    }
  }

  async function handleCopy() {
    if (!inviteUrl) {
      return;
    }

    try {
      await copyText(
        inviteUrl,
      );

      setMessage(
        "Invitation link copied.",
      );
    } catch (error) {
      setMessage(
        getErrorMessage(error),
      );
    }
  }

  return (
    <section className="rounded-[30px] border border-[#79b7ff]/16 bg-[#0b1025] p-6 shadow-xl shadow-[#267cff]/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#73d8ff]/70">
            Organizer tools
          </p>

          <h2 className="mt-2 text-xl font-semibold">
            Private invitations
          </h2>
        </div>

        <span className="rounded-full border border-[#9285ff]/30 bg-[#9285ff]/10 px-3 py-1 text-xs text-[#c9c2ff]">
          Invite-only
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-white/45">
        Each invitation is assigned to one wallet. Another wallet
        cannot use the same link.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-5"
      >
        <label className="block text-sm font-medium text-white/70">
          Invited wallet address

          <input
            type="text"
            value={
              attendeeAddress
            }
            disabled={
              busy ||
              eventStarted
            }
            onChange={(event) =>
              setAttendeeAddress(
                event.target.value,
              )
            }
            placeholder="0x..."
            className="mt-2 w-full rounded-2xl border border-[#79b7ff]/12 bg-[#0d142b] px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-white/20 focus:border-[#73d8ff]/50 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </label>

        <label className="block text-sm font-medium text-white/70">
          Invitation validity

          <div className="relative mt-2">
            <input
              type="number"
              min="1"
              max="720"
              step="1"
              value={
                expiryHours
              }
              disabled={
                busy ||
                eventStarted
              }
              onChange={(event) =>
                setExpiryHours(
                  event.target.value,
                )
              }
              className="w-full rounded-2xl border border-[#79b7ff]/12 bg-[#0d142b] px-4 py-3 pr-20 text-sm text-white outline-none transition focus:border-[#73d8ff]/50 disabled:cursor-not-allowed disabled:opacity-40"
            />

            <span className="pointer-events-none absolute right-4 top-3 text-sm text-white/30">
              hours
            </span>
          </div>
        </label>

        <button
          type="submit"
          disabled={
            busy ||
            eventStarted
          }
          className="w-full rounded-2xl bg-gradient-to-r from-[#73d8ff] to-[#8195ff] px-5 py-3.5 font-semibold text-[#050817] shadow-lg shadow-[#267cff]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {panelState ===
          "preparing"
            ? "Preparing invitation..."
            : panelState ===
                "awaiting"
              ? "Waiting for Circle PIN..."
              : panelState ===
                  "checking"
                ? "Verifying signature..."
                : eventStarted
                  ? "Event already started"
                  : "Create invitation"}
        </button>
      </form>

      {message ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-6 ${
            panelState ===
            "error"
              ? "border-red-400/20 bg-red-400/10 text-red-100"
              : "border-[#79b7ff]/12 bg-[#0d142b] text-white/60"
          }`}
        >
          {message}
        </div>
      ) : null}

      {inviteUrl &&
      invitation ? (
        <div className="mt-5 rounded-2xl border border-[#73d8ff]/20 bg-[#0d142b] p-4">
          <p className="text-xs text-white/35">
            Assigned wallet
          </p>

          <p className="mt-1 font-mono text-sm text-white/70">
            {shortenAddress(
              invitation.attendee,
            )}
          </p>

          <p className="mt-4 text-xs text-white/35">
            Expires
          </p>

          <p className="mt-1 text-sm text-white/65">
            {formatExpiry(
              invitation.expiry,
            )}
          </p>

          <textarea
            readOnly
            value={inviteUrl}
            rows={4}
            className="mt-4 w-full resize-none rounded-xl border border-[#79b7ff]/12 bg-[#080d1d] p-3 font-mono text-xs leading-5 text-white/60 outline-none"
          />

          <button
            type="button"
            onClick={
              handleCopy
            }
            className="mt-3 w-full rounded-xl border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-3 text-sm font-medium text-[#b8e8ff] transition hover:bg-[#73d8ff]/15"
          >
            Copy invitation link
          </button>
        </div>
      ) : null}
    </section>
  );
}
