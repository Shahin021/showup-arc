"use client";

import {
  useEffect,
  useState,
} from "react";
import { isAddress } from "viem";

import ShowUpHeader from "@/components/showup-header";
import { withCircleBrowserFetch } from "@/lib/circle-browser-fetch";
import {
  executeCircleToolChallenge,
  requestCircleToolSession,
  requestCircleToolWallets,
  waitForCircleToolForwarding,
  waitForCircleToolTransaction,
  type CircleToolWallet,
} from "@/lib/circle-wallet-tools";
import {
  createShowUpAppKitContext,
  createShowUpCircleSwapAppKitContext,
  SHOWUP_BRIDGE_CHAINS,
  SHOWUP_SWAP_CHAIN,
} from "@/lib/showup-app-kit";
import {
  readActiveWallet,
  SHOWUP_WALLET_CHANGED_EVENT,
  type ShowUpWallet,
} from "@/lib/showup-wallet";

const CIRCLE_USER_ID_KEY =
  "showup_circle_user_id";

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

type CircleBridgeChallengeResponse = {
  challengeId?: string;
  refId?: string;
  createdAfter?: string;
  error?: string;
};

async function requestCircleBridgeChallenge(
  endpoint: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(payload),
    },
  );

  const data =
    (await response
      .json()
      .catch(
        () => ({}),
      )) as CircleBridgeChallengeResponse;

  if (
    !response.ok ||
    !data.challengeId ||
    !data.refId ||
    !data.createdAfter
  ) {
    throw new Error(
      data.error ??
        "Unable to prepare the Circle bridge transaction.",
    );
  }

  return {
    challengeId: data.challengeId,
    refId: data.refId,
    createdAfter: data.createdAfter,
  };
}

