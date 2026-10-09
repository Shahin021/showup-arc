# Deploying ShowUp to Arc mainnet

This runbook takes ShowUp from this repository to a verified ShowUpV6
contract on Arc mainnet, a production web app on Vercel, and an end-to-end
test with two wallets and very small amounts of USDC.

Steps marked **(owner)** need your accounts or keys. Never paste a private
key, API key or secret into chat, an issue or a commit.

> Nothing in this repository has been run against the live Arc network,
> Circle's production API or a live Vercel Blob store yet. The end-to-end
> run in step 9 is the first live test. See "Not yet tested live" at the end.

## 0. What you need

- Node.js 22.
- **Deployer wallet (owner):** a fresh EOA used only for deployment, holding
  about 1 USDC on Arc mainnet (gas is paid in USDC; deployment costs well
  under that).
- **Two test wallets (owner):** an organizer and an attendee, each with a
  few USDC on Arc mainnet. Circle wallets are created in the app; send them
  USDC on Arc after they exist.
- A Circle Developer Console account with access to the production
  environment for user-controlled wallets.
- A Vercel account. The free Hobby plan never bills; it pauses a service
  that exceeds its quota (Blob has storage, operation and transfer quotas).
  Hobby is for personal, non-commercial use; check Vercel's terms for your
  case and move to a paid plan before ShowUp earns revenue.

## 1. Apply the changes and run the tests

```bash
git checkout -b mainnet-v6
git am /path/to/showup-mainnet-v6.patch

npm ci
npm test                       # 132 contract tests

cd web
npm ci
npm test                       # upload quota and callback tests
npm run lint
npx tsc --noEmit
cd ..
```

Everything must pass. Push the branch and let CI run as well (it also runs
Slither and checks the web ABI against the contract).

## 2. The reservation cap: 20 USDC

`ignition/parameters/arc-mainnet.json` sets `maxReservationAmount`, the most
USDC a single reservation can ever lock, to `20000000n` (20 USDC, 6
decimals). It is fixed for the life of the contract, and the verify command
in step 5 uses the same value (`20000000`).

## 3. Store the deployer key (owner)

Use Hardhat's encrypted keystore instead of an environment variable:

```bash
npx hardhat keystore set ARC_MAINNET_PRIVATE_KEY
```

Optional, if you prefer a dedicated RPC to the public one:

```bash
export ARC_MAINNET_RPC_URL="https://arc-mainnet.g.alchemy.com/v2/<key>"
```

## 4. Deploy the contract (owner)

```bash
npm run deploy:mainnet
```

This runs Hardhat Ignition with `ignition/parameters/arc-mainnet.json`
(USDC `0x3600000000000000000000000000000000000000`, your cap). It prints
`ShowUpV6Module#ShowUpV6 - 0x…`. That is your **contract address**.

Ignition records the deployment under `ignition/deployments/chain-5042/`
(build info, constructor arguments, transaction). Commit it:

```bash
git add ignition/deployments/chain-5042 ignition/parameters/arc-mainnet.json
git commit -m "Deploy ShowUpV6 to Arc mainnet"
```

## 5. Verify the source on the explorer

```bash
npx hardhat verify --network arcMainnet <CONTRACT_ADDRESS> \
  0x3600000000000000000000000000000000000000 <CAP_IN_UNITS>
```

`<CAP_IN_UNITS>` is the cap without the `n`: `20000000`.

If API verification is rejected, use the explorer's web form:

```bash
node scripts/export-verification-input.mjs ignition/deployments/chain-5042
```

Upload `ignition/deployments/chain-5042/ShowUpV6.standard-input.json` with
the explorer's standard-JSON option: compiler `v0.8.24`, contract
`ShowUpV6`, and the two constructor arguments above.

**Done when** https://explorer.arc.io/address/<CONTRACT_ADDRESS> shows the
contract as verified.

## 6. Check the address the app will use

```bash
cd web
NEXT_PUBLIC_SHOWUP_NETWORK=mainnet \
NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS=<CONTRACT_ADDRESS> \
npm run check-contract
cd ..
```

