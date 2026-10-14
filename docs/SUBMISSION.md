# Arc Microgrants submission notes

Copy-ready text for the DoraHacks BUIDL page, plus the evidence checklist.
Fill in the placeholders after the mainnet deployment.

## Name

ShowUp

## One-line description

Accountable events on Arc: attendees lock a small USDC commitment, check in
at the venue from their own wallet, and get it back automatically.

## Description

Free events routinely lose a large share of sign-ups to no-shows, and paid
events ask attendees to trust the organizer with their money. ShowUp puts
the commitment on Arc. Organizers create free events with a refundable USDC
deposit or paid events with full or split payments. Attendees reserve with
a compatible browser wallet; the USDC sits
in a contract with no admin keys.

At the venue, the organizer shows a short-lived QR code signed with their
wallet. Attendees scan it and check in themselves; for free events the
deposit comes back in the same transaction, for paid events the ticket
price is released to the organizer. A checked-in attendee can no longer be
marked as a no-show. If the organizer never settles, every attendee can
reclaim their funds after a deadline. Each organizer's settlement record
(attendances, check-ins, no-shows collected) is public on-chain and shown
before anyone reserves, and a per-reservation cap bounds what any attendee
can lose.

## Arc component

- `ShowUpV6` is deployed and verified on Arc mainnet: `0x6108613878E4FA3531f3CB478D12AC49147d7366`
  (https://sourcify.dev/server/repo-ui/5042/0x6108613878E4FA3531f3CB478D12AC49147d7366).
- All payments, refunds and settlements are USDC on Arc; gas is paid in
  USDC, so users hold a single asset.
- The current deployment uses browser wallets on Arc. Circle embedded wallets
  are retained as an optional integration, but are not enabled in this demo.
- Sub-second finality makes door check-ins practical.

## Links

- Live app: `<URL>`
- Repository: https://github.com/Shahin021/showup-arc (release tag
  `v1.0.0-mainnet`, commit `<SHA>`)
- Demo video (mainnet): `<URL>`
- Contract on the explorer: `<URL>`

## Evidence of real mainnet use

Transactions from the end-to-end run in `docs/DEPLOYMENT.md`:

| Action | Transaction |
|---|---|
| Contract deployment | `<HASH>` |
| Create a free event | `<HASH>` |
| Create a paid event | `<HASH>` |
| Reserve (deposit) | `<HASH>` |
| Self check-in (deposit refunded) | `<HASH>` |
| Paid reservation and check-in (price released) | `<HASH>` |

## What the grant would fund

- An external review of the contract before deploying a future version with a higher per-reservation cap.
- Organizer-side tooling: rotating check-in codes on a dedicated door
  screen and an attendee list export after the event.
- Running pilots with real community events and publishing the no-show
  data.

## Eligibility checklist

- [ ] Deployed and working on Arc mainnet (not testnet only).
- [ ] Public repository with the deployed source and verification.
- [ ] Wallet that can receive USDC on Arc ready for the grant.
- [ ] Not previously funded by a Circle or Arc program.
- [ ] One submission for this project.
- [ ] Program rules and any regional restrictions read on the DoraHacks
      page before submitting.
