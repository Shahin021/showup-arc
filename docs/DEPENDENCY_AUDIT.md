# Dependency audit — web app

Reviewed on 2026-10-12 against the v3 code (`mainnet-v6` + bridge/swap/nav v3).
This is a record of what was checked, changed and left, with evidence. It is
not a statement that the dependency tree is free of vulnerabilities.

## Summary

| Audit | Before | After |
| --- | --- | --- |
| `web`: `npm audit --omit=dev` (production) | 29 — 8 low, 12 moderate, 9 high | **20 — 20 low, 0 moderate, 0 high** |
| `web`: `npm audit` (all) | 34 — 8 low, 12 moderate, 14 high | 25 — 20 low, 0 moderate, 5 high (dev-only) |
| root (Hardhat): `npm audit --omit=dev` | 0 | 0 (unchanged) |
| root (Hardhat): `npm audit` (all) | 15 — 8 low, 2 moderate, 5 high | 15 (unchanged, dev-only, see below) |

npm counts one advisory again for every package that depends on it. All 20
remaining production findings come from a **single** advisory (`elliptic`),
which has no fixed release.

## Changes (web/package.json `overrides`)

Each override is scoped to the one parent that pulls the vulnerable copy and
pinned to the exact version that was reviewed. App Kit stays at 1.16.0; the
existing `firebase → undici 6.29.0` and `@grpc/grpc-js 1.13.6` overrides are
unchanged, as are Next 16.4.0, viem and the Circle adapter.

| Override | Was | Fixes | Compatibility checked |
| --- | --- | --- | --- |
| `@solana/web3.js` → `jayson` 5.0.0 | 4.3.0 | stream-json (GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x, GHSA-mjw6-4jj6-33hc) and uuid 8.3.2 (GHSA-w5hq-g745-h8pq): jayson 5 no longer depends on either | web3.js only imports `jayson/lib/client/browser` (client and SSR). That file is unchanged in 5.0.0 apart from formatting, except request ids now come from `lib/generateId.js` (Web Crypto `randomUUID`, fallback `getRandomValues`), available in browsers and Node ≥19. Still CommonJS. Requires Node ≥20 (CI uses 22). |
| `@coral-xyz/anchor` → `toml` 4.2.0 | 3.0.0 | GHSA-82x6-q7mm-w9cf (uncontrolled recursion), GHSA-v5mp-jgw5-2x6j (prototype pollution) | Same CommonJS `parse(input)` that Anchor calls (`toml.parse(fs.readFileSync("Anchor.toml"))`); 4.2.0 only adds an optional second argument. 4.3.0 was not chosen: it adds a Temporal date mode that is not needed. Requires Node ≥20. |
| `@circle-fin/w3s-pw-web-sdk` → `uuid` 11.1.1 | 9.0.1 | GHSA-w5hq-g745-h8pq | The SDK is CommonJS (`require("uuid").v4`). uuid 11.1.1 still ships CommonJS for Node and browser (`require` conditions → `dist/cjs`, `dist/cjs-browser`); 12+ was not used. Only `v4()` is called. |

Rejected options:

- `stream-json` → 3.x: ESM-only (`"type": "module"`, no `require` export); jayson 4 `require`s it. Replaced by the jayson override instead.
- `npm audit fix --force`: proposes `@circle-fin/app-kit` 1.8.1 and `eslint-config-next` 14.2.35 (major downgrades). Not used.

Lockfile effect (only these entries changed): jayson 4.3.0 → 5.0.0,
toml 3.0.0 → 4.2.0, uuid 9.0.1 → 11.1.1; removed jayson's nested uuid 8.3.2,
stream-json 1.9.1, stream-chain 2.2.5 and eyes 0.1.8.

## Where each package runs in ShowUp (evidence)

From source maps of a mainnet production build (`productionBrowserSourceMaps`
enabled only for the analysis build), before → after:

