// Fails if a Circle contract-execution signature used by the web app does
// not exist in the compiled ShowUpV6 ABI (catches renamed or changed
// functions before they reach users). ERC-20 and CCTP calls are skipped.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const abi = JSON.parse(
  readFileSync("artifacts/contracts/ShowUpV6.sol/ShowUpV6.json", "utf8"),
).abi;

const known = new Set(
  abi
    .filter((item) => item.type === "function")
    .map((fn) => `${fn.name}(${fn.inputs.map((input) => input.type).join(",")})`),
);

const external = new Set([
  "approve(address,uint256)",
  "depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)",
  "receiveMessage(bytes,bytes)",
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

const problems = [];
for (const file of walk("web/src")) {
  const source = readFileSync(file, "utf8");
  // Signatures may be split across lines in the source; normalise spacing.
  for (const match of source.matchAll(/"([a-zA-Z]+\([a-z0-9,\[\]]*\))"/g)) {
    const signature = match[1];
    if (!/^[a-z]/.test(signature) || external.has(signature)) continue;
    if (!signature.includes("(")) continue;
    const name = signature.slice(0, signature.indexOf("("));
    const isShowUpName = abi.some((item) => item.name === name);
    if (isShowUpName && !known.has(signature)) {
      problems.push(`${file}: ${signature}`);
    }
  }
}

if (problems.length) {
  console.error("Contract calls that do not match the ShowUpV6 ABI:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("All ShowUp contract-call signatures in the web app match the ABI.");
