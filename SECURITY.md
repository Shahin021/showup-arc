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
  the ERC-20 interface. The app never adds the two representations and
  keeps 0.10 USDC aside for fees when checking whether a wallet can pay.
- USDC transfers to or from a blocklisted address revert. A refund to a
  blocklisted attendee therefore cannot be paid out; a batch that includes
  such an attendee reverts as a whole, and the organizer can retry without
  them. Tests cover this with a blocklist mock.
- Block timestamps can repeat across blocks. Deadlines use inclusive or
  exclusive comparisons so that the check-in window (`start <= t < end`)
  and the no-show window (`end <= t <= resolution`) never overlap.
- Browser-wallet transactions set at least Arc's 20 gwei fee floor, below
  which transactions are dropped without an error.

## Web application

- **Wallet verification.** Every API route that prepares a transaction or
  accepts an upload verifies the Circle wallet with Circle, or a signed
  browser-wallet session cookie bound to the domain and chain ID.
- **Circle sessions.** A Circle session is obtained from a Circle user ID
  stored in the browser. That ID therefore acts as a bearer credential for
  reading the user's wallets; every transaction still requires the user's
  PIN, so funds cannot be moved with the ID alone. Treat a shared or public
  computer accordingly.
- **Uploads.** Uploads require a verified wallet, are limited per wallet
  (3 videos up to 25 MB, 25 event uploads), and are checked by their actual
  file bytes, not only the declared type. Uploaded videos that are not real
  MP4 or WebM files are deleted.
- **Hosting limits.** On Vercel's free (Hobby) plan, exceeding the included
  Blob storage pauses uploads and media for 30 days rather than billing.
  Event titles, descriptions, prices and all funds are on-chain and keep
  working; only images, video and long descriptions would be unavailable.
  A weekly backup workflow copies the Blob store, and a restore script puts
  files back at the same URLs.
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
