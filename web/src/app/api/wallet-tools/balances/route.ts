import {
  createPublicClient,
  fallback,
  formatUnits,
  getAddress,
  http,
  isAddress,
} from "viem";
import { sepolia } from "viem/chains";

import { arcPublicClient } from "@/lib/arc-public-client";

const ETHEREUM_SEPOLIA_USDC_ADDRESS =
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

const ARC_TESTNET_EURC_ADDRESS =
  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },
] as const;

const sepoliaPublicClient = createPublicClient({
  chain: sepolia,
  transport: fallback(
    [
      http(
        "https://ethereum-sepolia-rpc.publicnode.com",
        {
          timeout: 15_000,
          retryCount: 0,
        },
      ),
      http("https://rpc.sepolia.org", {
        timeout: 15_000,
        retryCount: 0,
      }),
    ],
    {
      retryCount: 1,
      retryDelay: 250,
    },
  ),
});

function formatStablecoinBalance(
  balance: bigint,
) {
  return formatUnits(balance, 6);
}

export async function GET(
  request: Request,
) {
  const url = new URL(request.url);

  const rawAddress =
    url.searchParams.get("address")?.trim();

  if (
    !rawAddress ||
    !isAddress(rawAddress)
  ) {
    return Response.json(
      {
        error: "A valid wallet address is required.",
      },
      {
        status: 400,
      },
    );
  }

  const owner = getAddress(rawAddress);

  try {
    const [
      ethereumSepoliaUsdc,
      arcTestnetUsdc,
      arcTestnetEurc,
    ] = await Promise.all([
      sepoliaPublicClient.readContract({
        address:
          ETHEREUM_SEPOLIA_USDC_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),

      arcPublicClient.readContract({
        address: ARC_TESTNET_USDC_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),

      arcPublicClient.readContract({
        address: ARC_TESTNET_EURC_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
    ]);

    return Response.json(
      {
        address: owner,
        balances: {
          ethereumSepolia: {
            USDC: formatStablecoinBalance(
              ethereumSepoliaUsdc,
            ),
          },
          arcTestnet: {
            USDC: formatStablecoinBalance(
              arcTestnetUsdc,
            ),
            EURC: formatStablecoinBalance(
              arcTestnetEurc,
            ),
          },
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Wallet Tools balance lookup failed:",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to load wallet balances right now.",
      },
      {
        status: 502,
      },
    );
  }
}
