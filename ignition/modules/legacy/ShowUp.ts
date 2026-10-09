import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ARC_TESTNET_USDC =
  "0x3600000000000000000000000000000000000000";

export default buildModule("ShowUpModule", (module) => {
  const showUp = module.contract("ShowUp", [
    ARC_TESTNET_USDC,
  ]);

  return {
    showUp,
  };
});
