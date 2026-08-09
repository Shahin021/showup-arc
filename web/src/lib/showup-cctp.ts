import {
  getAddress,
  isAddress,
  padHex,
} from "viem";

export type ShowUpCctpBlockchain =
  | "ARC-TESTNET"
  | "ETH-SEPOLIA";

export const CCTP_TOKEN_MESSENGER_V2 =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";

export const CCTP_MESSAGE_TRANSMITTER_V2 =
  "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";

export const CCTP_STANDARD_FINALITY_THRESHOLD = 2000;

export const CCTP_ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const CCTP_NETWORKS = {
  "ETH-SEPOLIA": {
    blockchain: "ETH-SEPOLIA",
    domain: 0,
    usdcAddress:
      "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  "ARC-TESTNET": {
    blockchain: "ARC-TESTNET",
    domain: 26,
    usdcAddress:
      "0x3600000000000000000000000000000000000000",
  },
} as const;

export function getCctpNetwork(
  blockchain: ShowUpCctpBlockchain,
) {
  return CCTP_NETWORKS[blockchain];
}

export function addressToCctpBytes32(
  value: string,
): `0x${string}` {
  if (!isAddress(value)) {
    throw new Error(
      "The CCTP recipient address is invalid.",
    );
  }

  return padHex(
    getAddress(value),
    {
      size: 32,
      dir: "left",
    },
  );
}