function getCircleBridgeExplorerUrl(
  blockchain: "ARC-TESTNET" | "ETH-SEPOLIA",
  transactionHash: string,
) {
  return blockchain === "ARC-TESTNET"
    ? `https://testnet.arcscan.app/tx/${transactionHash}`
    : `https://sepolia.etherscan.io/tx/${transactionHash}`;
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
  const [recipientAddress, setRecipientAddress] = useState("");

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

  const [
    circleArcWallet,
    setCircleArcWallet,
  ] = useState<CircleToolWallet | null>(null);

  const [
    circleSepoliaWallet,
    setCircleSepoliaWallet,
  ] = useState<CircleToolWallet | null>(null);

  useEffect(() => {
    function syncActiveWallet() {
      setActiveWallet(
        readActiveWallet(),
      );

      setRecipientAddress("");
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
    let cancelled = false;

    const timeoutId = window.setTimeout(
      () => {
        if (cancelled) {
          return;
        }

        if (!activeWallet) {
          setBalances(null);
          setCircleArcWallet(null);
          setCircleSepoliaWallet(null);
          setBalancesLoading(false);
          setBalancesError("");
          return;
        }

        setBalances(null);
        setCircleArcWallet(null);
        setCircleSepoliaWallet(null);
        setBalancesLoading(true);
        setBalancesError("");

        if (activeWallet.kind === "browser") {
          void fetchWalletToolBalances(
            activeWallet.address,
          )
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

          return;
        }

        const savedUserId =
          window.localStorage.getItem(
            CIRCLE_USER_ID_KEY,
          );

        if (!savedUserId) {
          setBalancesError(
            "The Circle user session could not be restored.",
          );
          setBalancesLoading(false);
          return;
        }

        void (async () => {
          const session =
            await requestCircleToolSession(
              savedUserId,
            );

          const [
            arcWallets,
            sepoliaWallets,
          ] = await Promise.all([
            requestCircleToolWallets(
              session.userToken,
              "ARC-TESTNET",
            ),
            requestCircleToolWallets(
              session.userToken,
              "ETH-SEPOLIA",
            ),
          ]);

          const arcWallet =
            arcWallets.find(
              (wallet) =>
                wallet.address.toLowerCase() ===
                activeWallet.address.toLowerCase(),
            ) ??
            arcWallets[0] ??
            null;

          const sepoliaWallet =
            sepoliaWallets[0] ?? null;

          if (cancelled) {
            return;
          }

          setCircleArcWallet(arcWallet);
          setCircleSepoliaWallet(
            sepoliaWallet,
          );

          const connectedBalances =
            await fetchWalletToolBalances(
              activeWallet.address,
            );

          if (cancelled) {
            return;
          }

          setBalances(
            connectedBalances,
          );
        })()
          .catch((error: unknown) => {
            if (!cancelled) {
              setBalances(null);
              setCircleArcWallet(null);
              setCircleSepoliaWallet(null);
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

  const circleWalletReady =
    activeWallet?.kind === "circle" &&
    Boolean(
      circleArcWallet &&
      circleSepoliaWallet,
    );

  const circleSwapReady =
    activeWallet?.kind === "circle" &&
    Boolean(
      circleArcWallet &&
      circleArcWallet.address.toLowerCase() ===
        activeWallet.address.toLowerCase(),
    );

  const walletToolInputReady =
    isBridge
      ? browserWalletReady || circleWalletReady
      : browserWalletReady || circleSwapReady;

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
  const activeSourceBalance = isBridge ? bridgeSourceBalance : swapInputBalance;
  const numericSourceBalance = Number(activeSourceBalance ?? "0");

  function getBalanceText(
    balance: string | undefined,
    token: string,
  ) {

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
        ? "Circle wallet ready for Bridge. Swap is available on Arc Testnet with PIN confirmation."
        : "Browser wallet ready for transaction setup.";

  const parsedAmount =
    Number(amount);

  const validBridgeAmount =
    /^\d+(\.\d+)?$/.test(amount) &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;
  const trimmedRecipientAddress = recipientAddress.trim();
  const validRecipientAddress =
    trimmedRecipientAddress === "" || isAddress(trimmedRecipientAddress);

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
      !walletToolInputReady ||
      !isBridge ||
      !validBridgeAmount ||
      !validRecipientAddress ||
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
        if (activeWallet?.kind === "circle") {
          const savedUserId =
            window.localStorage.getItem(
              CIRCLE_USER_ID_KEY,
            );

          if (!savedUserId) {
            throw new Error(
              "The Circle user session could not be restored.",
            );
          }

          const sourceBlockchain =
            bridgeFromEthereum
              ? "ETH-SEPOLIA"
              : "ARC-TESTNET";

          const destinationBlockchain =
            bridgeFromEthereum
              ? "ARC-TESTNET"
              : "ETH-SEPOLIA";

          setBridgeMessage(
            "Preparing your Circle wallets for the bridge...",
          );

          if (
            !circleArcWallet ||
            !circleSepoliaWallet
          ) {
            throw new Error(
              "Both Circle bridge wallets must be loaded before bridging.",
            );
          }

          const session =
            await requestCircleToolSession(
              savedUserId,
            );

          const sourceWallet =
            sourceBlockchain === "ARC-TESTNET"
              ? circleArcWallet
              : circleSepoliaWallet;

          const destinationWallet =
            destinationBlockchain === "ARC-TESTNET"
              ? circleArcWallet
              : circleSepoliaWallet;

          const sourceWalletResult = {
            session,
            wallet: sourceWallet,
            created: false,
          };

          const destinationWalletResult = {
            session,
            wallet: destinationWallet,
            created: false,
          };

          const bridgeRecipient =
            trimmedRecipientAddress ||
            destinationWalletResult.wallet.address;

          setBridgeMessage(
            "Calculating the Circle forwarding fee...",
          );

          const quoteResponse =
            await fetch(
              "/api/circle/bridge/forwarding-quote",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                cache: "no-store",
                body: JSON.stringify({
                  sourceBlockchain,
                  amount,
                }),
              },
            );

          const quote =
            (await quoteResponse
              .json()
              .catch(
                () => ({}),
              )) as {
              totalAmount?: string;
              totalAmountFormatted?: string;
              maxFee?: string;
              feeFormatted?: string;
              error?: string;
            };

          if (
            !quoteResponse.ok ||
            typeof quote.totalAmount !== "string" ||
            typeof quote.totalAmountFormatted !== "string" ||
            typeof quote.maxFee !== "string" ||
            typeof quote.feeFormatted !== "string"
          ) {
            throw new Error(
              quote.error ??
                "Circle could not calculate the forwarding fee.",
            );
          }

          const totalAmountNumber =
            Number(
              quote.totalAmountFormatted,
            );

          if (
            !Number.isFinite(
              totalAmountNumber,
            ) ||
            totalAmountNumber >
              numericSourceBalance
          ) {
            throw new Error(
              `You need ${quote.totalAmountFormatted} USDC including the Circle forwarding fee.`,
            );
          }

          if (
            sourceBlockchain === "ARC-TESTNET" &&
            totalAmountNumber >=
              numericSourceBalance
          ) {
            throw new Error(
              "Leave a small USDC balance on Arc for transaction gas.",
            );
          }

          setBridgeMessage(
            `Forwarding fee: ${quote.feeFormatted} USDC. Confirm the USDC approval with your Circle PIN.`,
          );

          const approveChallenge =
            await requestCircleBridgeChallenge(
              "/api/circle/bridge/approve",
              {
                userToken:
                  sourceWalletResult.session.userToken,
                walletId:
                  sourceWalletResult.wallet.id,
                blockchain:
                  sourceBlockchain,
                amount:
                  quote.totalAmountFormatted,
              },
            );

          await executeCircleToolChallenge(
            approveChallenge.challengeId,
            sourceWalletResult.session,
          );

          setBridgeMessage(
            "Waiting for the USDC approval to confirm...",
          );

          await waitForCircleToolTransaction({
            userToken:
              sourceWalletResult.session.userToken,
            walletId:
              sourceWalletResult.wallet.id,
            refId:
              approveChallenge.refId,
            createdAfter:
              approveChallenge.createdAfter,
          });

          setBridgeMessage(
            "Approval confirmed. Confirm the crosschain transfer with your Circle PIN.",
          );

          const burnChallenge =
            await requestCircleBridgeChallenge(
              "/api/circle/bridge/burn",
              {
                userToken:
                  sourceWalletResult.session.userToken,
                walletId:
                  sourceWalletResult.wallet.id,
                blockchain:
                  sourceBlockchain,
                amount,
                recipient:
                  bridgeRecipient,
                totalAmount:
                  quote.totalAmount,
                maxFee:
                  quote.maxFee,
              },
            );

          await executeCircleToolChallenge(
            burnChallenge.challengeId,
            sourceWalletResult.session,
          );

          setBridgeMessage(
            "Waiting for the source transaction to confirm...",
          );

          const burnTransaction =
            await waitForCircleToolTransaction({
              userToken:
                sourceWalletResult.session.userToken,
              walletId:
                sourceWalletResult.wallet.id,
              refId:
                burnChallenge.refId,
              createdAfter:
                burnChallenge.createdAfter,
            });

          if (!burnTransaction.txHash) {
            throw new Error(
              "Circle did not return the source transaction hash.",
            );
          }

          setBridgeExplorerLinks([
            {
              name:
                `Burn on ${bridgeSourceLabel}`,
              url:
                getCircleBridgeExplorerUrl(
                  sourceBlockchain,
                  burnTransaction.txHash,
                ),
            },
          ]);

          setBridgeStatus("pending");

          setBridgeMessage(
            `Source transaction confirmed. Circle is forwarding the mint to ${bridgeDestinationLabel}...`,
          );

          const forwardingResult =
            await waitForCircleToolForwarding({
              sourceBlockchain,
              transactionHash:
                burnTransaction.txHash,
            });

          setBridgeExplorerLinks([
            {
              name:
                `Burn on ${bridgeSourceLabel}`,
              url:
                getCircleBridgeExplorerUrl(
                  sourceBlockchain,
                  burnTransaction.txHash,
                ),
            },
            {
              name:
                `Mint on ${bridgeDestinationLabel}`,
              url:
                getCircleBridgeExplorerUrl(
                  destinationBlockchain,
                  forwardingResult.forwardTxHash,
                ),
            },
          ]);

          setBridgeStatus("success");

          setBridgeMessage(
            `${amount} USDC was bridged successfully to ${bridgeDestinationLabel}. Forwarding fee: ${quote.feeFormatted} USDC.`,
          );

          const arcWallet =
            sourceBlockchain === "ARC-TESTNET"
              ? sourceWalletResult.wallet
              : destinationWalletResult.wallet;

          const sepoliaWallet =
            sourceBlockchain === "ETH-SEPOLIA"
              ? sourceWalletResult.wallet
              : destinationWalletResult.wallet;

          try {
            const [
              arcBalances,
              sepoliaBalances,
            ] = await Promise.all([
              fetchWalletToolBalances(
                arcWallet.address,
              ),
              fetchWalletToolBalances(
                sepoliaWallet.address,
              ),
            ]);

            setBalances({
              ethereumSepolia: {
                USDC:
                  sepoliaBalances.ethereumSepolia.USDC,
              },
              arcTestnet: {
                USDC:
                  arcBalances.arcTestnet.USDC,
                EURC:
                  arcBalances.arcTestnet.EURC,
              },
            });
          } catch (balanceError) {
            console.error(
              "Circle bridge balance refresh failed:",
              balanceError,
            );
          }

          return;
        }

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
            useForwarder: true,
            ...(trimmedRecipientAddress
              ? { recipientAddress: trimmedRecipientAddress }
              : {}),
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
      !(browserWalletReady || circleSwapReady) ||
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
      const swapContext =
        await (async () => {
          if (
            activeWallet?.kind !== "circle"
          ) {
            return createShowUpAppKitContext();
          }

          const savedUserId =
            window.localStorage.getItem(
              CIRCLE_USER_ID_KEY,
            );

          if (!savedUserId) {
            throw new Error(
              "The Circle user session could not be restored.",
            );
          }

          if (
            !circleArcWallet ||
            circleArcWallet.address.toLowerCase() !==
              activeWallet.address.toLowerCase()
          ) {
            throw new Error(
              "The connected Circle wallet is not available on Arc Testnet.",
            );
          }

          const session =
            await requestCircleToolSession(
              savedUserId,
            );

          return createShowUpCircleSwapAppKitContext({
            wallet: circleArcWallet,
            session,
          });
        })();

      const {
        adapter,
        kit,
      } = swapContext;

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
                ...(activeWallet?.kind === "circle"
                  ? {
                      allowanceStrategy:
                        "approve" as const,
                    }
                  : {}),
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

    setRecipientAddress("");
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
  function handleAmountPreset(preset: "min" | "half" | "max") {
    if (!Number.isFinite(numericSourceBalance) || numericSourceBalance <= 0) {
      return;
    }

    const nextAmount =
      preset === "min"
        ? Math.min(0.1, numericSourceBalance)
        : preset === "half"
          ? numericSourceBalance * 0.5
          : numericSourceBalance;

    handleAmountChange(
      nextAmount.toFixed(6).replace(/\.?0+$/, ""),
    );
  }


  return (
    <main className="min-h-screen bg-[#050817] text-white">
      <ShowUpHeader />

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
                    : "Exchange USDC and EURC on Arc Testnet using your connected wallet."}
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

                  {isBridge && bridgeFromEthereum && (
                    <p className="mt-2 text-xs leading-5 text-amber-200/70">
                      Sepolia ETH is required in the source wallet for network gas.
                    </p>
                  )}
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

                {isBridge && (
                  <label className="block">
                    <span className="text-xs text-white/35">
                      Recipient address (optional)
                    </span>

                    <div className="mt-2 rounded-2xl border border-[#79b7ff]/12 bg-[#0c132a] px-4 py-3">
                      <input
                        type="text"
                        inputMode="text"
                        name="showup-bridge-recipient"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="0x..."
                        value={recipientAddress}
                        onChange={(event) => {
                          setRecipientAddress(event.target.value);
                          setBridgeStatus("idle");
                          setBridgeMessage("");
                          setBridgeExplorerLinks([]);
                        }}
                        disabled={!walletToolInputReady || bridgeBusy}
                        className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                      />
                    </div>

                    <p
                      className={`mt-2 text-xs ${
                        trimmedRecipientAddress && !validRecipientAddress
                          ? "text-red-300/80"
                          : "text-white/35"
                      }`}
                    >
                      {trimmedRecipientAddress
                        ? validRecipientAddress
                          ? `Destination: ${trimmedRecipientAddress}`
                          : "Enter a valid EVM wallet address."
                        : activeWallet?.kind === "circle"
                          ? `Default destination: ${
                              bridgeFromEthereum
                                ? circleArcWallet?.address ?? "Loading..."
                                : circleSepoliaWallet?.address ?? "Loading..."
                            }`
                          : `Default destination: ${
                              activeWallet?.address ?? "Loading..."
                            }`}
                    </p>
                  </label>
                )}

                <label className="block">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-white/35">
                      Amount
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleAmountPreset("min")}
                        disabled={!walletToolInputReady || numericSourceBalance <= 0}
                        className="rounded-lg border border-[#79b7ff]/12 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-white/45 transition hover:border-[#79b7ff]/30 hover:text-[#9bddff] disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        MIN
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAmountPreset("half")}
                        disabled={!walletToolInputReady || numericSourceBalance <= 0}
                        className="rounded-lg border border-[#79b7ff]/12 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-white/45 transition hover:border-[#79b7ff]/30 hover:text-[#9bddff] disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAmountPreset("max")}
                        disabled={!walletToolInputReady || numericSourceBalance <= 0}
                        className="rounded-lg border border-[#79b7ff]/12 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-white/45 transition hover:border-[#79b7ff]/30 hover:text-[#9bddff] disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        MAX
                      </button>
                    </div>
                  </div>

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
                        !walletToolInputReady
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
                    !walletToolInputReady ||
                    !validBridgeAmount ||
                    (isBridge
                      ? !validRecipientAddress || bridgeLocked
                      : swapLocked)
                  }
                  className="mt-6 w-full rounded-full bg-gradient-to-r from-[#73d8ff] to-[#8195ff] px-6 py-3.5 font-semibold text-[#050817] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {!activeWallet
                    ? "Connect wallet to continue"
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
