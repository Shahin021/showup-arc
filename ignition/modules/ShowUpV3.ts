import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ARC_TESTNET_USDC =
  "0x3600000000000000000000000000000000000000";

export default buildModule(
  "ShowUpV3Module",
  (module) => {
    const showUpV3 = module.contract(
      "ShowUpV3",
      [ARC_TESTNET_USDC],
    );

    return {
      showUpV3,
    };
  },
);
