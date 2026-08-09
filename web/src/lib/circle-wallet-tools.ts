"use client";

import type {
  ShowUpCctpBlockchain,
} from "@/lib/showup-cctp";

export type CircleToolWallet = {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
  accountType?: string;
  name?: string;
};

export type CircleToolSession = {
  userId: string;
  userToken: string;
  encryptionKey: string;
};

type SessionResponse = {
  userId?: string;
  userToken?: string;
  encryptionKey?: string;
  error?: string;
};

type WalletResponse = {
  wallets?: CircleToolWallet[];
  wallet?: CircleToolWallet | null;
  error?: string;
};

type CreateWalletResponse = {
  challengeId?: string;
  error?: string;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export async function requestCircleToolSession(
  userId: string,
): Promise<CircleToolSession> {
  const response = await fetch(
    "/api/circle/session",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userId,
      }),
    },
  );

  const data =
    (await response.json()) as SessionResponse;

  if (
    !response.ok ||
    !data.userId ||
    !data.userToken ||
    !data.encryptionKey
  ) {
    throw new Error(
      data.error ??
        "Unable to create the Circle session.",
    );
  }

  return {
    userId: data.userId,
    userToken: data.userToken,
    encryptionKey: data.encryptionKey,
  };
}

export async function requestCircleToolWallets(
  userToken: string,
  blockchain: ShowUpCctpBlockchain,
): Promise<CircleToolWallet[]> {
  const response = await fetch(
    "/api/circle/wallets",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userToken,
        blockchain,
      }),
    },
  );

  const data =
    (await response.json()) as WalletResponse;

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(
      data.error ??
        `Unable to retrieve the ${blockchain} Circle wallet.`,
    );
  }

  const wallets = Array.isArray(data.wallets)
    ? data.wallets
    : data.wallet
      ? [data.wallet]
      : [];

  return wallets.filter(
    (wallet) =>
      wallet.id &&
      wallet.address &&
      wallet.blockchain === blockchain &&
      wallet.state === "LIVE",
  );
}

export async function requestCircleToolWalletCreation(
  userToken: string,
  blockchain: ShowUpCctpBlockchain,
  unifiedBridgePair = false,
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
        blockchain,
        unifiedBridgePair,
        walletName: unifiedBridgePair
          ? "ShowUp Unified Bridge"
          : blockchain === "ETH-SEPOLIA"
            ? "ShowUp Sepolia Bridge"
            : "ShowUp Arc Bridge",
      }),
    },
  );

  const data =
    (await response.json()) as CreateWalletResponse;

  if (!response.ok || !data.challengeId) {
    throw new Error(
      data.error ??
        `Unable to prepare the ${blockchain} Circle wallet.`,
    );
  }

  return data.challengeId;
}

export async function executeCircleToolChallenge(
  challengeId: string,
  session: CircleToolSession,
) {
  const appId =
    process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

  if (!appId) {
    throw new Error(
      "Circle App ID is not configured.",
    );
  }

  const {
    W3SSdk,
  } = await import(
    "@circle-fin/w3s-pw-web-sdk"
  );

  const circleSdk =
    new W3SSdk({
      appSettings: {
        appId,
      },
    });

  await circleSdk.getDeviceId();

  circleSdk.setAuthentication({
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
  });

  await new Promise<void>(
    (resolve, reject) => {
      const timeout =
        window.setTimeout(
          () => {
            reject(
              new Error(
                "Circle authorization timed out.",
              ),
            );
          },
          10 * 60 * 1000,
        );

      circleSdk.execute(
        challengeId,
        (error, result) => {
          window.clearTimeout(timeout);

          if (error) {
            reject(
              new Error(
                error.message ||
                  "Circle authorization failed.",
              ),
            );
            return;
          }

          if (!result) {
            reject(
              new Error(
                "Circle did not return an authorization result.",
              ),
            );
            return;
          }

          if (
            result.status === "FAILED" ||
            result.status === "EXPIRED"
          ) {
            reject(
              new Error(
                `Circle authorization ended with status: ${result.status}.`,
              ),
            );
            return;
          }

          resolve();
        },
      );
    },
  );
}

