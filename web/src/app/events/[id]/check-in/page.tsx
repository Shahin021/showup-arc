"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import ShowUpHeader from "@/components/showup-header";
import { checkInWithBrowserWallet } from "@/lib/browser-checkin";
import {
  getCircleSession,
  readStoredCircleWallet,
  runCircleChallenge,
} from "@/lib/circle-client";
import {
  decodeCheckInCode,
  type SignedCheckInCode,
} from "@/lib/showup-checkin";
import { ARC_NETWORK_LABEL, explorerTxUrl } from "@/lib/showup-network";
import {
  readActiveWallet,
  SHOWUP_WALLET_CHANGED_EVENT,
  type ShowUpWallet,
} from "@/lib/showup-wallet";

const ATTENDED = 3;

type Verification = {
  valid?: boolean;
  error?: string;
  windowOpen?: boolean;
  windowMessage?: string;
  personal?: boolean;
  reservationStatus?: number | null;
  eligible?: boolean | null;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readReservationStatus(eventId: string, wallet: string) {
  const response = await fetch(
    `/api/events/${eventId}/reservation-status?attendee=${wallet}`,
    { cache: "no-store" },
  );
  const data = (await response.json().catch(() => ({}))) as {
    reservation?: { status: number };
  };
  return data.reservation?.status ?? null;
}

function CheckInContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const eventId = params.id;
  const encoded = searchParams.get("code") ?? "";

  const decoded = useMemo((): { code: SignedCheckInCode | null; error: string } => {
    if (!/^\d+$/.test(eventId ?? "")) {
      return { code: null, error: "This event link is not valid." };
    }
    if (!encoded) {
      return { code: null, error: "This link has no check-in code. Scan the QR code at the venue." };
    }
    try {
      return { code: decodeCheckInCode(BigInt(eventId), encoded), error: "" };
    } catch (decodeError) {
      return {
        code: null,
        error: decodeError instanceof Error ? decodeError.message : "This check-in code is not valid.",
      };
    }
  }, [eventId, encoded]);

  const [wallet, setWallet] = useState<ShowUpWallet | null>(null);
  const [verification, setVerification] = useState<{ wallet: string; result: Verification } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ txHash?: string } | null>(null);

  useEffect(() => {
    const sync = () => setWallet(readActiveWallet());
    const initial = window.setTimeout(sync, 0);
    window.addEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    };
  }, []);

  const code = decoded.code;

  useEffect(() => {
    if (!code || !wallet) {
      return;
    }
    let cancelled = false;
    const address = wallet.address;

    fetch("/api/check-in/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        eventId,
        wallet: address,
        code: {
          attendee: code.attendee,
          issuedAt: code.issuedAt.toString(),
          expiry: code.expiry.toString(),
          signature: code.signature,
        },
      }),
    })
      .then((response) => response.json().catch(() => ({})))
      .then((result: Verification) => {
        if (!cancelled) {
          setVerification({ wallet: address, result });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, wallet, eventId]);

  const current =
    wallet && verification?.wallet === wallet.address ? verification.result : null;
  const alreadyCheckedIn = current?.reservationStatus === ATTENDED;

  async function handleCheckIn() {
    if (!code || !wallet) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      let txHash: string | undefined;

      if (wallet.kind === "circle") {
        const stored = readStoredCircleWallet();
        if (!stored) {
          throw new Error("Connect your Circle wallet first.");
        }
        setMessage("Preparing your check-in...");
        const session = await getCircleSession(stored.userId);
        const response = await fetch("/api/circle/events/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            userToken: session.userToken,
            walletId: stored.walletId,
            eventId,
            code: {
              attendee: code.attendee,
              issuedAt: code.issuedAt.toString(),
              expiry: code.expiry.toString(),
              signature: code.signature,
            },
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          challengeId?: string;
          error?: string;
        };
        if (!response.ok || !data.challengeId) {
          throw new Error(data.error ?? "Unable to prepare the check-in.");
        }
        setMessage("Confirm the check-in with your Circle PIN.");
        await runCircleChallenge(data.challengeId, session, { isTransaction: true });
      } else {
        setMessage(`Confirm the check-in in ${wallet.providerName}.`);
        txHash = await checkInWithBrowserWallet(wallet.providerRdns, wallet.address, code);
      }

      // Success is read from the chain, not inferred from the approval.
      setMessage(`Waiting for confirmation on ${ARC_NETWORK_LABEL}...`);
      for (let attempt = 0; attempt < 45; attempt++) {
        const status = await readReservationStatus(eventId, wallet.address);
        if (status === ATTENDED) {
          setDone({ txHash });
          setMessage("");
          return;
        }
        await wait(2000);
      }
      throw new Error(
        "The check-in has not confirmed yet. Refresh this page in a minute; your status is read from the chain.",
      );
    } catch (checkInError) {
      setError(
        checkInError instanceof Error ? checkInError.message : "Check-in failed.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Event check-in</h1>
      <p className="mt-3 text-sm leading-6 text-white/50">
        Checking in records your attendance on {ARC_NETWORK_LABEL}. For free
        events your deposit comes back right away; for paid events the ticket
        payment is released to the organizer. Once checked in, you cannot be
        marked as a no-show.
      </p>

      <div className="mt-8 rounded-[24px] border border-[#79b7ff]/18 bg-[#0b1025]/80 p-6">
        {decoded.error ? (
          <p className="text-sm text-red-300">{decoded.error}</p>
        ) : done || alreadyCheckedIn ? (
          <div>
            <p className="text-lg font-semibold text-emerald-300">You are checked in.</p>
            {done?.txHash ? (
              <a
                href={explorerTxUrl(done.txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-[#9bddff] underline"
              >
                View the transaction
              </a>
            ) : null}
          </div>
        ) : !wallet ? (
          <p className="text-sm text-white/60">
            Connect the wallet you reserved with, using the button at the top
            right.
          </p>
        ) : (
          <>
            <p className="font-mono text-xs text-white/50">{wallet.address}</p>

            {current?.error ? (
              <p className="mt-4 text-sm text-red-300">{current.error}</p>
            ) : null}
            {current?.valid && !current.windowOpen ? (
              <p className="mt-4 text-sm text-amber-200">{current.windowMessage}</p>
            ) : null}
            {current?.valid && current.eligible === false ? (
              <p className="mt-4 text-sm text-amber-200">
                This wallet has no reservation that can be checked in for this
                event. Paid reservations must be fully paid first.
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleCheckIn}
              disabled={
                busy ||
                !current?.valid ||
                !current.windowOpen ||
                current.eligible === false
              }
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#73d8ff] to-[#9285ff] px-4 py-3 text-sm font-semibold text-[#050817] disabled:opacity-50"
            >
              {busy ? "Checking in..." : current ? "Check in" : "Checking code..."}
            </button>
          </>
        )}

        {message ? <p className="mt-4 text-sm text-[#9bddff]">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      </div>

      <Link
        href={`/events/${eventId}`}
        className="mt-6 inline-block text-sm text-[#9bddff] underline"
      >
        Back to the event
      </Link>
    </div>
  );
}

export default function CheckInPage() {
  return (
    <main className="min-h-screen bg-[#050817] text-white">
      <ShowUpHeader />
      <Suspense fallback={null}>
        <CheckInContent />
      </Suspense>
    </main>
  );
}
