# Arc mainnet with browser wallets

Set `NEXT_PUBLIC_SHOWUP_WALLET_MODE=browser` to use injected EVM wallets for
event creation, invitations, reservations, remaining payments, cancellation,
refunds, organizer settlement and QR check-in. Circle wallet creation and
recovery are hidden in this mode. No Circle API key or App ID is required.
Existing Circle routes remain in the code for deployments using Circle mode.
The browser mode does not provide embedded wallets, PIN recovery or sponsored
gas. Keep the wallet's own recovery information securely. Wallet tools offer a
CCTP bridge and a USDC/EURC swap with browser wallets (see
[Bridge and swap](#bridge-and-swap)).

## Existing deployment

The deployed ShowUpV6 contract does not change:

- Arc mainnet, chain ID `5042`.
- Contract: `0x6108613878E4FA3531f3CB478D12AC49147d7366`.
- USDC ERC-20: `0x3600000000000000000000000000000000000000` (6 decimals).
- Maximum reservation amount: 20 USDC. This is a reservation limit, not a
  deployment fee or a requirement to fund a wallet with 20 USDC.

## Production settings

Use the separate Vercel project `showup-arc-mainnet`. For deployments from
GitHub, set Root Directory to `web`, Production Branch Tracking to `mainnet-v6`,
Install Command to `npm ci`, and Build Command to `npm run build`. Create a
fresh Git deployment after changing Root Directory. With this project setting,
a CLI deployment must upload the repository root, not the local `web` directory.

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

Both header and in-page Connect wallet buttons discover installed wallets.
Already-authorized accounts are read with `eth_accounts`; another permission
request is made only when no authorized account is available. The account and
Arc network are still checked before signing, and repeated clicks cannot start
two concurrent browser-wallet logins.

MetaMask's malicious-domain classification requires an external security
review. Removing duplicate permission requests does not remove that flag.
The production-domain review ticket was submitted on 14 October 2026; no
clearance has been received. Real-wallet acceptance checks remain pending.

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

## Bridge and swap

Wallet tools on mainnet add two features for browser wallets. Neither changes
the ShowUpV6 contract or the event flows, and neither needs Circle Wallets
credentials.

### What is supported, and why

| Feature | Supported on Arc mainnet | Source |
| --- | --- | --- |
| CCTP V2 bridge Arc ↔ Ethereum, Arc ↔ Base | Yes. Arc is CCTP domain `26`; Arc mainnet was added to CCTP on 2026-09-16. | [CCTP contract addresses](https://developers.circle.com/cctp/references/contract-addresses), [release notes](https://developers.circle.com/release-notes/cctp-2026), [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses) |
| Fast Transfer from Ethereum / Base | Yes (fee 1 bps / 1.3 bps at the time of writing; fetched live) | [Supported chains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains), [fees](https://developers.circle.com/cctp/concepts/fees) |
| Fast Transfer **from Arc** | **No** — Circle lists it as N/A for Arc; Arc's standard attestation is already fast. Only standard transfers are offered from Arc. | [Supported chains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains) |
| Circle Forwarding Service (Circle submits the destination mint) | Yes, for all three chains | [Supported chains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains), [forwarding how-to](https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service) |
| Swap USDC ⇄ EURC on Arc | Yes, through Circle App Kit Swap (Stablecoin Service). Arc swaps support USDC, EURC and cirBTC; this app offers USDC/EURC. | [App Kit supported blockchains](https://docs.arc.io/app-kit/references/supported-blockchains), [App Kit Swap](https://docs.arc.io/app-kit/swap) |

Ethereum ↔ Base transfers are not offered (only routes touching Arc). cirBTC
swaps are not offered. The testnet bridge and swap are unchanged and are not
used on mainnet.

Contract addresses used (identical on Ethereum, Base and Arc mainnet):

- TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` (the only
  spender the bridge approves, for the exact amount)
- MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`
- TokenMinterV2 `0xfd78EE919681417d192449715b2594ab58f5D002`
- USDC: Ethereum `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, Base
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Arc
  `0x3600000000000000000000000000000000000000`
- Swap spender: Circle App Kit adapter `0x7FB8c7260b63934d8da38aF902f87ae6e284a845`
  (from `@circle-fin/provider-stablecoin-service-swap`), permit or approval for
  the exact swap amount only.

### How the bridge works

1. **Review.** The app reads balances, allowance and gas prices on both
   networks and fetches the live CCTP fee (and forwarding fee) from Circle.
   It shows networks, token, amount, CCTP fee, forwarding fee, the maximum
   fee enforced on-chain, the expected and guaranteed minimum amount, gas
   on each network and the exact approval. Problems (missing USDC, missing
   gas on either side) block the transfer. A quote is valid for 60 seconds.
2. **Approve + burn.** The wallet switches to the source network, approves
   exactly the amount to TokenMessengerV2 (only if needed), then signs
   `depositForBurn` (or `depositForBurnWithHook` for Circle delivery). The
   transfer record is saved in the browser **before** the burn is signed and
   the burn hash is saved as soon as the wallet returns it.
3. **Attestation.** The app polls Circle's Iris API through
   `/api/bridge/cctp/messages` and validates the returned CCTP message
   against the transfer (domains, token, recipient, amount, sender, max fee)
   before using it.
4. **Receive.** With Circle delivery, Circle's forwarder submits the mint and
   the app verifies its receipt. Otherwise (or if forwarding stalls for a few
   minutes) the user signs `receiveMessage` on the destination. Success is
   shown only after the destination receipt contains the matching
   `MessageReceived` event, or `usedNonces(nonce)` confirms the message was
   received.

Recovery rules:

- A refresh at any stage resumes from the stored record. Only the start
  button can burn; every other step works from the stored burn.
- A failed, rejected or dropped receive can be retried; the on-chain nonce
  makes a double mint impossible, and an already-received message is
  detected without sending a transaction.
- If the page closed while the burn was being signed, new transfers are
  blocked until the entry is recovered with its burn hash (Recover a
  transfer) or discarded.
- An expired Fast Transfer attestation is re-attested by Circle
  (`/api/bridge/cctp/reattest`); the burn is not repeated.
- Records live in the browser's local storage. In another browser, use
  Recover a transfer with the burn transaction hash.

### How the swap works

The swap runs Circle App Kit in the browser with the user's wallet. The app:

- validates Circle's quote (pair, amount, and that the minimum output
  respects the chosen slippage of 0.1%, 0.5% or 1%), shows estimated output,
  minimum received, fees and the authorization, and expires the quote after
  30 seconds;
- passes the displayed minimum as the on-chain stop limit;
- wraps the wallet so only these requests reach it while a confirmed quote is
  being executed (everything else, including `eth_signTypedData_v3`,
  `personal_sign`, `wallet_sendCalls` and any unknown method, is refused):
  - `approve()` of the input token to Circle's adapter for exactly the amount;
  - an EIP-2612 permit with the standard structure, on Arc (5042), for the
    input token, owner = the user, spender = Circle's adapter, value =
    exactly the amount, deadline in the future and at most 2 hours away;
  - `execute()` on Circle's adapter, decoded with the adapter ABI: first
    instruction spends the input token, last instruction returns the output
    token with `minTokenOut` ≥ the confirmed minimum, no native value, total
    input ≤ the confirmed amount, every recipient = the user, exactly one
    token input for exactly the amount (with an embedded permit checked the
    same way), and an execution deadline at most 2 hours away;
- applies Arc's EIP-1559 fees to every transaction, like the event payment
  path (legacy `gasPrice` removed, `maxFeePerGas` at least the Arc estimate
  with the 20 gwei floor) and fixes `chainId` to Arc mainnet (`0x13b2`);
- for every signature or transaction, in this order: validates the request
  against the confirmed quote; fetches Arc fees (transactions); checks that
  the same quote is still active and the final request still allowed;
  reads the wallet's network and account (must be Arc mainnet and the same
  account); then checks the same quote and final request once more and
  calls the wallet immediately, with nothing awaited in between. A quote
  that is cancelled or replaced, or an account/network change, while fees
  or the wallet state are being read stops the swap before the wallet sees
  the request;
- listens to the wallet's `accountsChanged` and `chainChanged` events (like
  the bridge): switching account, or leaving Arc, clears the quote and
  invalidates any confirmation in progress; listeners are removed when the
  page is left;
- reports success only from on-chain evidence: a successful Arc receipt that
  contains a `Transfer` of the output token, emitted by that token contract,
  to the same user, for at least the minimum. The SDK's own status is not
  used. Otherwise the swap stays "Not confirmed yet" and can be re-checked
  with **Check again** or after a refresh.

### Pages

Each tool has its own route, linked from the header (and from the mobile
menu); direct links, refresh and Back/Forward keep the section:

| Route | Content |
| --- | --- |
| `/wallet-tools/add-funds` | Arc mainnet receiving address with copy and QR, network and token, balances, link to the bridge. Without a wallet: a short guide and a Connect wallet button. No card on-ramp is offered. |
| `/wallet-tools/bridge` | CCTP bridge and the user's transfers |
| `/wallet-tools/swap` | USDC ⇄ EURC swap and recent swaps |

`/wallet-tools` redirects to Add funds on mainnet; testnet keeps its combined
tools page. The infrastructure overview moved from the header to the footer
("About & infrastructure").

On mainnet, Add Funds is a regular navigation link immediately after Swap,
with the same active-page styling in desktop and mobile menus. The wallet
button stays separate. Testnet keeps its Get test USDC faucet action.

### Configuration

Nothing is required: the bridge and swap are on by default on mainnet and
use public endpoints. Optional settings (see `web/.env.example`):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SHOWUP_DISABLE_BRIDGE=true` / `NEXT_PUBLIC_SHOWUP_DISABLE_SWAP=true` | Kill switches |
| `NEXT_PUBLIC_SHOWUP_ETHEREUM_RPC_URLS`, `NEXT_PUBLIC_SHOWUP_BASE_RPC_URLS` | Dedicated Ethereum / Base RPC endpoints (comma-separated). Recommended: public RPCs are rate limited. These are visible in the browser; restrict any key to your domain. |
| `CIRCLE_SWAP_API_KEY` + `NEXT_PUBLIC_SHOWUP_SWAP_PROXY=true` | Optional Circle API key for App Kit Swap, kept server-side. Without it, the browser calls Circle directly in its shared permissionless mode and the proxy is off. With it, `/api/swap/circle` uses the key only for a valid ShowUp wallet session (the HttpOnly cookie issued after the wallet signs the ShowUp login message, checked against this host), only when every `fromAddress`/`toAddress` in the request is that wallet, and within limits of 30 requests/minute per wallet and 60 per IP (per server instance). Origin and `sec-fetch-site` are checked too, as hints only. Create a **mainnet** key in the Circle Console (format `<ENV>_API_KEY:<id>:<secret>`), set both variables, then redeploy. It relies on the existing `SHOWUP_WALLET_AUTH_SECRET`. |

Notes:

- All Iris requests from every user leave from the deployment's servers.
  Iris allows 40 requests/second and blocks for five minutes when exceeded;
  the proxy caches responses briefly and pauses upstream calls after a 429.
- Next.js inlines `NEXT_PUBLIC_*` values at build time; redeploy after
  changing them.

### Live acceptance checks (bridge and swap)

Use small amounts. Each step moves real funds; run them only when you choose
to. The full list, including the event flows, is in
[FINAL_TEST_CHECKLIST.md](FINAL_TEST_CHECKLIST.md).

1. Header: Bridge, Swap and Add Funds open their own pages; refresh and
   Back/Forward keep the page; the active item is highlighted; the mobile
   menu lists every item.
2. **Base → Arc, standard, Circle delivers** (e.g. 1 USDC): check the review
   numbers, approve + burn on Base, wait for attestation (~15–20 min), and
   confirm the forwarded mint link on the Arc explorer and the Arc balance.
3. **Arc → Base, standard, I receive it myself** with ETH on Base.
4. **Ethereum → Arc, Fast**: the amount received equals amount − fee executed.
5. **Refresh during attestation**: the transfer resumes without a second burn prompt.
6. **Receive retry**: reject the receive prompt once, then retry successfully.
7. **Recovery** by burn hash in another browser: shown as completed without sending anything.
8. **Account / network change** after review: the burn is refused.
9. **Swap USDC → EURC** (permit) and **EURC → USDC** (approval) with 1 unit:
   check the wallet prompt shows Circle's adapter and the exact amount, the
   transaction uses EIP-1559 fees, and success appears only after the
   receipt; switch account between quote and confirm and see it refused;
   let a quote expire; reload right after confirming and check the swap is
   re-verified.
10. Optional: set `CIRCLE_SWAP_API_KEY` and `NEXT_PUBLIC_SHOWUP_SWAP_PROXY`,
    redeploy, repeat one swap, and check that `/api/swap/circle/quote`
    opened directly in a new private window returns 401.
