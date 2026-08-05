import { isAddress } from "viem";

import {
  signBrowserWalletMessage,
} from "@/lib/browser-wallet";

type WalletChallengeResponse = {
  address?: unknown;
  message?: unknown;
  expiresAt?: unknown;
  error?: unknown;
};

type WalletVerifyResponse = {
  address?: unknown;
  expiresAt?: unknown;
  error?: unknown;
};

function getApiError(
  data: {
    error?: unknown;
  },
  fallbackMessage: string,
) {
  if (
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }

  return fallbackMessage;
}

export async function authorizeBrowserWallet({
  providerRdns,
  expectedAddress,
}: {
  providerRdns: string;
  expectedAddress: `0x${string}`;
}) {
  const challengeResponse =
    await fetch(
      "/api/wallet-auth/challenge",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          address: expectedAddress,
        }),
      },
    );

  const challengeData =
    (await challengeResponse
      .json()
      .catch(
        () => ({}),
      )) as WalletChallengeResponse;

  if (!challengeResponse.ok) {
    throw new Error(
      getApiError(
        challengeData,
        "Unable to create the wallet authorization challenge.",
      ),
    );
  }

  if (
    typeof challengeData.address !==
      "string" ||
    !isAddress(
      challengeData.address,
    ) ||
    challengeData.address.toLowerCase() !==
      expectedAddress.toLowerCase()
  ) {
    throw new Error(
      "The wallet authorization challenge returned an unexpected address.",
    );
  }

  if (
    typeof challengeData.message !==
      "string" ||
    !challengeData.message.trim()
  ) {
    throw new Error(
      "The wallet authorization challenge did not include a message.",
    );
  }

  const signedMessage =
    await signBrowserWalletMessage({
      providerRdns,
      expectedAddress,
      message:
        challengeData.message,
    });

  const verifyResponse =
    await fetch(
      "/api/wallet-auth/verify",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          address:
            signedMessage.address,
          signature:
            signedMessage.signature,
        }),
      },
    );

  const verifyData =
    (await verifyResponse
      .json()
      .catch(
        () => ({}),
      )) as WalletVerifyResponse;

  if (!verifyResponse.ok) {
    throw new Error(
      getApiError(
        verifyData,
        "Unable to verify the wallet signature.",
      ),
    );
  }

  if (
    typeof verifyData.address !==
      "string" ||
    !isAddress(
      verifyData.address,
    ) ||
    verifyData.address.toLowerCase() !==
      expectedAddress.toLowerCase()
  ) {
    throw new Error(
      "The wallet authorization session returned an unexpected address.",
    );
  }

  if (
    typeof verifyData.expiresAt !==
      "string" ||
    !Number.isFinite(
      Date.parse(
        verifyData.expiresAt,
      ),
    )
  ) {
    throw new Error(
      "The wallet authorization session returned an invalid expiration time.",
    );
  }

  return {
    address:
      verifyData.address,
    expiresAt:
      verifyData.expiresAt,
  };
}
