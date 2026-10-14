import { createPublicClient, fallback, http } from "viem";
import { ARC_CHAIN, ARC_RPC_URLS } from "@/lib/showup-network";

export { ARC_RPC_URLS };

export const arcPublicClient = createPublicClient({
  chain: ARC_CHAIN,

  transport: fallback(
    ARC_RPC_URLS.map((url) =>
      http(url, {
        timeout: 20_000,
        retryCount: 0,
      }),
    ),
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
