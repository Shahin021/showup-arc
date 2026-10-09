import {
  connectBrowserWallet,
  findBrowserWalletProvider,
  getArcFeeOverrides,
} from "@/lib/browser-wallet";
import { arcPublicClient } from "@/lib/arc-public-client";
import { assertWithinReservationCap } from "@/lib/showup-cap";
import { ARC_NETWORK_LABEL } from "@/lib/showup-network";
import {
  buildCreateEventArgs,
  getShowUpContractAddress,
  SHOWUP_CREATE_EVENT_ABI,
  type ShowUpCreateEventInput,
} from "@/lib/showup-create-event";

export async function createEventWithBrowserWallet({
  providerRdns,
  expectedAddress,
  input,
}: {
  providerRdns: string;
  expectedAddress: `0x${string}`;
  input: ShowUpCreateEventInput;
}) {
  const walletProvider =
    await findBrowserWalletProvider(
      providerRdns,
    );

  const connection =
    await connectBrowserWallet(
      walletProvider.provider,
    );

  if (
    connection.address.toLowerCase() !==
    expectedAddress.toLowerCase()
  ) {
    throw new Error(
      "The active browser wallet account has changed. Reconnect the expected account and try again.",
    );
  }

  const contractAddress =
    getShowUpContractAddress();

  const args =
    buildCreateEventArgs(input);

  await assertWithinReservationCap(
    Number(args[3]),
    args[5],
    args[6],
  );

  const fees = await getArcFeeOverrides(() =>
    arcPublicClient.estimateFeesPerGas(),
  );

  const transactionHash =
    await connection.walletClient.writeContract({
      account: connection.address,
      address: contractAddress,
      abi: SHOWUP_CREATE_EVENT_ABI,
      functionName: "createEvent",
      args,
      ...fees,
    });

  const receipt =
    await arcPublicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 120_000,
    });

  if (receipt.status !== "success") {
    throw new Error(
      `The event transaction failed on ${ARC_NETWORK_LABEL}.`,
    );
  }

  return {
    transactionHash,
    receipt,
  };
}
