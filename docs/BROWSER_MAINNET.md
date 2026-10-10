# Arc mainnet with browser wallets

Set `NEXT_PUBLIC_SHOWUP_WALLET_MODE=browser` to use injected EVM wallets for
event creation, invitations, reservations, remaining payments, cancellation,
refunds, organizer settlement and QR check-in. Circle wallet creation and
recovery are hidden in this mode. No Circle API key or App ID is required.
Existing Circle routes remain in the code for deployments using Circle mode.
The browser mode does not provide embedded wallets, PIN recovery, sponsored
gas, bridges or swaps. Keep the wallet's own recovery information securely.

## Existing deployment

The deployed ShowUpV6 contract does not change:

- Arc mainnet, chain ID `5042`.
- Contract: `0x6108613878E4FA3531f3CB478D12AC49147d7366`.
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals).
- Maximum reservation amount: 20 USDC. This is a reservation limit, not a
  deployment fee or a requirement to fund a wallet with 20 USDC.

## Production settings

Use the separate Vercel project `showup-arc-mainnet`. For deployments from
GitHub, set Root Directory to `web` and use the branch containing this patch
(`mainnet-v6` until it is merged). A CLI production deployment must run from
the local `web` directory linked to that project.

Required production variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SHOWUP_WALLET_MODE` | `browser` |
| `NEXT_PUBLIC_SHOWUP_NETWORK` | `mainnet` |
| `NEXT_PUBLIC_SHOWUP_CHAIN_ID` | `5042` |
| `NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS` | Contract address above |
| `SHOWUP_WALLET_AUTH_SECRET` | Existing server secret |
| `SHOWUP_RECOVERY_SECRET` | Existing separate server secret |
| `BLOB_READ_WRITE_TOKEN` | Token from the connected mainnet Blob store |

Do not set `SHOWUP_SKIP_CONTRACT_CHECK` or the legacy migration variable in
production. `web/vercel.json` runs `npm run build`, including the live contract
check, instead of directly invoking `next build`.

Connect a separate Vercel Blob store before creating events. The existing
wallet-signature upload authorization and quota protections remain in place.
The upload lease/CDN behavior still requires validation against real Blob.

## Live acceptance checks

Use two browser-wallet accounts and small amounts. All amounts are real USDC;
each account needs some USDC for its own gas. Reuse the event scheduling
requirements and detailed upload checks in `DEPLOYMENT.md`.

1. Confirm that only browser wallet choices appear and the wallet switches to
   Arc mainnet. Verify the contract check during the Vercel build.
2. Create a public event with a 0.5 USDC deposit. Reserve from the second
   account. Check the approval and reservation receipts, escrow and balance.
3. Cancel a reservation before its deadline and verify the refund on-chain.
4. Create a paid event with a 1 USDC ticket. Test both full payment and a
   deposit followed by remaining payment, using separate events/accounts.
5. During an event, sign a check-in QR with the organizer account and open it
   from the attendee account. Verify attendance and the refund/payout receipt.
6. Test organizer cancellation followed by an attendee refund. For settlement
   tests, wait for the actual no-show/default/fallback deadlines.
7. Create a private event, sign an invitation for the attendee, reserve through
   the complete invitation URL, and test revoking a separate unused invitation.
8. Switch accounts after a payment approval and verify that the subsequent
   event transaction is blocked for the wrong account. Reject a wallet prompt,
   reload after submitting a transaction, and check transaction recovery.
9. Run the live Blob callback/lease checklist and cleanup dry-run. Keep actual
   cleanup deletion disabled until the dry-run has been reviewed.

The browser organizer panel performs settlement per attendee, with pagination;
it does not expose the Circle panel's batch and CSV export controls.
Builds and mocked transaction tests do not replace these live checks.
