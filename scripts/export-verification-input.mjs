// Writes the Solidity "standard JSON input" for a deployment so the contract
// can be verified in the explorer UI ("Standard JSON input" method) when API
// verification is not available.
//
// Usage: node scripts/export-verification-input.mjs ignition/deployments/chain-5042
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const deploymentDir = process.argv[2];
if (!deploymentDir) {
  console.error("Usage: node scripts/export-verification-input.mjs <ignition deployment dir>");
  process.exit(1);
}

const buildInfoDir = join(deploymentDir, "build-info");
const files = readdirSync(buildInfoDir).filter(
  (name) => name.endsWith(".json") && !name.endsWith(".output.json"),
);

for (const name of files) {
  const buildInfo = JSON.parse(readFileSync(join(buildInfoDir, name), "utf8"));
  if (!buildInfo.input?.sources?.["project/contracts/ShowUpV6.sol"] &&
      !Object.keys(buildInfo.input?.sources ?? {}).some((s) => s.endsWith("ShowUpV6.sol"))) {
    continue;
  }
  const out = join(deploymentDir, "ShowUpV6.standard-input.json");
  writeFileSync(out, JSON.stringify(buildInfo.input, null, 2));
  console.log(`Compiler: ${buildInfo.solcLongVersion ?? buildInfo.solcVersion}`);
  console.log(`Wrote ${out}`);
  process.exit(0);
}

console.error("No build-info containing ShowUpV6.sol was found.");
process.exit(1);
