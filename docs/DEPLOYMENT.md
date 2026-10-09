# Deploying ShowUp to Arc mainnet

This runbook takes ShowUp from a fresh checkout to a verified mainnet
contract, a production web app on Vercel's free plan, and the evidence
needed for a grant application. Do every step on **Arc Testnet first**, then
repeat on mainnet.

Steps marked **(owner)** need your accounts or keys and cannot be done by
anyone else. Never paste a private key into chat, an issue or a commit.

## 0. Prerequisites

- Node.js 22 and this repository (`npm ci` in the root and in `web/`).
- A dedicated **deployer wallet** used only for deployments. On Arc, gas is
  paid in USDC, so it needs a little USDC on each network (test USDC from
  https://faucet.circle.com for testnet; a few real USDC on mainnet).
- A Circle Developer account and a Vercel account. The free Hobby plan is
  enough for the demo: it never bills and instead pauses a service that
  exceeds its quota (Blob has storage, operation and transfer quotas). Hobby
  is for personal, non-commercial use, so check Vercel's terms for your case
  and move to a paid plan before ShowUp earns revenue.

## 1. Test the contract

```bash
npm ci
npm test
```

All tests must pass. CI also runs Slither and checks that the web app's ABI
and contract calls match the contract.

## 2. Store the deployer key (owner)

Use Hardhat's encrypted keystore instead of plain environment variables:

```bash
npx hardhat keystore set ARC_TESTNET_PRIVATE_KEY
npx hardhat keystore set ARC_MAINNET_PRIVATE_KEY
```

## 3. Deploy

Review `ignition/parameters/arc-<network>.json` first. `maxReservationAmount`
is the per-reservation cap in 6-decimal units (`100000000n` = 100 USDC). It
is fixed at deployment.

```bash
npm run deploy:testnet     # Arc Testnet, chain 5042002
npm run deploy:mainnet     # Arc, chain 5042
```

Ignition prints the address and records the deployment (build info,
constructor arguments, transaction) under
`ignition/deployments/chain-5042/`. **Commit that folder**: it is the
on-chain record that ties the address to this exact source.

## 4. Verify the source on the explorer

```bash
npx hardhat verify --network arcMainnet <ADDRESS> \
  0x3600000000000000000000000000000000000000 100000000
```

If API verification is rejected, use the explorer's web form instead:

```bash
node scripts/export-verification-input.mjs ignition/deployments/chain-5042
```

Upload the generated `ShowUpV6.standard-input.json` using the explorer's
standard-JSON verification option, with compiler `v0.8.24`, contract
`ShowUpV6`, and the constructor arguments above.

**Done when:** the explorer shows the contract as verified and its
`maxReservationAmount` reads the value you chose.

## 5. Configure Circle (owner)

1. In the Circle Developer Console, create (or switch to) the **production**
   environment for user-controlled wallets.
2. Create an API key and note the **App ID**.
3. Allow your production domain where the console asks for allowed origins.

Testnet keys only work with `ARC-TESTNET` wallets; mainnet needs the
production key and App ID so wallets are created on `ARC`.

## 6. Configure Vercel (owner)

1. Create one Vercel project per network (for example `showup-testnet` and
   `showup`), each with **Root Directory** `web`.
2. In each project, connect a Vercel Blob store (Storage → Blob). This sets
   `BLOB_READ_WRITE_TOKEN`. Separate stores keep testnet and mainnet media
   apart.
3. Add the variables from `web/.env.example`:

| Variable | Testnet project | Mainnet project |
|---|---|---|
| `NEXT_PUBLIC_SHOWUP_NETWORK` | `testnet` | `mainnet` |
| `NEXT_PUBLIC_SHOWUP_CHAIN_ID` | `5042002` | `5042` |
| `NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS` | testnet V6 address | mainnet V6 address |
| `CIRCLE_API_KEY`, `NEXT_PUBLIC_CIRCLE_APP_ID` | testnet values | production values |
| `SHOWUP_WALLET_AUTH_SECRET`, `SHOWUP_RECOVERY_SECRET` | `openssl rand -hex 32` | new values (do not reuse) |

4. Optional: `SHOWUP_MAX_TOTAL_VIDEOS` and `SHOWUP_MAX_TOTAL_EVENT_UPLOADS`
   cap all uploads together (defaults 20 and 100, sized for a 1 GB store).
5. **Testnet upgrade only:** existing users of the current testnet site
   keep their Circle wallets through a one-time migration, as long as the
   upgraded site stays on the same domain (browser storage is per domain). Set
   `SHOWUP_LEGACY_MIGRATION_UNTIL` to a date a few weeks ahead (for example
   `2026-11-15`) on the testnet project; after that date the migration route
   closes. Do not set it on mainnet.
6. Every build first runs `npm run check-contract` (the `prebuild` step). It
   reads the configured address from the network and stops the deploy unless
   it is a ShowUpV6 with Arc USDC, a non-zero cap, the expected check-in TTL
   and the right EIP-712 domain for that chain. You can run it yourself in
   `web/` with the same variables. Only builds without network access (CI)
   set `SHOWUP_SKIP_CONTRACT_CHECK=1`.
7. Deploy a **preview** first, run the checklist below against it, then
   promote it to production.

The app refuses to start if the network or contract address is missing or
inconsistent, so a misconfigured deployment fails loudly instead of quietly
using testnet values.

## 7. End-to-end checklist

Use two wallets (organizer and attendee) and the smallest amounts (for
example a 1 USDC deposit and a 2 USDC ticket). A step is **done** only when
the result is visible on-chain, not when a transaction hash appears.

| Flow | Done when |
|---|---|
| Connect a Circle wallet and a browser wallet | Both show the right network label and the wallet's USDC balance |
| Create a free event and a paid event | Both appear on /events; the creation transactions succeed on the explorer |
| Pricing above the cap is rejected | The create form shows the cap error and no transaction is sent |
| Reserve the free event | Reservation status is Reserved; the deposit left the attendee wallet; event escrow increased |
| Cancel before the deadline, then reserve again | Status Cancelled, then Reserved; the deposit came back and went in again |
| Organizer shows a check-in QR at start | The QR opens /events/<id>/check-in and shows a countdown |
| Attendee checks in | Status Attended; the deposit is back in the attendee wallet; the organizer record shows one self check-in |
| No-show is blocked after check-in | Settling a no-show for the checked-in attendee is refused, and their status stays Attended |
| Paid event: pay in full, check in | Status Attended; the price arrived in the organizer wallet |
| Fallback refund | For a reservation left unsettled, the attendee reclaims it after the resolution deadline |
| Reload during a transaction | After reload, the notice names that transaction and then shows its real result: confirmed only with a hash and successful receipt, failed with a reason, or unknown after 30 minutes |
| Existing testnet user after the upgrade | Opening the upgraded testnet site in the same browser shows the same Circle wallet without a recovery code |
| Abandoned upload authorization | A video upload started and cancelled does not reduce the quota once its lease (40 minutes) has passed |
| Failed event upload | Create an event with an image while the metadata step fails (for example disconnect mid-request): no image is left under showup/events/, and a dry run of `npm run blob-cleanup` lists nothing new |
| Circle smart-contract (SCA) organizer, if you use one | A check-in QR signed by the SCA wallet is accepted by the check-in page and on-chain |
| A second browser cannot reuse the Circle user ID | Opening the wallet in another browser asks for the recovery code; after restoring it works |
| Upload limits | A fourth video from the same wallet is refused with the limit message |
| Escrow is consistent | The contract's USDC balance on the explorer equals `totalEscrowed()` |

Write down every transaction hash as you go; they are the evidence for the
application.

## 8. Backups (owner)

Add `BLOB_READ_WRITE_TOKEN` as a GitHub repository secret. The
`Blob backup and cleanup` workflow then copies the Blob store every week
(and on demand from the Actions tab) and keeps each copy for 90 days.

After this version is live, also add a repository **variable**
`SHOWUP_CLEANUP_SINCE` set to its first deployment date (for example
`2026-10-20`). The workflow then removes uploads left behind by failures:
media that no used quota slot covers. Files older than that date (uploaded
before quotas existed) and files younger than about two hours are never
touched. To preview without deleting:

```bash
cd web
BLOB_READ_WRITE_TOKEN=... SHOWUP_CLEANUP_SINCE=2026-10-20 npm run blob-cleanup
```

To restore missing files to their original URLs from a backup:

```bash
cd web
BLOB_READ_WRITE_TOKEN=... node scripts/blob-restore.mjs ./blob-backup
```

## 9. Release record

```bash
git tag -a v1.0.0-mainnet -m "ShowUpV6 on Arc mainnet at <ADDRESS>"
git push --tags
```

Put the production URL, demo video and explorer link at the top of the
README.
