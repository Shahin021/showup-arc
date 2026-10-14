import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import {
  configVariable,
  defineConfig,
} from "hardhat/config";

// Optional: point Hardhat at a local solc binary (for example in offline CI)
// instead of downloading the compiler. Leave unset for normal use.
const localCompiler = process.env.SOLC_PATH
  ? { path: process.env.SOLC_PATH }
  : {};

const compilerSettings = {
  version: "0.8.24",
  ...localCompiler,
  settings: {
    evmVersion: "cancun",
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViem],

  solidity: {
    profiles: {
      default: compilerSettings,
      production: compilerSettings,
    },
  },

  // Network values: https://docs.arc.io/arc/references/connect-to-arc
  networks: {
    arcTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 5042002,
      url: "https://rpc.testnet.arc.io",
      accounts: [
        configVariable("ARC_TESTNET_PRIVATE_KEY"),
      ],
    },
    arcMainnet: {
      type: "http",
      chainType: "l1",
      chainId: 5042,
      // Override with ARC_MAINNET_RPC_URL to use a provider such as Alchemy.
      url:
        process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
      accounts: [
        configVariable("ARC_MAINNET_PRIVATE_KEY"),
      ],
    },
  },

  // The Arc explorers accept Etherscan-style verification requests and do
  // not need a key, but Hardhat requires a non-empty value. If API
  // verification fails, use scripts/export-verification-input.mjs and the
  // explorer's "Standard JSON input" form instead (docs/DEPLOYMENT.md).
  verify: {
    etherscan: {
      apiKey: process.env.ARC_EXPLORER_API_KEY ?? "not-required",
    },
  },

  chainDescriptors: {
    5042002: {
      name: "Arc Testnet",
      blockExplorers: {
        etherscan: {
          name: "Arc Testnet Explorer",
          url: "https://explorer.testnet.arc.io",
          apiUrl: "https://explorer.testnet.arc.io/api",
        },
      },
    },
    5042: {
      name: "Arc",
      blockExplorers: {
        etherscan: {
          name: "Arc Explorer",
          url: "https://explorer.arc.io",
          apiUrl: "https://explorer.arc.io/api",
        },
      },
    },
  },
});