export async function waitForCircleToolWallet(
  userToken: string,
  blockchain: ShowUpCctpBlockchain,
  existingWalletIds: Set<string>,
  attempts = 30,
): Promise<CircleToolWallet> {
  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const wallets =
      await requestCircleToolWallets(
        userToken,
        blockchain,
      );

    const newWallet =
      wallets.find(
        (wallet) =>
          !existingWalletIds.has(wallet.id),
      );

    if (newWallet) {
      return newWallet;
    }

    if (attempt < attempts - 1) {
      await wait(1500);
    }
  }

  throw new Error(
    `The ${blockchain} Circle wallet is still being processed.`,
  );
}

export async function ensureCircleToolWallet({
  userId,
  blockchain,
  preferredAddress,
}: {
  userId: string;
  blockchain: ShowUpCctpBlockchain;
  preferredAddress?: string;
}): Promise<{
  session: CircleToolSession;
  wallet: CircleToolWallet;
  created: boolean;
}> {
  const session =
    await requestCircleToolSession(userId);

  const existingWallets =
    await requestCircleToolWallets(
      session.userToken,
      blockchain,
    );

  const normalizedPreferredAddress =
    preferredAddress?.toLowerCase();

  const existingWallet =
    (normalizedPreferredAddress
      ? existingWallets.find(
          (wallet) =>
            wallet.address.toLowerCase() ===
            normalizedPreferredAddress,
        )
      : undefined) ??
    existingWallets[0];

  if (existingWallet) {
    return {
      session,
      wallet: existingWallet,
      created: false,
    };
  }

  const existingWalletIds =
    new Set(
      existingWallets.map(
        (wallet) => wallet.id,
      ),
    );

  const challengeId =
    await requestCircleToolWalletCreation(
      session.userToken,
      blockchain,
    );

  await executeCircleToolChallenge(
    challengeId,
    session,
  );

  const wallet =
    await waitForCircleToolWallet(
      session.userToken,
      blockchain,
      existingWalletIds,
    );

  return {
    session,
    wallet,
    created: true,
  };
}

export async function ensureCircleToolWalletPair(
  userId: string,
): Promise<{
  session: CircleToolSession;
  arcWallet: CircleToolWallet;
  sepoliaWallet: CircleToolWallet;
  created: boolean;
}> {
  const session =
    await requestCircleToolSession(userId);

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

  const existingPair =
    arcWallets
      .filter(
        (wallet) =>
          wallet.accountType === "EOA",
      )
      .map((arcWallet) => ({
        arcWallet,
        sepoliaWallet:
          sepoliaWallets.find(
            (wallet) =>
              wallet.accountType === "EOA" &&
              wallet.address.toLowerCase() ===
                arcWallet.address.toLowerCase(),
          ),
      }))
      .find(
        (
          pair,
        ): pair is {
          arcWallet: CircleToolWallet;
          sepoliaWallet: CircleToolWallet;
        } => Boolean(pair.sepoliaWallet),
      );

  if (existingPair) {
    return {
      session,
      arcWallet:
        existingPair.arcWallet,
      sepoliaWallet:
        existingPair.sepoliaWallet,
      created: false,
    };
  }

  const existingArcWalletIds =
    new Set(
      arcWallets.map(
        (wallet) => wallet.id,
      ),
    );

  const existingSepoliaWalletIds =
    new Set(
      sepoliaWallets.map(
        (wallet) => wallet.id,
      ),
    );

  const challengeId =
    await requestCircleToolWalletCreation(
      session.userToken,
      "ARC-TESTNET",
      true,
    );

  await executeCircleToolChallenge(
    challengeId,
    session,
  );

  const [
    arcWallet,
    sepoliaWallet,
  ] = await Promise.all([
    waitForCircleToolWallet(
      session.userToken,
      "ARC-TESTNET",
      existingArcWalletIds,
    ),
    waitForCircleToolWallet(
      session.userToken,
      "ETH-SEPOLIA",
      existingSepoliaWalletIds,
    ),
  ]);

  if (
    arcWallet.accountType !== "EOA" ||
    sepoliaWallet.accountType !== "EOA" ||
    arcWallet.address.toLowerCase() !==
      sepoliaWallet.address.toLowerCase()
  ) {
    throw new Error(
      "Circle created an invalid bridge wallet pair. Arc and Sepolia addresses do not match.",
    );
  }

  return {
    session,
    arcWallet,
    sepoliaWallet,
    created: true,
  };
}

export type CircleToolTransaction = {
  id?: string;
  state?: string;
  txHash?: string;
  refId?: string;
  walletId?: string;
  blockchain?: string;
  contractAddress?: string;
  errorReason?: string;
  errorDetails?: string;
};

type CircleToolTransactionResultResponse = {
  status?: string;
  transaction?: CircleToolTransaction | null;
  error?: string;
};

