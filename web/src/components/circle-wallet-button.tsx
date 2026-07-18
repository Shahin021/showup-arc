"use client";

import { useEffect, useRef, useState } from "react";
import WalletRecoveryDialog, {
  type WalletRecoveryMode,
} from "@/components/wallet-recovery-dialog";

const CIRCLE_USER_ID_KEY = "showup_circle_user_id";
const CIRCLE_WALLET_READY_KEY = "showup_circle_wallet_ready";
const CIRCLE_WALLET_ADDRESS_KEY = "showup_circle_wallet_address";
const CIRCLE_WALLET_ID_KEY = "showup_circle_wallet_id";

const CIRCLE_WALLET_CHANGED_EVENT =
  "showup-circle-wallet-changed";

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
  updateDate?: string;
  name?: string;
  refId?: string;
};

type WalletResponse = {
  wallets?: WalletDetails[];
  wallet?: WalletDetails | null;
  error?: string;
};

type CreateWalletResponse = {
  challengeId?: string;
  walletName?: string;
  blockchain?: string;
  accountType?: string;
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

async function requestNewWalletChallenge(
  userToken: string,
  walletName: string,
): Promise<string> {
  const response = await fetch(
    "/api/circle/wallets/create",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userToken,
        walletName,
      }),
    },
  );

  const data =
    (await response.json()) as CreateWalletResponse;

  if (!response.ok || !data.challengeId) {
    throw new Error(
      data.error ??
        "Unable to prepare the new Circle wallet.",
    );
  }

  return data.challengeId;
}

async function requestCircleWallets(
  userToken: string,
  attempts = 1,
): Promise<WalletDetails[]> {
  let lastError = "Unable to retrieve the Circle wallets.";

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

    const wallets = Array.isArray(data.wallets)
      ? data.wallets
      : data.wallet
        ? [data.wallet]
        : [];

    const validWallets = wallets.filter(
      (wallet) =>
        wallet.id &&
        wallet.address &&
        wallet.blockchain === "ARC-TESTNET",
    );

    if (response.ok && validWallets.length > 0) {
      return validWallets;
    }

    lastError =
      data.error ?? "Unable to retrieve the Circle wallets.";

    const canRetry =
      response.status === 404 && attempt < attempts - 1;

    if (!canRetry) {
      throw new Error(lastError);
    }

    await wait(1500);
  }

  throw new Error(lastError);
}

function chooseActiveWallet(
  wallets: WalletDetails[],
): WalletDetails {
  const savedWalletId = window.localStorage.getItem(
    CIRCLE_WALLET_ID_KEY,
  );

  const savedWallet = savedWalletId
    ? wallets.find((wallet) => wallet.id === savedWalletId)
    : undefined;

  return (
    savedWallet ??
    wallets.find((wallet) => wallet.state === "LIVE") ??
    wallets[0]
  );
}

async function requestCircleWallet(
  userToken: string,
  attempts = 1,
): Promise<WalletDetails> {
  const wallets = await requestCircleWallets(
    userToken,
    attempts,
  );

  return chooseActiveWallet(wallets);
}

async function waitForNewCircleWallet(
  userToken: string,
  existingWalletIds: Set<string>,
  attempts = 30,
): Promise<{
  wallets: WalletDetails[];
  newWallet: WalletDetails;
}> {
  let lastError =
    "The new wallet is still being processed by Circle.";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const availableWallets =
        await requestCircleWallets(userToken, 1);

      const newWallet = availableWallets.find(
        (wallet) => !existingWalletIds.has(wallet.id),
      );

      if (newWallet) {
        return {
          wallets: availableWallets,
          newWallet,
        };
      }
    } catch (error) {
      lastError = getErrorMessage(error);
    }

    if (attempt < attempts - 1) {
      await wait(1500);
    }
  }

  throw new Error(
    `${lastError} Reconnect in a moment to refresh your wallet list.`,
  );
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

  window.dispatchEvent(
    new Event(
      CIRCLE_WALLET_CHANGED_EVENT,
    ),
  );
}

