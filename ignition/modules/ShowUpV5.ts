import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ARC_TESTNET_USDC =
  "0x3600000000000000000000000000000000000000";

export default buildModule(
  "ShowUpV5Module",
  (module) => {
    const showUpV5 = module.contract(
      "ShowUpV5",
      [ARC_TESTNET_USDC],
    );

    return {
      showUpV5,
    };
  },
);
