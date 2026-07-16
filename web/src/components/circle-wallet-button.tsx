"use client";

import { useEffect, useRef, useState } from "react";
import WalletRecoveryDialog, {
  type WalletRecoveryMode,
} from "@/components/wallet-recovery-dialog";

const CIRCLE_USER_ID_KEY = "showup_circle_user_id";
const CIRCLE_WALLET_READY_KEY = "showup_circle_wallet_ready";
const CIRCLE_WALLET_ADDRESS_KEY = "showup_circle_wallet_address";
const CIRCLE_WALLET_ID_KEY = "showup_circle_wallet_id";

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

type WalletDetails = {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
  accountType?: string;
  createDate?: string;
};

type WalletResponse = {
  wallet?: WalletDetails;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while connecting the Circle wallet.";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function shortenAddress(address: string) {
  if (address.length <= 14) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function requestCircleSession(
  userId?: string,
): Promise<{
  userId: string;
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
    !data.userId ||
    !data.userToken ||
    !data.encryptionKey
  ) {
    throw new Error(
      data.error ?? "Unable to create the Circle session.",
    );
  }

  return {
    userId: data.userId,
    userToken: data.userToken,
    encryptionKey: data.encryptionKey,
  };
}

async function requestWalletInitialization(
  userToken: string,
): Promise<InitializeResponse> {
  const response = await fetch("/api/circle/initialize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      userToken,
    }),
  });

  const data = (await response.json()) as InitializeResponse;

  if (!response.ok) {
    throw new Error(
      data.error ?? "Unable to initialize the Circle wallet.",
    );
  }

  return data;
}

async function requestCircleWallet(
  userToken: string,
  attempts = 1,
): Promise<WalletDetails> {
  let lastError = "Unable to retrieve the Circle wallet.";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch("/api/circle/wallets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userToken,
      }),
    });

    const data = (await response.json()) as WalletResponse;

    if (
      response.ok &&
      data.wallet?.id &&
      data.wallet.address &&
      data.wallet.blockchain
    ) {
      return data.wallet;
    }

    lastError =
      data.error ?? "Unable to retrieve the Circle wallet.";

    const canRetry =
      response.status === 404 && attempt < attempts - 1;

    if (!canRetry) {
      throw new Error(lastError);
    }

    await wait(1500);
  }

  throw new Error(lastError);
}

function saveWallet(wallet: WalletDetails) {
  window.localStorage.setItem(
    CIRCLE_WALLET_READY_KEY,
    "true",
  );

  window.localStorage.setItem(
    CIRCLE_WALLET_ADDRESS_KEY,
    wallet.address,
  );

  window.localStorage.setItem(
    CIRCLE_WALLET_ID_KEY,
    wallet.id,
  );
}

function clearWalletStorage(keepUserId: boolean) {
  window.localStorage.removeItem(CIRCLE_WALLET_READY_KEY);
  window.localStorage.removeItem(CIRCLE_WALLET_ADDRESS_KEY);
  window.localStorage.removeItem(CIRCLE_WALLET_ID_KEY);

  if (!keepUserId) {
    window.localStorage.removeItem(CIRCLE_USER_ID_KEY);
  }
}

