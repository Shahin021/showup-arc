import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// USDC's ERC-20 interface lives at the same address on Arc mainnet and
// testnet (6 decimals). https://docs.arc.io/arc/references/contract-addresses
const ARC_USDC = "0x3600000000000000000000000000000000000000";

// Default cap: 100 USDC per reservation (USDC uses 6 decimals).
const DEFAULT_MAX_RESERVATION_AMOUNT = 100_000_000n;

export default buildModule("ShowUpV6Module", (module) => {
  const usdc = module.getParameter("usdc", ARC_USDC);
  const maxReservationAmount = module.getParameter(
    "maxReservationAmount",
    DEFAULT_MAX_RESERVATION_AMOUNT,
  );

  const showUpV6 = module.contract("ShowUpV6", [usdc, maxReservationAmount]);

  return { showUpV6 };
});
