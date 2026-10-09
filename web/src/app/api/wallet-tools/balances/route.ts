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
import { estimateGasReserveUsdc } from "@/lib/gas-reserve";
import {
  ARC_EURC_ADDRESS,
  ARC_USDC_ADDRESS,
  FEATURES,
} from "@/lib/showup-network";

const ETHEREUM_SEPOLIA_USDC_ADDRESS =
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

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
    // Sepolia balances are only relevant to the testnet bridge.
    const [
      ethereumSepoliaUsdc,
      arcUsdc,
      arcEurc,
    ] = await Promise.all([
      FEATURES.testnetBridgeAndSwap
        ? sepoliaPublicClient.readContract({
            address:
              ETHEREUM_SEPOLIA_USDC_ADDRESS,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [owner],
          })
        : Promise.resolve(null),

      arcPublicClient.readContract({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),

      arcPublicClient.readContract({
        address: ARC_EURC_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
    ]);

    return Response.json(
      {
        address: owner,
        gasReserve: formatStablecoinBalance(
          await estimateGasReserveUsdc(),
        ),
        balances: {
          ethereumSepolia: {
            USDC:
              ethereumSepoliaUsdc === null
                ? null
                : formatStablecoinBalance(
                    ethereumSepoliaUsdc,
                  ),
          },
          arc: {
            USDC: formatStablecoinBalance(
              arcUsdc,
            ),
            EURC: formatStablecoinBalance(
              arcEurc,
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
