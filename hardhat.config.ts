import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import {
  configVariable,
  defineConfig,
} from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],

  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    arcTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 5042002,
      url: "https://rpc.testnet.arc.network",
      accounts: [
        configVariable("ARC_TESTNET_PRIVATE_KEY"),
      ],
    },
  },
});
