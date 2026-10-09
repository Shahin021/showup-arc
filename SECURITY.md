# Security and trust model

ShowUp holds real USDC on Arc mainnet. This document explains who has to be
trusted for what, what the contract guarantees, and what it does not.

## Reporting a vulnerability

Please report security issues privately through GitHub's
[security advisory form](../../security/advisories/new) rather than in a
public issue. Include the contract address or page, the steps to reproduce,
and the impact you expect.

## What the contract guarantees

`ShowUpV6` has **no owner, admin, pause or upgrade function**. Nobody,
including the deployer, can move escrowed USDC outside these paths:

| Path | Who can call | Funds go to |
|---|---|---|
| `cancelReservation` (before the cancellation deadline) | Attendee | Attendee |
| `checkIn` (with a valid organizer-signed code, during the event) | Attendee | Free: attendee. Paid: organizer |
| `confirmAttendance` | Organizer | Free: attendee. Paid: organizer |
| `settleNoShow` (after the event ends, before the resolution deadline) | Organizer | Organizer |
| `markPaymentDefault` (unpaid balance after the payment deadline) | Anyone | Organizer (deposit only) |
| `claimFallbackRefund` (after the resolution deadline) | Attendee | Attendee |
| `claimCancelledEventRefund` (after the organizer cancels) | Attendee | Attendee |

Invariants checked by the test suite after every step of randomized
operation sequences:

- `totalEscrowed` equals the contract's USDC balance.
- Each event's `escrowedAmount` equals the sum of what its open reservations
  have locked, and the events sum to `totalEscrowed`.
- Seat counts match reservation statuses and never exceed capacity.
- No USDC is created or lost: all balances always sum to the supply.
- A checked-in reservation is always settled as attended.

## Trust in the organizer

The organizer is still trusted to settle honestly. Specifically, an
organizer can mark a reservation as a no-show unless the attendee checked
in, and for paid events the organizer receives the ticket price either way.

V6 limits and exposes this trust:

1. **Self check-in.** An attendee who checks in can no longer be marked as a
   no-show. A check-in code is an EIP-712 signature by the organizer over
   the event ID, an optional attendee address, an issue time and an expiry,
   bound to Arc's chain ID and the contract address. Codes are valid for at
   most 15 minutes and only between the event start and end.
2. **Per-reservation cap.** `maxReservationAmount` (set at deployment, 100
   USDC by default) bounds the deposit of a free event and the full ticket
   price of a paid event, so it bounds what one attendee can lose.
3. **Public record.** `getOrganizerStats` exposes how many no-shows an
   organizer has settled and how much they collected, and the event page
   shows it before anyone reserves.

What self check-in does **not** prove:

- **Physical presence.** An open code proves the attendee saw a valid code
  while it was valid. Someone at the venue could forward it to an absent
  attendee within its lifetime. Personal codes (bound to one wallet) and
  short code lifetimes reduce, but do not eliminate, this.
- **Fair access to the code.** An organizer can refuse to show a code and
  then mark attendees as no-shows. The cap bounds the loss and the public
  record makes the pattern visible, but there is no on-chain dispute
  process or arbiter.

If the organizer does nothing at all, every attendee gets their full
deposit or payment back through `claimFallbackRefund` after the resolution
deadline (at most 7 days after the event ends).

## Arc-specific behaviour

- USDC is both the gas token (18 decimals natively) and an ERC-20 at
  `0x3600…0000` (6 decimals) over the same balance. The contract only uses
  the ERC-20 interface. The app never adds the two representations. When
  checking whether a wallet can pay, it keeps aside an estimate of the fees
  for the approval, the payment and one follow-up transaction, computed
  from the current fee level (minimum 0.02 USDC). It is an estimate, not a
  guarantee, because fees can change before the transaction is sent.
- USDC transfers to or from a blocklisted address revert. A refund to a
  blocklisted attendee therefore cannot be paid out; a batch that includes
  such an attendee reverts as a whole, and the organizer can retry without
  them. Tests cover this with a blocklist mock.
- Block timestamps can repeat across blocks. Deadlines use inclusive or
  exclusive comparisons so that the check-in window (`start <= t < end`)
  and the no-show window (`end <= t <= resolution`) never overlap.
- Browser-wallet transactions set at least Arc's 20 gwei fee floor, below
  which transactions are dropped without an error.
