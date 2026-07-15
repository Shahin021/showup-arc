"use client";

import { useEffect, useRef, useState } from "react";

const CIRCLE_USER_ID_KEY = "showup_circle_user_id";
const CIRCLE_WALLET_READY_KEY = "showup_circle_wallet_ready";

type ConnectionStatus = "idle" | "loading" | "ready" | "error";

type SessionResponse = {
  userId?: string;
  userToken?: string;
  encryptionKey?: string;
  isNewUser?: boolean;
  error?: string;
};

type InitializeResponse = {
  challengeId?: string | null;
  alreadyInitialized?: boolean;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while connecting the Circle wallet.";
}

export default function CircleWalletButton() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [message, setMessage] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedUserId = window.localStorage.getItem(CIRCLE_USER_ID_KEY);
    const walletReady = window.localStorage.getItem(CIRCLE_WALLET_READY_KEY);

    if (savedUserId && walletReady === "true") {
      setStatus("ready");
      setMessage("Circle wallet ready on Arc Testnet.");
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  async function handleConnect() {
    if (status === "loading" || status === "ready") {
      return;
    }

    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

    if (!appId) {
      setStatus("error");
      setMessage("Circle App ID is not configured.");
      return;
    }

    try {
      setStatus("loading");
      setMessage("Creating a secure Circle session...");

      const savedUserId =
        window.localStorage.getItem(CIRCLE_USER_ID_KEY) ?? undefined;

      const sessionResponse = await fetch("/api/circle/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          userId: savedUserId,
        }),
      });

      const sessionData =
        (await sessionResponse.json()) as SessionResponse;

      if (
        !sessionResponse.ok ||
        !sessionData.userId ||
        !sessionData.userToken ||
        !sessionData.encryptionKey
      ) {
        throw new Error(
          sessionData.error ?? "Unable to create the Circle session.",
        );
      }

      window.localStorage.setItem(
        CIRCLE_USER_ID_KEY,
        sessionData.userId,
      );

      setMessage("Preparing Circle's secure wallet interface...");

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
        userToken: sessionData.userToken,
        encryptionKey: sessionData.encryptionKey,
      });

      const initializeResponse = await fetch(
        "/api/circle/initialize",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            userToken: sessionData.userToken,
          }),
        },
      );

      const initializeData =
        (await initializeResponse.json()) as InitializeResponse;

      if (!initializeResponse.ok) {
        throw new Error(
          initializeData.error ?? "Unable to initialize the Circle wallet.",
        );
      }

      if (initializeData.alreadyInitialized) {
        window.localStorage.setItem(
          CIRCLE_WALLET_READY_KEY,
          "true",
        );

        setStatus("ready");
        setMessage("Circle wallet ready on Arc Testnet.");
        return;
      }

      if (!initializeData.challengeId) {
        throw new Error("Circle did not return a wallet challenge.");
      }

      setMessage(
        "Complete your PIN setup in Circle's secure window.",
      );

      timeoutRef.current = setTimeout(() => {
        setStatus("idle");
        setMessage(
          "Wallet setup timed out. You can safely try again.",
        );
      }, 10 * 60 * 1000);

      circleSdk.execute(
        initializeData.challengeId,
        (error, result) => {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }

          if (error) {
            setStatus("error");
            setMessage(
              error.message ||
                `Circle wallet setup failed${
                  error.code ? ` (${error.code})` : ""
                }.`,
            );
            return;
          }

          if (!result || result.status !== "COMPLETE") {
            setStatus("error");
            setMessage("Circle wallet setup was not completed.");
            return;
          }

          window.localStorage.setItem(
            CIRCLE_WALLET_READY_KEY,
            "true",
          );

          setStatus("ready");
          setMessage("Circle wallet ready on Arc Testnet.");
        },
      );
    } catch (error) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      console.error("Circle wallet connection failed:", error);

      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }

  const buttonLabel =
    status === "loading"
      ? "Connecting..."
      : status === "ready"
        ? "Wallet ready"
        : status === "error"
          ? "Try again"
          : "Connect wallet";

  return (
    <div className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={handleConnect}
        disabled={status === "loading" || status === "ready"}
        className={`rounded-full border px-5 py-2.5 text-sm font-medium transition ${
          status === "ready"
            ? "cursor-default border-[#74f2c2]/30 bg-[#74f2c2]/15 text-[#9dffda]"
            : "border-white/15 bg-white/5 text-white hover:border-[#74f2c2]/60 hover:bg-[#74f2c2]/10"
        } disabled:opacity-70`}
      >
        {buttonLabel}
      </button>

      {message && status !== "idle" && (
        <p
          aria-live="polite"
          className={`absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border px-3 py-2 text-xs leading-5 shadow-xl backdrop-blur ${
            status === "error"
              ? "border-red-400/25 bg-red-950/90 text-red-200"
              : "border-white/10 bg-[#0b1916]/95 text-white/65"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}