import {
  connectBrowserWallet,
  findBrowserWalletProvider,
} from "@/lib/browser-wallet";
import { arcPublicClient } from "@/lib/arc-public-client";
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

  const transactionHash =
    await connection.walletClient.writeContract({
      account: connection.address,
      address: contractAddress,
      abi: SHOWUP_CREATE_EVENT_ABI,
      functionName: "createEvent",
      args,
    });

  const receipt =
    await arcPublicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 120_000,
    });

  if (receipt.status !== "success") {
    throw new Error(
      "The event transaction failed on Arc Testnet.",
    );
  }

  return {
    transactionHash,
    receipt,
  };
}