export async function waitForCircleToolTransaction({
  userToken,
  walletId,
  refId,
  createdAfter,
  attempts = 240,
}: {
  userToken: string;
  walletId: string;
  refId: string;
  createdAfter: string;
  attempts?: number;
}): Promise<CircleToolTransaction> {
  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const response = await fetch(
      "/api/circle/transactions/result",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          userToken,
          walletId,
          refId,
          createdAfter,
        }),
      },
    );

    const data =
      (await response
        .json()
        .catch(
          () => ({}),
        )) as CircleToolTransactionResultResponse;

    if (
      !response.ok &&
      response.status !== 202
    ) {
      throw new Error(
        data.error ??
          "Unable to retrieve the Circle transaction.",
      );
    }

    const transaction =
      data.transaction ?? null;

    if (
      transaction?.state === "STUCK"
    ) {
      throw new Error(
        `Circle transaction is STUCK${transaction.txHash ? `: ${transaction.txHash}` : "."}`,
      );
    }

    if (
      transaction &&
      (
        transaction.state === "CONFIRMED" ||
        transaction.state === "COMPLETE"
      ) &&
      transaction.txHash
    ) {
      return transaction;
    }

    if (attempt < attempts - 1) {
      await wait(1500);
    }
  }

  throw new Error(
    "The Circle transaction did not reach CONFIRMED or COMPLETE within 6 minutes.",
  );
}

export type CircleToolAttestation = {
  status: string;
  message: string;
  attestation: string;
  eventNonce?: string;
};

type CircleToolAttestationResponse = {
  status?: string;
  message?: string | null;
  attestation?: string | null;
  eventNonce?: string;
  error?: string;
};

export async function waitForCircleToolAttestation({
  sourceBlockchain,
  transactionHash,
  attempts = 500,
}: {
  sourceBlockchain: ShowUpCctpBlockchain;
  transactionHash: string;
  attempts?: number;
}): Promise<CircleToolAttestation> {
  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const response = await fetch(
      "/api/circle/bridge/attestation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          sourceBlockchain,
          transactionHash,
        }),
      },
    );

    const data =
      (await response
        .json()
        .catch(
          () => ({}),
        )) as CircleToolAttestationResponse;

    if (
      !response.ok &&
      response.status !== 202
    ) {
      throw new Error(
        data.error ??
          "Unable to retrieve the CCTP attestation.",
      );
    }

    if (
      data.status === "complete" &&
      typeof data.message === "string" &&
      data.message.startsWith("0x") &&
      typeof data.attestation === "string" &&
      data.attestation.startsWith("0x")
    ) {
      return {
        status: data.status,
        message: data.message,
        attestation: data.attestation,
        eventNonce: data.eventNonce,
      };
    }

    if (attempt < attempts - 1) {
      await wait(3000);
    }
  }

  throw new Error(
    "The CCTP attestation is still being processed.",
  );
}


export type CircleToolForwardingResult = {
  status: string;
  forwardState?: string | null;
  forwardTxHash: string;
};

type CircleToolForwardingResponse = {
  status?: string;
  forwardState?: string | null;
  forwardTxHash?: string | null;
  error?: string;
};

export async function waitForCircleToolForwarding({
  sourceBlockchain,
  transactionHash,
  attempts = 500,
}: {
  sourceBlockchain: ShowUpCctpBlockchain;
  transactionHash: string;
  attempts?: number;
}): Promise<CircleToolForwardingResult> {
  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const response = await fetch(
      "/api/circle/bridge/forwarding-status",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          sourceBlockchain,
          transactionHash,
        }),
      },
    );

    const data =
      (await response
        .json()
        .catch(
          () => ({}),
        )) as CircleToolForwardingResponse;

    if (
      !response.ok &&
      response.status !== 202
    ) {
      throw new Error(
        data.error ??
          "Unable to retrieve the Circle forwarding status.",
      );
    }

    if (
      data.status === "complete" &&
      typeof data.forwardTxHash === "string" &&
      /^0x[a-fA-F0-9]{64}$/.test(
        data.forwardTxHash,
      )
    ) {
      return {
        status: data.status,
        forwardState:
          data.forwardState ?? null,
        forwardTxHash:
          data.forwardTxHash,
      };
    }

    if (attempt < attempts - 1) {
      await wait(3000);
    }
  }

  throw new Error(
    "Circle Forwarding Service is still processing the transfer.",
  );
}