| Package | Client bundle | Server (SSR) bundle | Notes |
| --- | --- | --- | --- |
| `@solana/web3.js` (via `@circle-fin/adapter-viem-v2`, App Kit) | yes (53 source files) | its `jayson` and `rpc-websockets` modules appear in SSR chunks; web3.js's own files are not listed in the server maps | Loaded with the bridge/swap UI. ShowUp makes no Solana calls, but the code is shipped and its module code runs. |
| `jayson` | 4.3.0 → 5.0.0 (`lib/client/browser`) | same | Used by web3.js's RPC client. |
| `uuid` | jayson's 8.3.2 + 9.0.1 → 11.1.1 only | jayson's 8.3.2 + 9.0.1 → 11.1.1 (+ rpc-websockets' 14.0.1) | Callers use `v4()` only. |
| `stream-json` | not included | not included | Removed from the tree. |
| `toml` | not included | 3.0.0 → 4.2.0 | Only reachable through Anchor's `workspace` getter, which parses a local `Anchor.toml`. No Circle package accesses `.workspace`. |
| `elliptic` | not included | not included | Tree-shaken; the adapter only uses `@ethersproject/abi`. |

API routes do not import App Kit, the adapter or the Circle PIN SDK
(`grep` of `src/app/api`); they reach the server only through SSR of the
client components that import them.

## Remaining findings

### `elliptic` ≤ 6.6.1 — GHSA-848j-6mx2-7j84 (low), 20 production entries

- Chain: `@circle-fin/adapter-viem-v2` / App Kit providers → `@ethersproject/abi`
  → hash → abstract-signer → abstract-provider → transactions → signing-key
  → `elliptic` 6.6.1.
- No fixed release exists (6.6.1 is the latest; `@ethersproject/signing-key`
  latest 5.8.0 still depends on it).
- Not present in the client or server output of the build (see table). ShowUp
  never signs with ethers or elliptic: wallets sign in the browser wallet,
  and viem uses `@noble/curves`.
- Action: none possible without a new upstream release; re-check when
  Circle or `@ethersproject` publish an update.

### `braces` ≤ 3.0.3 — GHSA-vfj7-8cjw-p6xm (high), dev-only, 5 entries

- Chain: `eslint-config-next` 16.4.0 → `@next/eslint-plugin-next` → `fast-glob`
  → `micromatch` → `braces`.
- No fixed `braces` release exists (3.0.3 is the latest and is in range).
  npm's only suggestion is `eslint-config-next` 14.2.35, a major downgrade.
- Only used by ESLint during development/CI; not installed by `--omit=dev`,
  not part of the deployed app.

### Root project (Hardhat toolchain), dev-only, 15 entries — unchanged

`adm-zip` (via `hardhat` 3.10.0), `undici` 5.29.0 / 6.27.0, `@fastify/busboy`
(via `@actions/core` in the Hardhat test reporter), `lodash-es` (via Ignition)
and `elliptic` (via `hardhat-verify`). None is part of the web app; the root
production audit is 0. Hardhat 3.19.0 depends on `adm-zip ^0.6.0`. Upgrading
the contract toolchain is a separate change: it was not done here because
`npx hardhat compile`/`test` could not be run in this environment (compiler
download blocked). When you next work on the contracts locally, update the
Hardhat packages and run `npx hardhat test` before relying on them, and keep
deployer keys away from machines running unreviewed tooling updates.

## Verification performed

- `npm ci` from the final lockfile (clean tree), lint, `tsc --noEmit`, all web
  tests (113) for mainnet and testnet, mainnet and testnet builds.
- `tests/dependency-compat.test.mts` exercises the real packages:
  web3.js RPC through jayson 5 (UUID ids), Anchor's toml (parse; deep nesting
  rejected with a controlled error — fails on toml 3.0.0 with a stack
  overflow), the PIN SDK's `require("uuid").v4` (buffer bounds check — fails
  on uuid 9.0.1), and App Kit + viem adapter running the Arc swap estimate up
  to Circle's Stablecoin Service request with the owner as `fromAddress`.
  The prototype-pollution check is a sanity check only: simple `__proto__`
  inputs did not pollute toml 3.0.0 either.
- Browser (built app, test wallet, Circle API intercepted): the swap page
  loads App Kit and the adapter, sends `POST /v1/stablecoinKits/swap` with the
  owner as `fromAddress` and without the `x-user-agent` header, shows Circle's
  error, no page errors. Navigation and swap wallet-listener checks pass.

Not verified: a real Circle quote or swap, the PIN SDK's social-login path
(the only `uuid` caller; not used by ShowUp's browser-wallet mode), and the
Vercel build with the live contract check (done by you).

## Maintenance

Remove an override once its parent ships a release that depends on a fixed
version (re-run `npm ls jayson toml uuid` and `npm audit`). Re-run
`node --conditions=react-server --import tsx --test tests/dependency-compat.test.mts`
after any dependency update.
