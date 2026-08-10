"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import WalletRecoveryDialog, {
  type WalletRecoveryMode,
} from "@/components/wallet-recovery-dialog";
import {
  connectBrowserWallet,
  discoverBrowserWallets,
  type BrowserWalletProviderDetail,
} from "@/lib/browser-wallet";
import {
  authorizeBrowserWallet,
} from "@/lib/browser-wallet-auth";
import {
  clearActiveWallet,
  readActiveWallet,
  saveActiveWallet,
  SHOWUP_WALLET_CHANGED_EVENT,
  type ShowUpWalletKind,
} from "@/lib/showup-wallet";

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

type RenameWalletResponse = {
  walletId?: string;
  walletName?: string;
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

function getNextWalletName(
  availableWallets: WalletDetails[],
) {
  let highestNumber = 0;

  for (const wallet of availableWallets) {
    const match =
      wallet.name
        ?.trim()
        .match(
          /^ShowUp Wallet (\d+)$/i,
        );

    if (!match) {
      continue;
    }

    const walletNumber =
      Number(match[1]);

    if (
      Number.isInteger(
        walletNumber,
      ) &&
      walletNumber >
        highestNumber
    ) {
      highestNumber =
        walletNumber;
    }
  }

  const nextNumber =
    Math.max(
      highestNumber + 1,
      availableWallets.length + 1,
    );

  return `ShowUp Wallet ${nextNumber}`;
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

async function requestWalletRename(
  userToken: string,
  walletId: string,
  walletName: string,
) {
  const response = await fetch(
    "/api/circle/wallets/rename",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userToken,
        walletId,
        walletName,
      }),
    },
  );

  const data =
    (await response
      .json()) as RenameWalletResponse;

  if (!response.ok) {
    throw new Error(
      data.error ??
        "Unable to rename the Circle wallet.",
    );
  }
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

  saveActiveWallet({
    kind: "circle",
    address: wallet.address as `0x${string}`,
  });

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

  clearActiveWallet();

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

  const [walletKind, setWalletKind] =
    useState<ShowUpWalletKind | null>(null);

  const [browserWalletName, setBrowserWalletName] =
    useState("");

  const [browserWallets, setBrowserWallets] =
    useState<BrowserWalletProviderDetail[]>([]);

  const [wallets, setWallets] = useState<WalletDetails[]>([]);
  const [activeWalletId, setActiveWalletId] = useState("");

  const [circleUserId, setCircleUserId] = useState("");
  const [hasSavedUserId, setHasSavedUserId] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [walletChooserOpen, setWalletChooserOpen] =
    useState(false);

  const [copiedWalletId, setCopiedWalletId] =
    useState("");

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
      const activeWallet = readActiveWallet();

      if (activeWallet?.kind === "browser") {
        setWalletKind("browser");
        setBrowserWalletName(activeWallet.providerName);
        setWalletAddress(activeWallet.address);
        setStatus("ready");
        setMessage("");
        return;
      }

      if (activeWallet?.kind === "circle") {
        setWalletKind("circle");
        setBrowserWalletName("");
      }

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

    function syncSharedWallet() {
      const activeWallet = readActiveWallet();

      if (!activeWallet) {
        setWalletKind(null);
        setBrowserWalletName("");
        setWalletAddress("");
        return;
      }

      setWalletKind(activeWallet.kind);
      setWalletAddress(activeWallet.address);

      setBrowserWalletName(
        activeWallet.kind === "browser"
          ? activeWallet.providerName
          : "",
      );
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

    window.addEventListener(
      SHOWUP_WALLET_CHANGED_EVENT,
      syncSharedWallet,
    );

    document.addEventListener(
      "mousedown",
      handleOutsideClick,
    );

    return () => {
      cancelled = true;

      window.removeEventListener(
        SHOWUP_WALLET_CHANGED_EVENT,
        syncSharedWallet,
      );

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

          console.info(
            "Circle wallet setup challenge result:",
            {
              errorCode: error?.code,
              errorMessage: error?.message,
              type: result?.type,
              status: result?.status,
            },
          );

          if (
            result?.status === "FAILED" ||
            result?.status === "EXPIRED"
          ) {
            setStatus("error");
            setMessage(
              error?.message ||
                `Circle wallet setup ended with status: ${result.status}.`,
            );
            return;
          }

          const errorCode = error?.code;

          const shouldReconcileSdkError =
            !error ||
            errorCode === -1 ||
            errorCode === 9 ||
            errorCode === 11 ||
            errorCode === 155706 ||
            typeof errorCode !== "number";

          if (error && !shouldReconcileSdkError) {
            setStatus("error");
            setMessage(
              error.message ||
                `Circle wallet setup failed (${errorCode}).`,
            );
            return;
          }

          if (error) {
            console.warn(
              "Circle returned a transient or unknown error after wallet setup. Checking the actual wallet state before showing a failure.",
              {
                code: errorCode,
                message: error.message,
              },
            );
          }

          try {
            setMessage(
              "Verifying your Circle wallet...",
            );

            // Give Circle a short window to index the wallet
            // after the secure PIN challenge finishes.
            await wait(2000);

            await finishWalletConnection(
              session.userToken,
              12,
            );
          } catch (walletError) {
            console.error(
              "Circle wallet reconciliation failed after setup:",
              walletError,
            );

            setStatus("error");
            setMessage(
              error?.message ||
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
    setCopiedWalletId("");
    setMessage("");
    setMenuOpen(false);
    setWalletChooserOpen(false);
  }

  async function handleCopyAddress(
    wallet: WalletDetails,
  ) {
    if (!wallet.id || !wallet.address) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          wallet.address,
        );
      } else {
        copyWithFallback(wallet.address);
      }

      setCopiedWalletId(wallet.id);

      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }

      copiedTimeoutRef.current = setTimeout(() => {
        setCopiedWalletId("");
      }, 1800);
    } catch (error) {
      console.error(
        "Unable to copy wallet address:",
        error,
      );

      copyWithFallback(wallet.address);
      setCopiedWalletId(wallet.id);
    }
  }

  async function handleCopyBrowserAddress() {
    if (!walletAddress) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          walletAddress,
        );
      } else {
        copyWithFallback(walletAddress);
      }

      setCopiedWalletId("browser");

      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }

      copiedTimeoutRef.current = setTimeout(() => {
        setCopiedWalletId("");
      }, 1800);
    } catch (error) {
      console.error(
        "Unable to copy browser wallet address:",
        error,
      );

      copyWithFallback(walletAddress);
      setCopiedWalletId("browser");
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
    setCopiedWalletId("");
  }

  async function handleRenameWallet(
    wallet: WalletDetails,
  ) {
    if (status === "loading") {
      return;
    }

    const currentName =
      wallet.name?.trim() ||
      "ShowUp Wallet";

    const requestedName =
      window.prompt(
        "Enter a new name for this wallet:",
        currentName,
      );

    if (requestedName === null) {
      return;
    }

    const walletName =
      requestedName.trim();

    if (!walletName) {
      setStatus("error");
      setMessage(
        "Wallet name cannot be empty.",
      );
      return;
    }

    if (walletName.length > 64) {
      setStatus("error");
      setMessage(
        "Wallet name must be 64 characters or fewer.",
      );
      return;
    }

    if (walletName === currentName) {
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
        "Connect or restore your Circle account before renaming a wallet.",
      );
      return;
    }

    try {
      setMenuOpen(false);
      setWalletChooserOpen(false);
      setStatus("loading");
      setMessage(
        "Renaming your Circle wallet...",
      );

      const session =
        await requestCircleSession(
          savedUserId,
        );

      await requestWalletRename(
        session.userToken,
        wallet.id,
        walletName,
      );

      setWallets(
        (currentWallets) =>
          currentWallets.map(
            (currentWallet) =>
              currentWallet.id ===
              wallet.id
                ? {
                    ...currentWallet,
                    name:
                      walletName,
                  }
                : currentWallet,
          ),
      );

      setStatus("ready");
      setMessage("");
      setMenuOpen(true);
    } catch (error) {
      console.error(
        "Circle wallet rename failed:",
        error,
      );

      setStatus("error");
      setMessage(
        getErrorMessage(
          error,
        ),
      );
    }
  }

  async function handleCreateNewWallet() {
    if (status === "loading") {
      return;
    }

    const walletReady =
      window.localStorage.getItem(
        CIRCLE_WALLET_READY_KEY,
      ) === "true";

    /*
     * A saved Circle user ID does not necessarily mean that
     * PIN setup was completed. This can happen when the user
     * leaves the initial Circle challenge before completion.
     *
     * In that state, resume initialization instead of asking
     * Circle to create an additional wallet, which would fail
     * with error 155110 (PIN not set).
     */
    if (!walletReady || wallets.length === 0) {
      await handleConnect(false);
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
        getNextWalletName(
          wallets,
        );

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

  async function handleConnectBrowserWallet(
    walletProvider: BrowserWalletProviderDetail,
  ) {
    if (status === "loading") {
      return;
    }

    try {
      setStatus("loading");
      setMessage(
        `Connecting ${walletProvider.info.name}...`,
      );

      const connection =
        await connectBrowserWallet(
          walletProvider.provider,
        );

      setMessage(
        `Authorize ${walletProvider.info.name}...`,
      );

      await authorizeBrowserWallet({
        providerRdns:
          walletProvider.info.rdns,
        expectedAddress:
          connection.address,
      });

      clearWalletStorage(true);

      saveActiveWallet({
        kind: "browser",
        address: connection.address,
        providerRdns: walletProvider.info.rdns,
        providerName: walletProvider.info.name,
      });

      setWalletKind("browser");
      setBrowserWalletName(walletProvider.info.name);
      setWalletAddress(connection.address);
      setWallets([]);
      setActiveWalletId("");
      setStatus("ready");
      setMessage("");
      setMenuOpen(false);
      setWalletChooserOpen(false);
    } catch (error) {
      console.error(
        "Browser wallet connection failed:",
        error,
      );

      setStatus("error");
      setMessage(getErrorMessage(error));
    }
  }

  async function toggleWalletChooser() {
    if (status === "loading") {
      return;
    }

    const willOpen = !walletChooserOpen;

    setMenuOpen(false);
    setWalletChooserOpen(willOpen);
    setMessage("");

    if (status === "error") {
      setStatus("idle");
    }

    if (!willOpen) {
      return;
    }

    try {
      const providers =
        await discoverBrowserWallets();

      setBrowserWallets(providers);
    } catch (error) {
      console.error(
        "Browser wallet discovery failed:",
        error,
      );

      setBrowserWallets([]);
    }
  }

  const supportedEvmWallets = [
    "rabby",
    "metamask",
    "coinbase",
    "okx",
  ];

  const getWalletSearchValue = (
    walletProvider: BrowserWalletProviderDetail,
  ) =>
    `${walletProvider.info.name} ${walletProvider.info.rdns}`
      .toLowerCase();

  const featuredBrowserWallets =
    supportedEvmWallets
      .map((keyword) =>
        browserWallets.find((walletProvider) =>
          getWalletSearchValue(
            walletProvider,
          ).includes(keyword),
        ),
      )
      .filter(
        (
          walletProvider,
        ): walletProvider is BrowserWalletProviderDetail =>
          Boolean(walletProvider),
      );

  const buttonLabel =
    status === "loading"
      ? "Connecting..."
      : "Connect Wallet";

  return (
    <>
      <div
        ref={menuRef}
        className="relative z-[200] flex flex-col items-end"
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
              className="flex items-center gap-2 rounded-full border border-[#73d8ff]/30 bg-[#73d8ff]/15 px-4 py-2.5 text-sm font-medium text-[#b8e8ff] transition hover:border-[#73d8ff]/60 hover:bg-[#73d8ff]/20"
            >
              <span className="h-2 w-2 rounded-full bg-[#73d8ff]" />

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
                className="absolute right-0 top-full z-[220] mt-3 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#0a1025]/95 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
              >
                <div className="px-2 pb-3 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#73d8ff]">
                      {walletKind === "browser"
                        ? browserWalletName || "Browser wallet"
                        : "Circle wallet"}
                    </p>

                    <span className="rounded-full bg-[#73d8ff]/10 px-2 py-1 text-[10px] font-medium text-[#b8e8ff]">
                      Arc Testnet
                    </span>
                  </div>

                  <p className="mt-3 break-all font-mono text-xs leading-5 text-white/55">
                    {walletAddress}
                  </p>
                </div>

                <div className="h-px bg-white/10" />

                {walletKind === "circle" && (
                  <>
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

                      const displayName =
                        wallet.name ||
                        `Wallet ${index + 1}`;

                      return (
                        <div
                          key={wallet.id}
                          className={`flex w-full items-center gap-2 rounded-xl border px-2 py-2 transition ${
                            isActive
                              ? "border-[#73d8ff]/30 bg-[#73d8ff]/10"
                              : "border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.06]"
                          }`}
                        >
                      <button
                        type="button"
                        onClick={() => {
                          handleSwitchWallet(wallet);
                        }}
                        className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left"
                      >
                        <span className="block min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate text-xs font-medium text-white/75">
                              {displayName}
                            </span>

                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                                isActive
                                  ? "bg-[#73d8ff]/15 text-[#b8e8ff]"
                                  : "bg-white/[0.06] text-white/35"
                              }`}
                            >
                              {isActive ? "Active" : "Switch"}
                            </span>
                          </span>

                          <span className="mt-1 block truncate font-mono text-[11px] text-white/40">
                            {shortenAddress(wallet.address)}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-label={`Copy ${displayName} address`}
                        onClick={() => {
                          void handleCopyAddress(
                            wallet,
                          );
                        }}
                        className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-medium text-white/45 transition hover:border-[#73d8ff]/25 hover:bg-[#73d8ff]/10 hover:text-[#b8e8ff]"
                      >
                        {copiedWalletId === wallet.id
                          ? "Copied"
                          : "Copy"}
                      </button>

                          <button
                            type="button"
                            aria-label={`Rename ${displayName}`}
                            onClick={() => {
                              void handleRenameWallet(
                                wallet,
                              );
                            }}
                            className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-medium text-white/45 transition hover:border-[#73d8ff]/25 hover:bg-[#73d8ff]/10 hover:text-[#b8e8ff]"
                          >
                            Rename
                          </button>
                        </div>
                      );
                    })}
                  </div>
                    </div>

                    <div className="h-px bg-white/10" />
                  </>
                )}

                <div className="space-y-1 pt-2">

                  {walletKind === "circle" && (
                    <>
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
                    </>
                  )}

              {walletKind === "browser" && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void handleCopyBrowserAddress();
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <span>Copy address</span>

                  <span className="text-xs text-[#73d8ff]">
                    {copiedWalletId === "browser"
                      ? "Copied"
                      : "Copy"}
                  </span>
                </button>
              )}

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
              className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:border-[#73d8ff]/60 hover:bg-[#73d8ff]/10 disabled:cursor-wait disabled:opacity-70"
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

            {walletChooserOpen &&
              typeof document !== "undefined" &&
              createPortal(
              <div
                role="presentation"
                onMouseDown={() => {
                  setWalletChooserOpen(false);
                }}
                className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 px-4 py-3 backdrop-blur-sm"
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="wallet-modal-title"
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  className="max-h-[calc(100vh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/10 bg-[#070b18] p-5 shadow-2xl shadow-black/70 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <p
                        id="wallet-modal-title"
                        className="text-2xl font-semibold tracking-tight text-white"
                      >
                        Connect Wallet
                      </p>

                      <p className="mt-2 text-sm leading-6 text-white/45">
                        Choose how you want to connect to ShowUp
                        on Arc Testnet.
                      </p>
                    </div>

                    <button
                      type="button"
                      aria-label="Close wallet selection"
                      onClick={() => {
                        setWalletChooserOpen(false);
                      }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-xl text-white/55 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#73d8ff]">
                        EVM wallets
                      </p>

                      <span className="rounded-full bg-[#73d8ff]/10 px-2.5 py-1 text-[10px] font-medium text-[#b8e8ff]">
                        Arc Testnet
                      </span>
                    </div>

                    {featuredBrowserWallets.length > 0 ? (
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {featuredBrowserWallets.map(
                          (walletProvider) => (
                            <button
                              key={walletProvider.info.uuid}
                              type="button"
                              onClick={() => {
                                void handleConnectBrowserWallet(
                                  walletProvider,
                                );
                              }}
                              className="group flex min-h-24 flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-center transition hover:border-[#73d8ff]/35 hover:bg-[#73d8ff]/10"
                            >
                              {walletProvider.info.icon ? (
                                <span
                                  aria-hidden="true"
                                  className="h-12 w-12 rounded-2xl bg-contain bg-center bg-no-repeat"
                                  style={{
                                    backgroundImage:
                                      `url("${walletProvider.info.icon}")`,
                                  }}
                                />
                              ) : (
                                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-lg font-semibold text-white/70">
                                  {walletProvider.info.name.slice(
                                    0,
                                    1,
                                  )}
                                </span>
                              )}

                              <span className="mt-3 block max-w-full text-center text-sm font-medium leading-5 text-white/80 group-hover:text-white">
                                {walletProvider.info.name}
                              </span>

                              <span className="mt-1 text-[10px] text-white/30">
                                Installed
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-4 text-sm leading-6 text-white/45">
                        No supported EVM wallet was detected.
                        Install Rabby, MetaMask, Coinbase Wallet,
                        or OKX Wallet.
                      </div>
                    )}
                  </div>

                  <div className="my-5 h-px bg-white/10" />

                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                        Solana wallets
                      </p>

                      <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/35">
                        Coming next
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {[
                        {
                          name: "Phantom",
                          mark: "P",
                        },
                        {
                          name: "Backpack",
                          mark: "B",
                        },
                        {
                          name: "Solflare",
                          mark: "S",
                        },
                      ].map((wallet) => (
                        <div
                          key={wallet.name}
                          className="flex min-h-20 flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02] px-2 py-3 text-center opacity-60"
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] text-xs font-semibold text-white/55">
                            {wallet.mark}
                          </span>

                          <span className="mt-3 text-xs font-medium text-white/55">
                            {wallet.name}
                          </span>
                        </div>
                      ))}
                    </div>

                    <p className="mt-3 text-xs leading-5 text-white/35">
                      Solana wallet connection will be enabled
                      with the USDC bridge flow.
                    </p>
                  </div>

                  <div className="my-7 flex items-center gap-4">
                    <div className="h-px flex-1 bg-white/10" />

                    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/30">
                      Circle
                    </span>

                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {hasSavedUserId && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleConnect(false);
                        }}
                        className="rounded-2xl border border-[#73d8ff]/20 bg-[#73d8ff]/[0.07] px-3 py-3 text-left transition hover:border-[#73d8ff]/40 hover:bg-[#73d8ff]/10"
                      >
                        <span className="block text-sm font-medium text-white/80">
                          Resume Circle wallet
                        </span>

                        <span className="mt-1 block text-xs leading-5 text-white/40">
                          Continue with the wallet saved in this
                          browser.
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        openRecoveryDialog("restore");
                      }}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.05]"
                    >
                      <span className="block text-sm font-medium text-white/80">
                        Restore Circle account
                      </span>

                      <span className="mt-1 block text-xs leading-5 text-white/40">
                        Use an existing ShowUp recovery code.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (hasSavedUserId) {
                          void handleCreateNewWallet();
                          return;
                        }

                        void handleConnect(true);
                      }}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.05]"
                    >
                      <span className="block text-sm font-medium text-white/80">
                        Create new Circle wallet
                      </span>

                      <span className="mt-1 block text-xs leading-5 text-white/40">
                        Create a PIN-secured wallet directly on
                        Arc Testnet.
                      </span>
                    </button>
                  </div>

                  <p className="mt-6 text-center text-[11px] text-white/25">
                    ShowUp · Circle Wallets · USDC · Arc Testnet
                  </p>
                </div>
              </div>,
                document.body,
              )}
          </>
        )}

        {message && status !== "ready" && (
          <p
            aria-live="polite"
            className={`absolute right-0 top-full z-[220] mt-2 w-72 rounded-xl border px-3 py-2 text-xs leading-5 shadow-xl backdrop-blur ${
              status === "error"
                ? "border-red-400/25 bg-red-950/90 text-red-200"
                : "border-white/10 bg-[#0a1025]/95 text-white/65"
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
