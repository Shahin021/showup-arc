"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";

import { signCheckInWithBrowserWallet } from "@/lib/browser-checkin";
import {
  getCircleSession,
  readStoredCircleWallet,
  runCircleChallenge,
} from "@/lib/circle-client";
import {
  checkInPath,
  createCheckInWindow,
  ZERO_ADDRESS,
  type SignedCheckInCode,
} from "@/lib/showup-checkin";
import {
  readActiveWallet,
  SHOWUP_WALLET_CHANGED_EVENT,
  type ShowUpWallet,
} from "@/lib/showup-wallet";

type Props = {
  eventId: string;
  organizer: string;
  eventStart: string;
  eventEnd: string;
  cancelled: boolean;
};

type ActiveCode = {
  code: SignedCheckInCode;
  url: string;
  qrDataUrl: string;
};

const PREPARE_BEFORE_START_SECONDS = 30 * 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Lets the organizer show a short-lived, signed check-in QR code at the
 * venue. Attendees scan it and check themselves in from their own wallet,
 * which settles their reservation as attended so it can no longer be
 * marked as a no-show.
 */
export default function OrganizerCheckInPanel({
  eventId,
  organizer,
  eventStart,
  eventEnd,
  cancelled,
}: Props) {
  const [wallet, setWallet] = useState<ShowUpWallet | null>(null);
  const [personalAddress, setPersonalAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState<ActiveCode | null>(null);
  const [now, setNow] = useState(() => nowSeconds());

  useEffect(() => {
    const sync = () => setWallet(readActiveWallet());
    const initial = window.setTimeout(sync, 0);
    window.addEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    const tick = window.setInterval(() => setNow(nowSeconds()), 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(tick);
      window.removeEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const isOrganizer =
    wallet !== null &&
    wallet.address.toLowerCase() === organizer.toLowerCase();

  if (!isOrganizer || cancelled) {
    return null;
  }

  const start = Number(eventStart);
  const end = Number(eventEnd);
  const canPrepare = now + PREPARE_BEFORE_START_SECONDS >= start && now < end;
  const secondsLeft = active ? Number(active.code.expiry) - now : 0;

  async function createCode() {
    if (!wallet) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const trimmed = personalAddress.trim();
      if (trimmed && !isAddress(trimmed)) {
        throw new Error("The attendee wallet address is invalid.");
      }
      const attendee = trimmed ? getAddress(trimmed) : ZERO_ADDRESS;

      let code: SignedCheckInCode;

      if (wallet.kind === "circle") {
        const stored = readStoredCircleWallet();
        if (!stored) {
          throw new Error("Connect the organizer Circle wallet first.");
        }

        setMessage("Preparing the check-in code...");
        const session = await getCircleSession(stored.userId);
        const response = await fetch("/api/circle/check-in/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            userToken: session.userToken,
            walletId: stored.walletId,
            eventId,
            attendee: trimmed || undefined,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          challengeId?: string;
          code?: { attendee: string; issuedAt: string; expiry: string };
          error?: string;
        };
        if (!response.ok || !data.challengeId || !data.code) {
          throw new Error(data.error ?? "Unable to prepare the check-in code.");
        }

        setMessage("Sign the check-in code with your Circle PIN.");
        const signature = await runCircleChallenge(data.challengeId, session, {
          isTransaction: false,
        });
        if (!signature) {
          throw new Error("Circle did not return the signature.");
        }

        code = {
          eventId: BigInt(eventId),
          attendee: data.code.attendee as `0x${string}`,
          issuedAt: BigInt(data.code.issuedAt),
          expiry: BigInt(data.code.expiry),
          signature: signature as `0x${string}`,
        };
      } else {
        const { issuedAt, expiry } = createCheckInWindow(
          BigInt(nowSeconds()),
          BigInt(eventEnd),
        );
        const payload = { eventId: BigInt(eventId), attendee, issuedAt, expiry };
        setMessage(`Sign the check-in code in ${wallet.providerName}.`);
        const signature = await signCheckInWithBrowserWallet(
          wallet.providerRdns,
          wallet.address,
          payload,
        );
        code = { ...payload, signature };
      }

      setMessage("Verifying the signature...");
      const verify = await fetch("/api/check-in/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          eventId,
          code: {
            attendee: code.attendee,
            issuedAt: code.issuedAt.toString(),
            expiry: code.expiry.toString(),
            signature: code.signature,
          },
        }),
      });
      const verified = (await verify.json().catch(() => ({}))) as {
        valid?: boolean;
        error?: string;
      };
      if (!verify.ok || !verified.valid) {
        throw new Error(verified.error ?? "The check-in code could not be verified.");
      }

      const url = new URL(checkInPath(eventId, code), window.location.origin).toString();
      const qrDataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 320,
        errorCorrectionLevel: "M",
      });

      setActive({ code, url, qrDataUrl });
      setMessage("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create the check-in code.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-[24px] border border-[#79b7ff]/18 bg-[#0b1025]/70 p-5">
      <p className="text-sm font-semibold text-white/85">Self check-in</p>
      <p className="mt-2 text-sm leading-6 text-white/50">
        Show this QR code at the venue. Attendees scan it and check in from
        their own wallet; a checked-in reservation can no longer be marked as
        a no-show. Codes last up to 15 minutes, so create a new one while
        doors are open, and only show it in person.
      </p>

      {!canPrepare ? (
        <p className="mt-4 text-sm text-white/45">
          {now >= end
            ? "The event has ended, so check-in is closed."
            : "Check-in codes can be created from 30 minutes before the start. Attendees can use them once the event starts."}
        </p>
      ) : (
        <>
          <label className="mt-4 block text-xs text-white/45">
            Personal code for one wallet (optional)
            <input
              value={personalAddress}
              onChange={(event) => setPersonalAddress(event.target.value)}
              placeholder="0x… — leave empty for an open code"
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#070c1d] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#73d8ff]/50"
            />
          </label>

          <button
            type="button"
            onClick={createCode}
            disabled={busy}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-[#73d8ff] to-[#9285ff] px-4 py-3 text-sm font-semibold text-[#050817] disabled:opacity-60"
          >
            {busy ? "Working..." : active ? "Create a new code" : "Create check-in QR code"}
          </button>
        </>
      )}

      {message ? <p className="mt-3 text-sm text-[#9bddff]">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

      {active ? (
        <div className="mt-5 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.qrDataUrl}
            alt="Check-in QR code"
            width={320}
            height={320}
            className="rounded-2xl bg-white p-2"
          />
          <p className="text-sm text-white/70">
            {secondsLeft > 0
              ? `Valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
              : "Expired — create a new code."}
            {active.code.attendee !== ZERO_ADDRESS
              ? ` · only for ${active.code.attendee.slice(0, 6)}…${active.code.attendee.slice(-4)}`
              : " · open code"}
          </p>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(active.url)}
            className="text-xs font-semibold text-[#9bddff] underline"
          >
            Copy check-in link
          </button>
        </div>
      ) : null}
    </div>
  );
}
