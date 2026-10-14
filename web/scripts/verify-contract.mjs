// Pre-build check: confirms that NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS really
// is a ShowUpV6 contract on the selected Arc network before the app is
// built. Runs automatically as "prebuild" (so on every Vercel deploy).
//
// Checks: RPC chain ID, contract code at the address, usdc(),
// maxReservationAmount(), MAX_CHECK_IN_CODE_TTL(), and the EIP-712 domain
// (name "ShowUp", version "6", chain ID, verifying contract).
//
// Set SHOWUP_SKIP_CONTRACT_CHECK=1 only for builds without network access
// (for example CI with a placeholder address).
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from "viem";

if (process.env.SHOWUP_SKIP_CONTRACT_CHECK === "1") {
  console.warn("Skipping the ShowUp contract check (SHOWUP_SKIP_CONTRACT_CHECK=1).");
  process.exit(0);
}

const NETWORKS = {
  testnet: { chainId: 5042002, rpc: "https://rpc.testnet.arc.io" },
  mainnet: { chainId: 5042, rpc: "https://rpc.mainnet.arc.io" },
};
const USDC = "0x3600000000000000000000000000000000000000";

function fail(message) {
  console.error(`\nShowUp contract check failed: ${message}\n`);
  process.exit(1);
}

const networkName = process.env.NEXT_PUBLIC_SHOWUP_NETWORK?.trim();
const network = NETWORKS[networkName];
if (!network) {
  fail('NEXT_PUBLIC_SHOWUP_NETWORK must be "testnet" or "mainnet".');
}

const rawAddress = process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS?.trim() ?? "";
if (!isAddress(rawAddress)) {
  fail("NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS is missing or invalid.");
}
const address = getAddress(rawAddress);

const client = createPublicClient({
  transport: http(process.env.SHOWUP_CHECK_RPC_URL || network.rpc, {
    timeout: 20_000,
    retryCount: 2,
  }),
});

const abi = parseAbi([
  "function usdc() view returns (address)",
  "function maxReservationAmount() view returns (uint256)",
  "function MAX_CHECK_IN_CODE_TTL() view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

try {
  const chainId = await client.getChainId();
  if (chainId !== network.chainId) {
    fail(`the RPC reports chain ${chainId}, expected ${network.chainId} for ${networkName}.`);
  }

  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    fail(`there is no contract at ${address} on ${networkName}.`);
  }

  const read = (functionName) =>
    client.readContract({ address, abi, functionName }).catch(() => {
      fail(`${address} does not implement ${functionName}(); it is not ShowUpV6.`);
    });

  const [usdc, cap, ttl, domain] = await Promise.all([
    read("usdc"),
    read("maxReservationAmount"),
    read("MAX_CHECK_IN_CODE_TTL"),
    read("eip712Domain"),
  ]);

  if (getAddress(usdc) !== USDC) {
    fail(`usdc() is ${usdc}, expected Arc USDC ${USDC}.`);
  }
  if (cap === 0n) {
    fail("maxReservationAmount() is zero.");
  }
  if (ttl !== 900n) {
    fail(`MAX_CHECK_IN_CODE_TTL() is ${ttl}, expected 900.`);
  }
  const [, name, version, domainChainId, verifyingContract] = domain;
  if (
    name !== "ShowUp" ||
    version !== "6" ||
    Number(domainChainId) !== network.chainId ||
    getAddress(verifyingContract) !== address
  ) {
    fail(`unexpected EIP-712 domain: ${name} v${version}, chain ${domainChainId}, ${verifyingContract}.`);
  }

  console.log(
    `ShowUp contract check passed: ShowUpV6 at ${address} on ${networkName} (cap ${Number(cap) / 1e6} USDC).`,
  );
} catch (error) {
  fail(`could not reach the ${networkName} RPC (${error instanceof Error ? error.message : error}).`);
}