It must print `ShowUp contract check passed: ShowUpV6 at … on mainnet`. It
confirms the chain ID, that code exists, `usdc()`, the cap, the check-in
TTL and the EIP-712 domain. Vercel runs the same check before every build.

## 7. Configure Circle production (owner)

1. In the Circle Developer Console, switch to the **production**
   environment for user-controlled wallets. (Testnet API keys only work
   with `ARC-TESTNET`; mainnet wallets are created on `ARC`.)
2. Create an API key. This is `CIRCLE_API_KEY`.
3. Note the user-controlled wallets **App ID**. This is
   `NEXT_PUBLIC_CIRCLE_APP_ID`.
4. Add your production domain (and, for step 8, the Vercel preview domain)
   wherever the console asks for allowed origins.

Production Circle users are separate from testnet users, so nobody needs to
migrate: everyone starts fresh on mainnet.

## 8. Configure Vercel (owner)

1. Create a Vercel project from the repository with **Root Directory**
   `web` (framework: Next.js; build command and output: defaults).
2. Storage → Blob → create a store and connect it to the project. This adds
   `BLOB_READ_WRITE_TOKEN` automatically.
3. Settings → Environment Variables (Production and Preview):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SHOWUP_NETWORK` | `mainnet` |
| `NEXT_PUBLIC_SHOWUP_CHAIN_ID` | `5042` |
| `NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS` | your contract address |
| `CIRCLE_API_KEY` | production API key (step 7) |
| `NEXT_PUBLIC_CIRCLE_APP_ID` | production App ID (step 7) |
| `SHOWUP_WALLET_AUTH_SECRET` | output of `openssl rand -hex 32` |
| `SHOWUP_RECOVERY_SECRET` | output of another `openssl rand -hex 32` |
| `BLOB_READ_WRITE_TOKEN` | set by step 2 |

Optional:

| Variable | Value |
|---|---|
| `SHOWUP_MAX_TOTAL_VIDEOS` | default `20` |
| `SHOWUP_MAX_TOTAL_EVENT_UPLOADS` | default `100` |
| `SHOWUP_CHECK_RPC_URL` | RPC for the build-time contract check |
| `NEXT_PUBLIC_ENABLE_FIAT_ONRAMP`, `NEXT_PUBLIC_FIAT_ONRAMP_URL` | card on-ramp, if you have one |

Do **not** set `SHOWUP_SKIP_CONTRACT_CHECK` (CI only) or
`SHOWUP_LEGACY_MIGRATION_UNTIL` (testnet upgrades only). Keep the two
secrets safe: changing `SHOWUP_RECOVERY_SECRET` later invalidates every
recovery code users have saved.

4. Deploy a **Preview** first. The build log must show
   `ShowUp contract check passed`. Run the checklist below on the preview
   URL, then promote it to Production.

## 9. End-to-end test on mainnet (owner)

Use the smallest amounts: for example a **0.5 USDC deposit** for the free
event and a **1 USDC ticket** for the paid event. A step is done only when
the result is visible on-chain, never just because a hash appeared.

The create form needs a cancellation period and a resolution period of at
least 1 hour. A practical plan: create both events to start about 2 hours
from now, last 30 minutes, with 1 hour cancellation and 1 hour resolution.
The fallback refund then becomes available about 3.5 hours after creation.
Paid events starting within 24 hours only allow paying in full, which is
what this test uses.

| # | Flow | Done when |
|---|---|---|
| 1 | Organizer connects a Circle wallet; attendee connects a Circle or browser wallet | The header shows "Arc mainnet" and each wallet page shows its USDC balance |
| 2 | Organizer creates the free event (0.5 USDC deposit) and the paid event (1 USDC) | Both appear on /events; the creation transactions succeed on the explorer |
| 3 | Organizer tries a deposit above the cap | The form shows the cap error and no transaction is sent |
| 4 | Attendee reserves the free event | Status Reserved; 0.5 USDC left the attendee wallet |
| 5 | Attendee cancels, then reserves again (before the cancellation deadline) | Status Cancelled, then Reserved; the deposit came back, then went in again |
| 6 | Attendee pays the paid event in full | Status Completed (paid) |
| 7 | At the start time, the organizer opens the event page and creates the check-in QR | The QR opens /events/<id>/check-in and shows a countdown |
| 8 | Attendee checks in to both events | Free: status Attended and the deposit is back in the attendee wallet. Paid: status Attended and 1 USDC arrived in the organizer wallet. The organizer record shows two self check-ins |
| 9 | After the event ends, the organizer tries to mark the attendee as a no-show | Refused; status stays Attended |
| 10 | Reload the page while a transaction is confirming | After reload, the notice names that transaction and then shows its real result |
| 11 | A second browser opens the attendee's Circle wallet | It asks for the recovery code; after restoring, it works |
| 12 | Upload an event image and a short video | Both display on the event page |
| 13 | Escrow consistency | The contract's USDC balance on the explorer equals `totalEscrowed()` (0 after everyone has checked in) |

Optional: leave one reservation unsettled (for example on a third small
free event that nobody checks in to). After its resolution deadline, the
attendee claims the fallback refund and gets the deposit back.

Write down every transaction hash; they are the evidence for the grant.

## 10. Backups and cleanup (owner)

1. GitHub → Settings → Secrets → Actions: add `BLOB_READ_WRITE_TOKEN` (the
   same value as in Vercel). The weekly **Blob backup and cleanup** workflow
   then copies the Blob store and keeps each copy for 90 days. You can also
   run it from the Actions tab.
2. GitHub → Settings → Variables → Actions: add `SHOWUP_CLEANUP_SINCE` set
   to today's date (the first production deploy, for example
   `2026-10-10`). The workflow then **lists** uploads that no used quota
   slot covers. It deletes nothing until you also add the variable
   `SHOWUP_CLEANUP_DELETE` = `true`; only do that after reviewing a dry run
   of the live store. If any quota record cannot be read or verified, the
   job stops without deleting anything.

A dry run by hand:

```bash
cd web
BLOB_READ_WRITE_TOKEN=... SHOWUP_CLEANUP_SINCE=2026-10-10 npm run blob-cleanup
```

Restore missing files to their original URLs from a backup:

```bash
cd web
BLOB_READ_WRITE_TOKEN=... node scripts/blob-restore.mjs ./blob-backup
```

## 11. Release record

```bash
git tag -a v1.0.0-mainnet -m "ShowUpV6 on Arc mainnet at <CONTRACT_ADDRESS>"
git push origin mainnet-v6 --tags
```

Put the production URL, demo video and explorer link at the top of the
README, and fill in `docs/SUBMISSION.md`.

## Not yet tested live

These are covered by unit tests or local simulations only, and step 9 is
their first real run:

- **Arc mainnet:** chain ID, RPC URLs, explorer verification, the 20 gwei
  fee floor for browser wallets, and the gas-reserve estimate. The contract
  check script was tested against a local chain, not against Arc.
- **Circle production:** wallet creation on `ARC`, PIN challenges, typed-
  data signing for check-in codes, the transaction-result lookup, and the
  session cookie and recovery flow.
- **Vercel Blob:** the quota leases (conditional writes with `ifMatch`,
  no-overwrite writes, the "already exists" error text), the ETag returned
  with file content (the callback and cleanup rely on it; if the CDN does
  not return a matching ETag, repeated callbacks keep the video and the
  cleanup job stops, which is safe but means cleanup will not run),
  redelivered upload webhooks, and the backup and cleanup workflow.
- **Smart-contract (SCA) organizer wallets:** ERC-1271 signatures are
  covered by tests with a mock wallet, not with a real Circle SCA wallet.

## Testnet (optional)

The app still supports Arc Testnet (`NEXT_PUBLIC_SHOWUP_NETWORK=testnet`,
`npm run deploy:testnet`, testnet Circle keys). It is not part of this
mainnet plan. If you later upgrade the existing testnet site, set
`SHOWUP_LEGACY_MIGRATION_UNTIL` there so its users keep their wallets.