function copyWithFallback(text: string) {
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function CircleWalletButton() {
  const [status, setStatus] =
    useState<ConnectionStatus>("idle");

  const [message, setMessage] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [circleUserId, setCircleUserId] = useState("");
  const [hasSavedUserId, setHasSavedUserId] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [walletChooserOpen, setWalletChooserOpen] =
    useState(false);

  const [copied, setCopied] = useState(false);

  const [recoveryDialogOpen, setRecoveryDialogOpen] =
    useState(false);

  const [recoveryMode, setRecoveryMode] =
    useState<WalletRecoveryMode>("backup");

  const menuRef = useRef<HTMLDivElement | null>(null);

  const setupTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const copiedTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreWallet() {
      const savedUserId = window.localStorage.getItem(
        CIRCLE_USER_ID_KEY,
      );

      const walletReady = window.localStorage.getItem(
        CIRCLE_WALLET_READY_KEY,
      );

      const cachedAddress = window.localStorage.getItem(
        CIRCLE_WALLET_ADDRESS_KEY,
      );

      if (savedUserId) {
        setCircleUserId(savedUserId);
        setHasSavedUserId(true);
      }

      if (!savedUserId || walletReady !== "true") {
        return;
      }

      if (cachedAddress) {
        setWalletAddress(cachedAddress);
        setStatus("ready");
        setMessage("");
      } else {
        setStatus("loading");
        setMessage("Restoring your Circle wallet...");
      }

      try {
        const session = await requestCircleSession(savedUserId);

        const wallet = await requestCircleWallet(
          session.userToken,
          3,
        );

        if (cancelled) {
          return;
        }

        saveWallet(wallet);

        setCircleUserId(session.userId);
        setHasSavedUserId(true);
        setWalletAddress(wallet.address);
        setStatus("ready");
        setMessage("");
      } catch (error) {
        console.error(
          "Circle wallet restoration failed:",
          error,
        );

        if (cancelled) {
          return;
        }

        if (cachedAddress) {
          setWalletAddress(cachedAddress);
          setStatus("ready");
          setMessage("");
          return;
        }

        clearWalletStorage(true);
        setWalletAddress("");
        setStatus("idle");
        setMessage("");
      }
    }

    function handleOutsideClick(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
        setWalletChooserOpen(false);
      }
    }

    void restoreWallet();

    document.addEventListener(
      "mousedown",
      handleOutsideClick,
    );

    return () => {
      cancelled = true;

      document.removeEventListener(
        "mousedown",
        handleOutsideClick,
      );

      if (setupTimeoutRef.current) {
        clearTimeout(setupTimeoutRef.current);
      }

      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  async function finishWalletConnection(
    userToken: string,
    attempts: number,
  ) {
    setMessage("Loading your Arc Testnet wallet...");

    const wallet = await requestCircleWallet(
      userToken,
      attempts,
    );

    saveWallet(wallet);

    setWalletAddress(wallet.address);
    setStatus("ready");
    setMessage("");
    setMenuOpen(false);
    setWalletChooserOpen(false);
  }

  async function handleConnect(forceNewUser = false) {
    if (status === "loading") {
      return;
    }

    if (status === "ready" && !forceNewUser) {
      return;
    }

    const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

    if (!appId) {
      setStatus("error");
      setMessage("Circle App ID is not configured.");
      return;
    }

    setWalletChooserOpen(false);
    setMenuOpen(false);

    if (forceNewUser) {
      clearWalletStorage(false);

      setWalletAddress("");
      setCircleUserId("");
      setHasSavedUserId(false);
    }

    try {
      setStatus("loading");
      setMessage("Creating a secure Circle session...");

      const savedUserId = forceNewUser
        ? undefined
        : window.localStorage.getItem(
              CIRCLE_USER_ID_KEY,
            ) ?? undefined;

      const session = await requestCircleSession(savedUserId);

      window.localStorage.setItem(
        CIRCLE_USER_ID_KEY,
        session.userId,
      );

      setCircleUserId(session.userId);
      setHasSavedUserId(true);

      setMessage(
        "Preparing Circle's secure wallet interface...",
      );

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
        userToken: session.userToken,
        encryptionKey: session.encryptionKey,
      });

      const initialization =
        await requestWalletInitialization(
          session.userToken,
        );

      if (initialization.alreadyInitialized) {
        await finishWalletConnection(
          session.userToken,
          4,
        );

        return;
      }

      if (!initialization.challengeId) {
        throw new Error(
          "Circle did not return a wallet challenge.",
        );
      }

      setMessage(
        "Complete your PIN setup in Circle's secure window.",
      );

      setupTimeoutRef.current = setTimeout(() => {
        setStatus("idle");
        setMessage(
          "Wallet setup timed out. You can safely try again.",
        );
      }, 10 * 60 * 1000);

      circleSdk.execute(
        initialization.challengeId,
        async (error, result) => {
          if (setupTimeoutRef.current) {
            clearTimeout(setupTimeoutRef.current);
            setupTimeoutRef.current = null;
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

            setMessage(
              "Circle wallet setup was not completed.",
            );

            return;
          }

          try {
            await finishWalletConnection(
              session.userToken,
              8,
            );
          } catch (walletError) {
            console.error(
              "Circle wallet lookup failed after setup:",
              walletError,
            );

            setStatus("error");
            setMessage(getErrorMessage(walletError));
          }
        },
      );
    } catch (error) {
      if (setupTimeoutRef.current) {
        clearTimeout(setupTimeoutRef.current);
        setupTimeoutRef.current = null;
      }

      console.error(
        "Circle wallet connection failed:",
        error,
      );

      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }

  async function handleRestoreWallet(userId: string) {
    const normalizedUserId = userId.trim();

    const hadConnectedWallet =
      status === "ready" && Boolean(walletAddress);

    if (!normalizedUserId) {
      throw new Error(
        "The recovery code did not contain a valid Circle user.",
      );
    }

    try {
      setStatus("loading");
      setMessage("Restoring your Circle wallet...");
      setMenuOpen(false);
      setWalletChooserOpen(false);

      const session =
        await requestCircleSession(normalizedUserId);

      const wallet = await requestCircleWallet(
        session.userToken,
        4,
      );

      clearWalletStorage(false);

      window.localStorage.setItem(
        CIRCLE_USER_ID_KEY,
        session.userId,
      );

      saveWallet(wallet);

      setCircleUserId(session.userId);
      setHasSavedUserId(true);
      setWalletAddress(wallet.address);
      setStatus("ready");
      setMessage("");
    } catch (error) {
      console.error(
        "Circle wallet recovery connection failed:",
        error,
      );

      if (hadConnectedWallet) {
        setStatus("ready");
        setMessage("");
      } else {
        setStatus("error");
        setMessage(getErrorMessage(error));
      }

      throw error;
    }
  }

  async function handleCopyAddress() {
    if (!walletAddress) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(walletAddress);
      } else {
        copyWithFallback(walletAddress);
      }

      setCopied(true);

      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }

      copiedTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (error) {
      console.error(
        "Unable to copy wallet address:",
        error,
      );

      copyWithFallback(walletAddress);
      setCopied(true);
    }
  }

  function openRecoveryDialog(mode: WalletRecoveryMode) {
    setRecoveryMode(mode);
    setRecoveryDialogOpen(true);
    setMenuOpen(false);
    setWalletChooserOpen(false);
    setMessage("");

    if (status === "error") {
      setStatus("idle");
    }
  }

  function handleDisconnect() {
    clearWalletStorage(true);

    const savedUserId = window.localStorage.getItem(
      CIRCLE_USER_ID_KEY,
    );

    setHasSavedUserId(Boolean(savedUserId));
    setWalletAddress("");
    setStatus("idle");
    setMessage("");
    setMenuOpen(false);
    setWalletChooserOpen(false);
    setCopied(false);
  }

  function handleChangeWallet() {
    const confirmed = window.confirm(
      "Change wallet will create a new Circle wallet on Arc Testnet. Your current wallet will not be deleted, but ShowUp will stop using it. Make sure you have saved its recovery code first. Continue?",
    );

    if (!confirmed) {
      return;
    }

    void handleConnect(true);
  }

  function toggleWalletChooser() {
    if (status === "loading") {
      return;
    }

    setMenuOpen(false);
    setWalletChooserOpen((current) => !current);
    setMessage("");

    if (status === "error") {
      setStatus("idle");
    }
  }

  const buttonLabel =
    status === "loading"
      ? "Connecting..."
      : "Choose wallet";

  return (
    <>
      <div
        ref={menuRef}
        className="relative flex flex-col items-end"
      >
        {status === "ready" && walletAddress ? (
          <>
            <button
              type="button"
              onClick={() => {
                setMenuOpen((current) => !current);
                setWalletChooserOpen(false);
              }}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full border border-[#74f2c2]/30 bg-[#74f2c2]/15 px-4 py-2.5 text-sm font-medium text-[#9dffda] transition hover:border-[#74f2c2]/60 hover:bg-[#74f2c2]/20"
            >
              <span className="h-2 w-2 rounded-full bg-[#74f2c2]" />

              <span className="font-mono">
                {shortenAddress(walletAddress)}
              </span>

              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className={`h-4 w-4 transition ${
                  menuOpen ? "rotate-180" : ""
                }`}
              >
                <path
                  d="M5 7.5 10 12.5 15 7.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-3 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1916]/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
              >
                <div className="px-2 pb-3 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#74f2c2]">
                      Circle wallet
                    </p>

                    <span className="rounded-full bg-[#74f2c2]/10 px-2 py-1 text-[10px] font-medium text-[#9dffda]">
                      Arc Testnet
                    </span>
                  </div>

                  <p className="mt-3 break-all font-mono text-xs leading-5 text-white/55">
                    {walletAddress}
                  </p>
                </div>

                <div className="h-px bg-white/10" />

                <div className="space-y-1 pt-2">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleCopyAddress();
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <span>Copy address</span>

                    <span className="text-xs text-[#74f2c2]">
                      {copied ? "Copied" : "Copy"}
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      openRecoveryDialog("backup");
                    }}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    Back up wallet
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      openRecoveryDialog("restore");
                    }}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    Restore wallet
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleChangeWallet}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    Change wallet
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleDisconnect}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-red-300 transition hover:bg-red-400/10 hover:text-red-200"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleWalletChooser}
              disabled={status === "loading"}
              aria-expanded={walletChooserOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:border-[#74f2c2]/60 hover:bg-[#74f2c2]/10 disabled:cursor-wait disabled:opacity-70"
            >
              {buttonLabel}

              {status !== "loading" && (
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className={`h-4 w-4 transition ${
                    walletChooserOpen ? "rotate-180" : ""
                  }`}
                >
                  <path
                    d="M5 7.5 10 12.5 15 7.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            {walletChooserOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-3 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1916]/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
              >
                <div className="px-3 pb-3 pt-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#74f2c2]">
                    Choose a wallet
                  </p>

                  <p className="mt-2 text-xs leading-5 text-white/45">
                    Create a new Circle wallet or reconnect one
                    you already backed up.
                  </p>
                </div>

                <div className="h-px bg-white/10" />

                <div className="space-y-1 pt-2">
                  {hasSavedUserId && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        void handleConnect(false);
                      }}
                      className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.06]"
                    >
                      <span className="block text-sm font-medium text-white/80">
                        Resume or reconnect wallet
                      </span>

                      <span className="mt-1 block text-xs leading-5 text-white/40">
                        Continue with the Circle wallet saved in
                        this browser.
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      openRecoveryDialog("restore");
                    }}
                    className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.06]"
                  >
                    <span className="block text-sm font-medium text-white/80">
                      Restore existing wallet
                    </span>

                    <span className="mt-1 block text-xs leading-5 text-white/40">
                      Use a ShowUp recovery code from another
                      browser or device.
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      if (hasSavedUserId) {
                        handleChangeWallet();
                        return;
                      }

                      void handleConnect(true);
                    }}
                    className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.06]"
                  >
                    <span className="block text-sm font-medium text-white/80">
                      Create new Circle wallet
                    </span>

                    <span className="mt-1 block text-xs leading-5 text-white/40">
                      Set up a new PIN-secured wallet on Arc
                      Testnet.
                    </span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {message && status !== "ready" && (
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

      <WalletRecoveryDialog
        open={recoveryDialogOpen}
        mode={recoveryMode}
        userId={circleUserId || undefined}
        onClose={() => {
          setRecoveryDialogOpen(false);
        }}
        onRestore={handleRestoreWallet}
      />
    </>
  );
}