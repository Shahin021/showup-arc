import { createPublicClient, fallback, http } from "viem";
import { arcTestnet } from "viem/chains";

export const ARC_RPC_URLS = [
  "https://rpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
] as const;

export const arcPublicClient = createPublicClient({
  chain: arcTestnet,

  transport: fallback(
    [
      http(ARC_RPC_URLS[0], {
        timeout: 20_000,
        retryCount: 0,
      }),

      http(ARC_RPC_URLS[1], {
        timeout: 20_000,
        retryCount: 0,
      }),

      http(ARC_RPC_URLS[2], {
        timeout: 20_000,
        retryCount: 0,
      }),

      http(ARC_RPC_URLS[3], {
        timeout: 20_000,
        retryCount: 0,
      }),
    ],
    {
      retryCount: 4,
      retryDelay: 300,

      rank: {
        interval: 30_000,
        sampleCount: 5,
        timeout: 2_000,

        weights: {
          latency: 0.3,
          stability: 0.7,
        },
      },
    },
  ),

  cacheTime: 4_000,
});