"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";

import CircleWalletButton from "@/components/circle-wallet-button";
import { withCircleBrowserFetch } from "@/lib/circle-browser-fetch";
import {
  createShowUpAppKitContext,
  SHOWUP_BRIDGE_CHAINS,
  SHOWUP_SWAP_CHAIN,
} from "@/lib/showup-app-kit";
import {
  readActiveWallet,
  SHOWUP_WALLET_CHANGED_EVENT,
  type ShowUpWallet,
} from "@/lib/showup-wallet";

type WalletToolTab = "bridge" | "swap";

type BridgeDirection =
  | "ethereum-to-arc"
  | "arc-to-ethereum";

type SwapDirection =
  | "usdc-to-eurc"
  | "eurc-to-usdc";

type BridgeUiStatus =
  | "idle"
  | "working"
  | "pending"
  | "success"
  | "error";

type WalletToolBalances = {
  ethereumSepolia: {
    USDC: string;
  };
  arcTestnet: {
    USDC: string;
    EURC: string;
  };
};

type BridgeExplorerLink = {
  name: string;
  url: string;
};

function getErrorMessage(
  error: unknown,
) {
  if (error instanceof Error) {
    return error.message;
  }

  return "The transaction could not be completed.";
}

function shortenWalletAddress(
  address: string,
) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function fetchWalletToolBalances(
  address: string,
): Promise<WalletToolBalances> {
  const response = await fetch(
    `/api/wallet-tools/balances?address=${encodeURIComponent(address)}`,
    {
      cache: "no-store",
    },
  );

  const payload = (await response.json()) as {
    balances?: WalletToolBalances;
    error?: string;
  };

  if (!response.ok || !payload.balances) {
    throw new Error(
      payload.error ??
        "Unable to load wallet balances.",
    );
  }

  return payload.balances;
}