function clearWalletStorage(keepUserId: boolean) {
  window.localStorage.removeItem(CIRCLE_WALLET_READY_KEY);
  window.localStorage.removeItem(CIRCLE_WALLET_ADDRESS_KEY);
  window.localStorage.removeItem(CIRCLE_WALLET_ID_KEY);

  window.dispatchEvent(
    new Event(
      CIRCLE_WALLET_CHANGED_EVENT,
    ),
  );

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
  const [wallets, setWallets] = useState<WalletDetails[]>([]);
  const [activeWalletId, setActiveWalletId] = useState("");

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

        const availableWallets = await requestCircleWallets(
          session.userToken,
          3,
        );

        const wallet = chooseActiveWallet(availableWallets);

        if (cancelled) {
          return;
        }

        saveWallet(wallet);

        setCircleUserId(session.userId);
        setHasSavedUserId(true);
        setWallets(availableWallets);
        setActiveWalletId(wallet.id);
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

    const availableWallets = await requestCircleWallets(
      userToken,
      attempts,
    );

    const wallet = chooseActiveWallet(availableWallets);

    saveWallet(wallet);

    setWallets(availableWallets);
    setActiveWalletId(wallet.id);
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

      const availableWallets = await requestCircleWallets(
        session.userToken,
        4,
      );

      const wallet = chooseActiveWallet(availableWallets);

      clearWalletStorage(false);

      window.localStorage.setItem(
        CIRCLE_USER_ID_KEY,
        session.userId,
      );

      saveWallet(wallet);

      setCircleUserId(session.userId);
      setHasSavedUserId(true);
      setWallets(availableWallets);
      setActiveWalletId(wallet.id);
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

  function handleSwitchWallet(wallet: WalletDetails) {
    if (!wallet.id || !wallet.address) {
      return;
    }

    saveWallet(wallet);

    setActiveWalletId(wallet.id);
    setWalletAddress(wallet.address);
    setCopied(false);
    setMessage("");
    setMenuOpen(false);
    setWalletChooserOpen(false);
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
    setWallets([]);
    setActiveWalletId("");
    setWalletAddress("");
    setStatus("idle");
    setMessage("");
    setMenuOpen(false);
    setWalletChooserOpen(false);
    setCopied(false);
  }

  async function handleCreateNewWallet() {
    if (status === "loading") {
      return;
    }

    const appId =
      process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

    if (!appId) {
      setStatus("error");
      setMessage("Circle App ID is not configured.");
      return;
    }

    const savedUserId =
      circleUserId ||
      window.localStorage.getItem(
        CIRCLE_USER_ID_KEY,
      ) ||
      "";

    if (!savedUserId) {
      setStatus("error");
      setMessage(
        "Connect or restore a Circle account before creating another wallet.",
      );
      return;
    }

    const confirmed = window.confirm(
      "Create a new Arc Testnet wallet inside your current Circle account? Your existing wallets will remain available.",
    );

    if (!confirmed) {
      return;
    }

    const existingWalletIds = new Set(
      wallets.map((wallet) => wallet.id),
    );

    try {
      setMenuOpen(false);
      setWalletChooserOpen(false);
      setStatus("loading");
      setMessage("Preparing a new Circle wallet...");

      const session =
        await requestCircleSession(savedUserId);

      window.localStorage.setItem(
        CIRCLE_USER_ID_KEY,
        session.userId,
      );

      setCircleUserId(session.userId);
      setHasSavedUserId(true);

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

      const walletName =
        `ShowUp Wallet ${wallets.length + 1}`;

      const challengeId =
        await requestNewWalletChallenge(
          session.userToken,
          walletName,
        );

      setMessage(
        "Approve the new wallet in Circle's secure window.",
      );

      setupTimeoutRef.current = setTimeout(() => {
        setStatus("error");
        setMessage(
          "New wallet creation timed out. Your existing wallets are safe.",
        );
      }, 10 * 60 * 1000);

      circleSdk.execute(
        challengeId,
        async (error, result) => {
          if (setupTimeoutRef.current) {
            clearTimeout(setupTimeoutRef.current);
            setupTimeoutRef.current = null;
          }

          if (error) {
            setStatus("error");
            setMessage(
              error.message ||
                `Circle wallet creation failed${
                  error.code
                    ? ` (${error.code})`
                    : ""
                }.`,
            );
            return;
          }

          console.info(
            "Circle create-wallet challenge result:",
            {
              type: result?.type,
              status: result?.status,
            },
          );

          if (!result) {
            setStatus("error");
            setMessage(
              "Circle did not return a wallet creation result.",
            );
            return;
          }

          if (
            result.status === "FAILED" ||
            result.status === "EXPIRED"
          ) {
            setStatus("error");
            setMessage(
              `Circle wallet creation ended with status: ${result.status}.`,
            );
            return;
          }

          try {
            setMessage(
              "Loading your newly created wallet...",
            );

            const {
              wallets: availableWallets,
              newWallet,
            } = await waitForNewCircleWallet(
              session.userToken,
              existingWalletIds,
            );

            saveWallet(newWallet);

            setWallets(availableWallets);
            setActiveWalletId(newWallet.id);
            setWalletAddress(newWallet.address);
            setStatus("ready");
            setMessage("");
            setMenuOpen(false);
            setWalletChooserOpen(false);
          } catch (walletError) {
            console.error(
              "New Circle wallet lookup failed:",
              walletError,
            );

            setStatus("error");
            setMessage(
              getErrorMessage(walletError),
            );
          }
        },
      );
    } catch (error) {
      if (setupTimeoutRef.current) {
        clearTimeout(setupTimeoutRef.current);
        setupTimeoutRef.current = null;
      }

      console.error(
        "New Circle wallet creation failed:",
        error,
      );

      setStatus("error");
      setMessage(getErrorMessage(error));
    }
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

                <div className="px-2 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">
                      Your wallets
                    </p>

                    <span className="text-xs text-white/35">
                      {wallets.length}
                    </span>
                  </div>

                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                    {wallets.map((wallet, index) => {
                      const isActive =
                        wallet.id === activeWalletId;

                      return (
                        <button
                          key={wallet.id}
                          type="button"
                          onClick={() => {
                            handleSwitchWallet(wallet);
                          }}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                            isActive
                              ? "border-[#74f2c2]/30 bg-[#74f2c2]/10"
                              : "border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.06]"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-white/75">
                              {wallet.name ||
                                `Wallet ${index + 1}`}
                            </span>

                            <span className="mt-1 block font-mono text-[11px] text-white/40">
                              {shortenAddress(wallet.address)}
                            </span>
                          </span>

                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
                              isActive
                                ? "bg-[#74f2c2]/15 text-[#9dffda]"
                                : "bg-white/[0.06] text-white/35"
                            }`}
                          >
                            {isActive ? "Active" : "Switch"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
                    Restore existing Circle account
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleCreateNewWallet();
                    }}
                    className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    Create new wallet
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
                      Restore existing Circle account
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
                        void handleCreateNewWallet();
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