- Organizers may use smart contract wallets: invitations and check-in codes
  are verified with ERC-1271 both on-chain and in the app, and tests cover a
  smart-wallet organizer.

## Web application

- **Wallet verification.** Every API route that prepares a transaction or
  accepts an upload verifies the Circle wallet with Circle, or a signed
  browser-wallet session cookie bound to the domain and chain ID.
- **Circle sessions.** Circle sessions are issued from a Circle user ID.
  The server only accepts an ID together with an httpOnly cookie it signed
  for that ID, set when the user was created in that browser or restored
  with a recovery code. Knowing someone's user ID is therefore not enough to
  open their session or to mint a recovery code, and every transaction
  still requires the user's PIN. A new browser needs the recovery code.
  Users of the earlier testnet site (ID in the browser, no cookie) are
  migrated once by `/api/circle/legacy-migrate`, which accepts a bare ID.
  That route exists only on testnet and only until
  `SHOWUP_LEGACY_MIGRATION_UNTIL`; mainnet uses a new production Circle app
  with no legacy users, so it never accepts a bare ID.
- **Transaction results.** After a reload, a pending transaction is
  followed by its own Circle reference ID or transaction hash. A Circle
  transaction is matched only by its reference ID, never by "the latest
  transaction from the wallet", and it is reported as confirmed only when
  its hash has a successful on-chain receipt. Otherwise it stays pending
  and is reported as unknown after 30 minutes.
- **Uploads.** Uploads require a verified wallet. Before an upload is
  authorized, the server reserves a per-wallet slot (3 videos, 25 event
  uploads) and an app-wide slot (20 videos and 100 event uploads by default,
  set with `SHOWUP_MAX_TOTAL_VIDEOS` and `SHOWUP_MAX_TOTAL_EVENT_UPLOADS`).
  Each slot is a single record whose state (reserved, used, or free once a
  reservation expires) changes only through writes conditioned on the ETag
  the request holds, so concurrent requests never share a slot, and a
  request whose lease expired can neither finalize nor free a slot someone
  else has taken over. Abandoned authorizations expire (40 minutes for
  videos, 5 for event uploads) and free their slots.
- **No uncounted files.** Stored media must end up covered by a used slot.
  A failed event upload deletes every file it stored and releases its
  slots; if finalizing fails because a lease was lost, the files are
  deleted and any slot already finalized is rolled back. A video whose
  slots cannot be finalized is deleted. If a deletion itself fails (or the
  server crashes mid-upload), the weekly cleanup job removes media that no
  used slot covers, ignoring files younger than about two hours and files
  uploaded before `SHOWUP_CLEANUP_SINCE`. The opposite case is possible but
  safe: an unexpected error after one slot was finalized can leave that
  slot counted without media, which slightly over-counts the quota.
- **Testing and limits of the guarantees.** The lease logic is tested
  against an in-memory model of the Blob operations, including randomized
  interleavings of a stale finalize with a takeover (`web/tests`); it has
  not yet been run against a live Blob store. A per-IP rate limit adds
  burst protection, but it is per server instance, so it is best effort.
  Files are checked by their leading bytes, which rejects renamed or
  mislabelled files; this is a format check and does not prove a video is
  complete or playable.
- **Hosting limits.** Vercel's free (Hobby) plan includes limited Blob
  storage (1 GB), operations and data transfer. Exceeding any of them pauses
  Blob for 30 days rather than billing; the app-wide caps keep storage
  within the limit, and quota checks themselves use Blob operations. Event
  titles, descriptions, prices and all funds are on-chain and keep working;
  only images, video and long descriptions would be unavailable. A weekly
  backup workflow copies the Blob store, and a restore script puts files
  back at the same URLs. Hobby is for personal, non-commercial use; move to
  a paid plan before ShowUp earns revenue.
- **No secrets in the browser.** The Circle API key and the server secrets
  are only used in API routes. Never commit `.env` files or private keys;
  use the Hardhat keystore for the deployer key.

## Before deploying a new version

- Run the full test suite and Slither (CI does both).
- Deploy to Arc Testnet first and run the end-to-end checklist in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Record the commit, compiler settings, constructor arguments and address
  (Hardhat Ignition writes them to `ignition/deployments/`), and verify the
  source on the explorer.