export default function WalletToolsPage() {

  const [activeTab, setActiveTab] =
    useState<WalletToolTab>("bridge");

  const [
    bridgeDirection,
    setBridgeDirection,
  ] = useState<BridgeDirection>(
    "ethereum-to-arc",
  );

  const [activeWallet, setActiveWallet] =
    useState<ShowUpWallet | null>(null);

  const [amount, setAmount] =
    useState("");

  const [bridgeStatus, setBridgeStatus] =
    useState<BridgeUiStatus>("idle");

  const [bridgeMessage, setBridgeMessage] =
    useState("");

  const [
    bridgeExplorerLinks,
    setBridgeExplorerLinks,
  ] = useState<BridgeExplorerLink[]>([]);

  const [
    swapDirection,
    setSwapDirection,
  ] = useState<SwapDirection>(
    "usdc-to-eurc",
  );

  const [swapStatus, setSwapStatus] =
    useState<BridgeUiStatus>("idle");

  const [swapMessage, setSwapMessage] =
    useState("");

  const [
    swapExplorerUrl,
    setSwapExplorerUrl,
  ] = useState("");

  const [swapAmountOut, setSwapAmountOut] =
    useState("");

  const [balances, setBalances] =
    useState<WalletToolBalances | null>(null);

  const [balancesLoading, setBalancesLoading] =
    useState(false);

  const [balancesError, setBalancesError] =
    useState("");

  useEffect(() => {
    function syncActiveWallet() {
      setActiveWallet(
        readActiveWallet(),
      );
    }

    const timeoutId = window.setTimeout(
      syncActiveWallet,
      0,
    );

    window.addEventListener(
      SHOWUP_WALLET_CHANGED_EVENT,
      syncActiveWallet,
    );

    return () => {
      window.clearTimeout(timeoutId);

      window.removeEventListener(
        SHOWUP_WALLET_CHANGED_EVENT,
        syncActiveWallet,
      );
    };
  }, []);

  useEffect(() => {
    const address =
      activeWallet?.kind === "browser"
        ? activeWallet.address
        : null;

    let cancelled = false;

    const timeoutId = window.setTimeout(
      () => {
        if (cancelled) {
          return;
        }

        if (!address) {
          setBalances(null);
          setBalancesLoading(false);
          setBalancesError("");
          return;
        }

        setBalances(null);
        setBalancesLoading(true);
        setBalancesError("");

        void fetchWalletToolBalances(address)
          .then((nextBalances) => {
            if (!cancelled) {
              setBalances(nextBalances);
            }
          })
          .catch((error: unknown) => {
            if (!cancelled) {
              setBalances(null);
              setBalancesError(
                getErrorMessage(error),
              );
            }
          })
          .finally(() => {
            if (!cancelled) {
              setBalancesLoading(false);
            }
          });
      },
      0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeWallet]);

  const isBridge =
    activeTab === "bridge";

  const bridgeFromEthereum =
    bridgeDirection === "ethereum-to-arc";

  const bridgeSourceChain =
    bridgeFromEthereum
      ? SHOWUP_BRIDGE_CHAINS.ethereumSepolia
      : SHOWUP_BRIDGE_CHAINS.arcTestnet;

  const bridgeDestinationChain =
    bridgeFromEthereum
      ? SHOWUP_BRIDGE_CHAINS.arcTestnet
      : SHOWUP_BRIDGE_CHAINS.ethereumSepolia;

  const bridgeSourceLabel =
    bridgeFromEthereum
      ? "Ethereum Sepolia"
      : "Arc Testnet";

  const bridgeDestinationLabel =
    bridgeFromEthereum
      ? "Arc Testnet"
      : "Ethereum Sepolia";

  const swapFromUsdc =
    swapDirection === "usdc-to-eurc";

  const swapTokenIn =
    swapFromUsdc ? "USDC" : "EURC";

  const swapTokenOut =
    swapFromUsdc ? "EURC" : "USDC";

  const browserWalletReady =
    activeWallet?.kind === "browser";

  const ethereumSepoliaUsdcBalance =
    balances?.ethereumSepolia.USDC;

  const arcTestnetUsdcBalance =
    balances?.arcTestnet.USDC;

  const arcTestnetEurcBalance =
    balances?.arcTestnet.EURC;

  const bridgeSourceBalance =
    bridgeFromEthereum
      ? ethereumSepoliaUsdcBalance
      : arcTestnetUsdcBalance;

  const bridgeDestinationBalance =
    bridgeFromEthereum
      ? arcTestnetUsdcBalance
      : ethereumSepoliaUsdcBalance;

  const swapInputBalance =
    swapFromUsdc
      ? arcTestnetUsdcBalance
      : arcTestnetEurcBalance;

  const swapOutputBalance =
    swapFromUsdc
      ? arcTestnetEurcBalance
      : arcTestnetUsdcBalance;

  function getBalanceText(
    balance: string | undefined,
    token: string,
  ) {
    if (!browserWalletReady) {
      return "Balance: —";
    }

    if (balancesLoading && !balances) {
      return "Balance: Loading...";
    }

    if (balance === undefined) {
      return balancesError
        ? "Balance: Unavailable"
        : "Balance: —";
    }

    return `Balance: ${balance} ${token}`;
  }

  async function refreshBalances() {
    if (activeWallet?.kind !== "browser") {
      return;
    }

    try {
      setBalancesLoading(true);
      setBalancesError("");

      const nextBalances =
        await fetchWalletToolBalances(
          activeWallet.address,
        );

      setBalances(nextBalances);
    } catch (error) {
      setBalancesError(
        getErrorMessage(error),
      );
    } finally {
      setBalancesLoading(false);
    }
  }

  const walletStatus =
    !activeWallet
      ? "No wallet connected"
      : activeWallet.kind === "circle"
        ? "Circle wallet connected"
        : `${activeWallet.providerName} · ${shortenWalletAddress(
            activeWallet.address,
          )}`;

  const walletHelp =
    !activeWallet
      ? "Connect MetaMask, Rabby, Coinbase Wallet, or OKX."
      : activeWallet.kind === "circle"
        ? "Switch to a browser wallet to use Bridge and Swap."
        : "Browser wallet ready for transaction setup.";

  const parsedAmount =
    Number(amount);

  const validBridgeAmount =
    /^\d+(\.\d+)?$/.test(amount) &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  const bridgeBusy =
    bridgeStatus === "working" ||
    bridgeStatus === "pending";

  const bridgeLocked =
    bridgeBusy ||
    bridgeStatus === "success";

  const swapBusy =
    swapStatus === "working" ||
    swapStatus === "pending";

  const swapLocked =
    swapBusy ||
    swapStatus === "success";

  async function handleBridge() {
    if (
      !browserWalletReady ||
      !isBridge ||
      !validBridgeAmount ||
      bridgeLocked
    ) {
      return;
    }

    setBridgeStatus("working");
    setBridgeMessage(
      `Preparing the ${bridgeSourceLabel} bridge transaction...`,
    );
    setBridgeExplorerLinks([]);

    try {
      const {
        adapter,
        kit,
      } =
        await createShowUpAppKitContext();

      const result =
        await kit.bridge({
          from: {
            adapter,
            chain: bridgeSourceChain,
          },
          to: {
            adapter,
            chain: bridgeDestinationChain,
          },
          amount,
          token: "USDC",
        });

      const explorerLinkMap =
        new Map<string, string[]>();

      for (const step of result.steps) {
        if (!step.explorerUrl) {
          continue;
        }

        const names =
          explorerLinkMap.get(
            step.explorerUrl,
          ) ?? [];

        if (!names.includes(step.name)) {
          names.push(step.name);
        }

        explorerLinkMap.set(
          step.explorerUrl,
          names,
        );
      }

      const explorerLinks =
        [...explorerLinkMap.entries()].map(
          ([url, names]) => ({
            url,
            name: names.join(" + "),
          }),
        );

      setBridgeExplorerLinks(
        explorerLinks,
      );

      if (result.state === "error") {
        const failedStep =
          result.steps.find(
            (step) =>
              step.state === "error",
          );

        throw new Error(
          failedStep?.errorMessage ??
            "The bridge returned an error.",
        );
      }

      if (result.state === "pending") {
        setBridgeStatus("pending");
        setBridgeMessage(
          `${result.amount} USDC was submitted. The destination mint is still processing.`,
        );
        return;
      }

      setBridgeStatus("success");
      setBridgeMessage(
        `${result.amount} USDC was bridged successfully to ${bridgeDestinationLabel}.`,
      );

      await refreshBalances();
    } catch (error) {
      console.error(
        "ShowUp bridge failed:",
        error,
      );

      setBridgeStatus("error");
      setBridgeMessage(
        getErrorMessage(error),
      );
    }
  }

  async function handleSwap() {
    if (
      !browserWalletReady ||
      isBridge ||
      !validBridgeAmount ||
      swapLocked
    ) {
      return;
    }

    setSwapStatus("working");
    setSwapMessage(
      `Preparing the ${swapTokenIn} to ${swapTokenOut} swap on Arc Testnet...`,
    );
    setSwapExplorerUrl("");
    setSwapAmountOut("");

    try {
      const {
        adapter,
        kit,
      } =
        await createShowUpAppKitContext();

      const result =
        await withCircleBrowserFetch(
          () =>
            kit.swap({
              from: {
                adapter,
                chain: SHOWUP_SWAP_CHAIN,
              },
              tokenIn: swapTokenIn,
              tokenOut: swapTokenOut,
              amountIn: amount,
              config: {
                slippageBps: 100,
              },
            }),
        );

      setSwapExplorerUrl(
        result.explorerUrl ?? "",
      );

      if (
        result.progress.status === "FAILED" ||
        result.progress.status === "NOT_FOUND"
      ) {
        throw new Error(
          result.progress.substatusMessage ??
            `Swap finished with status ${result.progress.status}.`,
        );
      }

      if (
        result.progress.status === "PENDING"
      ) {
        setSwapStatus("pending");
        setSwapMessage(
          result.progress.substatusMessage ??
            "The swap was submitted and is still processing.",
        );
        return;
      }

      setSwapStatus("success");
      setSwapAmountOut(
        result.amountOut ?? "",
      );

      setSwapMessage(
        result.amountOut
          ? `Swap completed. You received approximately ${result.amountOut} ${swapTokenOut}.`
          : `${swapTokenIn} was swapped to ${swapTokenOut} successfully.`,
      );

      await refreshBalances();
    } catch (error) {
      console.error(
        "ShowUp swap failed:",
        error,
      );

      setSwapStatus("error");
      setSwapMessage(
        getErrorMessage(error),
      );
    }
  }

  function handleBridgeDirectionChange() {
    if (bridgeBusy) {
      return;
    }

    setBridgeDirection(
      bridgeFromEthereum
        ? "arc-to-ethereum"
        : "ethereum-to-arc",
    );

    setBridgeStatus("idle");
    setBridgeMessage("");
    setBridgeExplorerLinks([]);
  }

  function handleSwapDirectionChange() {
    if (swapBusy) {
      return;
    }

    setSwapDirection(
      swapFromUsdc
        ? "eurc-to-usdc"
        : "usdc-to-eurc",
    );

    setSwapStatus("idle");
    setSwapMessage("");
    setSwapExplorerUrl("");
    setSwapAmountOut("");
  }

  function handleAmountChange(
    value: string,
  ) {
    if (
      !/^\d*(\.\d{0,6})?$/.test(
        value,
      )
    ) {
      return;
    }

    setAmount(value);

    setBridgeStatus("idle");
    setBridgeMessage("");
    setBridgeExplorerLinks([]);

    setSwapStatus("idle");
    setSwapMessage("");
    setSwapExplorerUrl("");
    setSwapAmountOut("");
  }

  return (
    <main className="min-h-screen bg-[#050817] text-white">
      <header className="relative z-20 border-b border-[#73baff]/15 bg-[#050817]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#73d8ff] to-[#9285ff] text-lg font-black text-[#050817] shadow-lg shadow-[#4b9cff]/20">
              S
            </div>

            <div>
              <p className="text-lg font-semibold tracking-tight">
                ShowUp
              </p>

              <p className="text-xs text-white/45">
                Wallet tools on Arc
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <Link
              href="/"
              className="transition hover:text-[#8fd8ff]"
            >
              Home
            </Link>

            <Link
              href="/events"
              className="transition hover:text-[#8fd8ff]"
            >
              Events
            </Link>

            <Link
              href="/create"
              className="transition hover:text-[#8fd8ff]"
            >
              Create
            </Link>
          </nav>

          <CircleWalletButton />
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-[28%] top-[-280px] h-[700px] w-[700px] rounded-full bg-[#288cff]/15 blur-[180px]" />

        <div className="pointer-events-none absolute right-[-200px] top-[160px] h-[520px] w-[520px] rounded-full bg-[#8d70ff]/12 blur-[170px]" />

        <div className="relative mx-auto max-w-5xl px-6 py-14 lg:px-10 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-[#72cfff]/25 bg-[#418cff]/10 px-4 py-2 text-sm text-[#9bddff]">
              <span className="h-2 w-2 rounded-full bg-[#75d7ff] shadow-[0_0_16px_rgba(117,215,255,0.95)]" />
              Arc Testnet wallet utilities
            </div>

            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Move and exchange assets
            </h1>

            <p className="mt-4 text-base leading-7 text-white/50">
              Bridge USDC between Ethereum Sepolia
              and Arc Testnet, or swap supported
              assets directly on Arc.
            </p>
          </div>

          <div className="mx-auto mt-8 max-w-xl rounded-[24px] border border-[#79b7ff]/18 bg-[#0b1025]/70 p-5 backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-white/85">Need test USDC?</p>
                <p className="mt-1 text-sm leading-6 text-white/45">Fund your wallet with the official Circle Arc Testnet faucet.</p>
              </div>

              <a href="https://faucet.circle.com/?allow=true" target="_blank" rel="noreferrer" className="shrink-0 rounded-2xl border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-3 text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15">Get test USDC</a>
            </div>
          </div>


      <div className="mx-auto mt-10 max-w-xl rounded-[30px] border border-[#79b7ff]/18 bg-[#0b1025]/85 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="grid grid-cols-2 gap-2 rounded-[22px] border border-[#79b7ff]/12 bg-[#070c1d] p-1.5">
              <button
                type="button"
                onClick={() =>
                  setActiveTab("bridge")
                }
                className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  isBridge
                    ? "bg-gradient-to-r from-[#73d8ff] to-[#8195ff] text-[#050817]"
                    : "text-white/45 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                Bridge
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveTab("swap")
                }
                className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  !isBridge
                    ? "bg-gradient-to-r from-[#73d8ff] to-[#8195ff] text-[#050817]"
                    : "text-white/45 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                Swap
              </button>
            </div>

            <div className="mt-3 rounded-[24px] border border-[#79b7ff]/12 bg-[#070c1d] p-5 sm:p-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#8fd8ff]">
                  {isBridge
                    ? "Cross-chain transfer"
                    : "Onchain exchange"}
                </p>

                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  {isBridge
                    ? "Bridge USDC"
                    : "Swap on Arc"}
                </h2>

                <p className="mt-2 text-sm leading-6 text-white/42">
                  {isBridge
                    ? "Move testnet USDC between Ethereum Sepolia and Arc Testnet."
                    : "Exchange supported assets using your connected browser wallet."}
                </p>
              </div>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] p-4">
                  <p className="text-xs text-white/35">
                    Connected wallet
                  </p>

                  <p className="mt-2 font-medium text-white/80">
                    {walletStatus}
                  </p>

                  <p className="mt-1 text-xs leading-5 text-white/35">
                    {walletHelp}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] p-4">
                  <p className="text-xs text-white/35">
                    {isBridge
                      ? "From network"
                      : "You pay"}
                  </p>

                  <p className="mt-2 font-medium text-white/75">
                    {isBridge
                      ? bridgeSourceLabel
                      : `${swapTokenIn} on Arc Testnet`}
                  </p>

                  <p className="mt-1 text-xs text-white/45">
                    {getBalanceText(
                      isBridge
                        ? bridgeSourceBalance
                        : swapInputBalance,
                      isBridge
                        ? "USDC"
                        : swapTokenIn,
                    )}
                  </p>
                </div>

                <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={
                        isBridge
                          ? handleBridgeDirectionChange
                          : handleSwapDirectionChange
                      }
                      disabled={
                        isBridge
                          ? bridgeBusy
                          : swapBusy
                      }
                      aria-label={
                        isBridge
                          ? "Reverse bridge direction"
                          : "Reverse swap direction"
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-[#79b7ff]/18 bg-[#111a36] text-lg text-[#8fd8ff] transition hover:border-[#79b7ff]/40 hover:bg-[#172142] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      ⇅
                    </button>
                </div>

                <div className="rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] p-4">
                  <p className="text-xs text-white/35">
                    {isBridge
                      ? "To network"
                      : "You receive"}
                  </p>

                  <p className="mt-2 font-medium text-white/75">
                    {isBridge
                      ? bridgeDestinationLabel
                      : `${swapTokenOut} on Arc Testnet`}
                  </p>

                  <p className="mt-1 text-xs text-white/45">
                    {getBalanceText(
                      isBridge
                        ? bridgeDestinationBalance
                        : swapOutputBalance,
                      isBridge
                        ? "USDC"
                        : swapTokenOut,
                    )}
                  </p>
                </div>

                <label className="block">
                  <span className="text-xs text-white/35">
                    Amount
                  </span>

                  <div className="mt-2 flex items-center gap-3 rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] px-4 py-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(event) =>
                        handleAmountChange(
                          event.target.value,
                        )
                      }
                      disabled={
                        !browserWalletReady
                      }
                      className="min-w-0 flex-1 bg-transparent text-lg font-medium outline-none placeholder:text-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                    />

                    <span className="text-sm font-semibold text-white/60">
                      {isBridge
                        ? "USDC"
                        : swapTokenIn}
                    </span>
                  </div>
                </label>
              </div>

                <button
                  type="button"
                  onClick={() => {
                    if (isBridge) {
                      void handleBridge();
                      return;
                    }

                    void handleSwap();
                  }}
                  disabled={
                    !browserWalletReady ||
                    !validBridgeAmount ||
                    (isBridge
                      ? bridgeLocked
                      : swapLocked)
                  }
                  className="mt-6 w-full rounded-full bg-gradient-to-r from-[#73d8ff] to-[#8195ff] px-6 py-3.5 font-semibold text-[#050817] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {!activeWallet
                    ? "Connect browser wallet to continue"
                    : activeWallet.kind === "circle"
                      ? "Browser wallet required"
                      : isBridge
                        ? bridgeStatus === "working"
                          ? "Confirm in your wallet..."
                          : bridgeStatus === "pending"
                            ? "Bridge processing"
                            : bridgeStatus === "success"
                              ? "Bridge completed"
                              : validBridgeAmount
                                ? `Bridge USDC to ${
                                    bridgeFromEthereum
                                      ? "Arc"
                                      : "Ethereum"
                                  }`
                                : "Enter an amount"
                        : swapStatus === "working"
                          ? "Confirm in your wallet..."
                          : swapStatus === "pending"
                            ? "Swap processing"
                            : swapStatus === "success"
                              ? "Swap completed"
                              : validBridgeAmount
                                ? `Swap ${swapTokenIn} to ${swapTokenOut}`
                                : "Enter an amount"}
                </button>

                {(isBridge
                  ? bridgeMessage
                  : swapMessage) && (
                  <div
                    className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
                      (isBridge
                        ? bridgeStatus
                        : swapStatus) === "error"
                        ? "border-red-400/20 bg-red-400/10 text-red-100"
                        : "border-[#73d8ff]/20 bg-[#418cff]/10 text-[#b9e8ff]"
                    }`}
                  >
                    {isBridge
                      ? bridgeMessage
                      : swapMessage}

                    {!isBridge &&
                      swapStatus === "success" &&
                      swapAmountOut && (
                        <p className="mt-2 text-xs text-white/55">
                          Received: {swapAmountOut}{" "}
                          {swapTokenOut}
                        </p>
                      )}
                  </div>
                )}

                {isBridge &&
                  bridgeExplorerLinks.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {bridgeExplorerLinks.map(
                        (link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] px-4 py-3 text-sm text-[#8fd8ff] transition hover:border-[#79b7ff]/30"
                          >
                            View {link.name} transaction
                          </a>
                        ),
                      )}
                    </div>
                  )}

                {!isBridge &&
                  swapExplorerUrl && (
                    <a
                      href={swapExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 block rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] px-4 py-3 text-sm text-[#8fd8ff] transition hover:border-[#79b7ff]/30"
                    >
                      View swap transaction
                    </a>
                  )}

              <p className="mt-4 text-center text-xs leading-5 text-white/30">
                Browser wallets only during the
                initial Bridge and Swap release.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
