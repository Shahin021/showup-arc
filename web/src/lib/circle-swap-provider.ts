"use client";

import {
  isAddress,
  type EIP1193Provider,
} from "viem";
import {
  arcTestnet,
} from "viem/chains";

import {
  executeCircleToolChallenge,
  waitForCircleToolTransaction,
  type CircleToolSession,
  type CircleToolWallet,
} from "@/lib/circle-wallet-tools";

type CircleSwapChallengeResponse = {
  challengeId?: string;
  refId?: string;
  createdAfter?: string;
  error?: string;
};

type SendTransactionRequest = {
  from?: unknown;
  to?: unknown;
  data?: unknown;
  value?: unknown;
};

const ARC_TESTNET_CHAIN_ID =
  `0x${arcTestnet.id.toString(16)}`;

function readString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isHexData(
  value: string,
): value is `0x${string}` {
  return /^0x(?:[a-fA-F0-9]{2})*$/.test(
    value,
  );
}

function readRequestedChainId(
  params: unknown,
) {
  if (!Array.isArray(params)) {
    return "";
  }

  const first = params[0];

  if (
    typeof first !== "object" ||
    first === null ||
    !("chainId" in first)
  ) {
    return "";
  }

  return readString(
    (
      first as {
        chainId?: unknown;
      }
    ).chainId,
  );
}

export function createCircleSwapProvider({
  wallet,
  session,
}: {
  wallet: CircleToolWallet;
  session: CircleToolSession;
}): EIP1193Provider {
  if (
    wallet.blockchain !== "ARC-TESTNET" ||
    !isAddress(wallet.address)
  ) {
    throw new Error(
      "A valid Circle Arc Testnet wallet is required for Swap.",
    );
  }

  const walletAddress =
    wallet.address.toLowerCase();

  const provider = {
    async request({
      method,
      params,
    }: {
      method: string;
      params?: unknown;
    }) {
      if (
        method === "eth_accounts" ||
        method === "eth_requestAccounts"
      ) {
        return [wallet.address];
      }

      if (method === "eth_chainId") {
        return ARC_TESTNET_CHAIN_ID;
      }

      if (
        method === "wallet_switchEthereumChain" ||
        method === "wallet_addEthereumChain"
      ) {
        const requestedChainId =
          readRequestedChainId(params);

        if (
          requestedChainId &&
          requestedChainId.toLowerCase() !==
            ARC_TESTNET_CHAIN_ID.toLowerCase()
        ) {
          throw new Error(
            "Circle Swap currently supports Arc Testnet only.",
          );
        }

        return null;
      }

      if (method === "eth_sendTransaction") {
        if (
          !Array.isArray(params) ||
          !params[0] ||
          typeof params[0] !== "object"
        ) {
          throw new Error(
            "Circle received an invalid swap transaction.",
          );
        }

        const transaction =
          params[0] as SendTransactionRequest;

        const from =
          readString(transaction.from);

        const contractAddress =
          readString(transaction.to);

        const callData =
          readString(transaction.data);

        const value =
          readString(transaction.value);

        if (
          !isAddress(from) ||
          from.toLowerCase() !== walletAddress
        ) {
          throw new Error(
            "The Circle swap sender does not match the connected wallet.",
          );
        }

        if (!isAddress(contractAddress)) {
          throw new Error(
            "The Circle swap contract address is invalid.",
          );
        }

        if (
          !callData ||
          !isHexData(callData)
        ) {
          throw new Error(
            "The Circle swap call data is invalid.",
          );
        }

        if (
          value &&
          value !== "0x0" &&
          value !== "0x00" &&
          value !== "0"
        ) {
          throw new Error(
            "Circle Swap currently supports token swaps without native value only.",
          );
        }

        const response = await fetch(
          "/api/circle/swap/execute",
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
              walletId:
                wallet.id,
              contractAddress,
              callData,
            }),
          },
        );

        const data =
          (await response.json()) as
            CircleSwapChallengeResponse;

        if (
          !response.ok ||
          !data.challengeId ||
          !data.refId ||
          !data.createdAfter
        ) {
          throw new Error(
            data.error ??
              "Unable to prepare the Circle swap authorization.",
          );
        }

        await executeCircleToolChallenge(
          data.challengeId,
          session,
        );

        const transactionResult =
          await waitForCircleToolTransaction({
            userToken:
              session.userToken,
            walletId:
              wallet.id,
            refId:
              data.refId,
            createdAfter:
              data.createdAfter,
          });

        if (!transactionResult.txHash) {
          throw new Error(
            "Circle completed the authorization but did not return a transaction hash.",
          );
        }

        return transactionResult.txHash;
      }

      throw new Error(
        `Unsupported Circle Swap provider method: ${method}`,
      );
    },
  };

  return provider as EIP1193Provider;
}
