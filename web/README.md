# ShowUp web app

Next.js 16 app and API routes for ShowUp. See the
[root README](../README.md) for what ShowUp does and
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) to deploy it.

## Develop

```bash
npm ci
cp .env.example .env.local   # set NEXT_PUBLIC_SHOWUP_NETWORK and the rest
npm run dev                  # http://localhost:3000
```

The app will not start without `NEXT_PUBLIC_SHOWUP_NETWORK` (`testnet` or
`mainnet`) and the matching `NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS`.

## Where things live

| Path | Purpose |
|---|---|
| `src/lib/showup-network.ts` | Every network-specific value (chain, RPCs, explorer, tokens, Circle chain codes, feature flags) |
| `src/lib/showup-abi.ts` | Generated ShowUpV6 ABI (`npm run sync-abi` in the root) |
| `src/lib/showup-checkin.ts` | Check-in code format and EIP-712 typed data |
| `src/app/api/circle/...` | Routes that prepare Circle PIN challenges |
| `src/app/api/check-in/verify` | Validates a check-in code before any transaction |
| `src/app/events/[id]/check-in` | Attendee check-in page opened from the QR code |
| `src/lib/upload-guard.ts` | Upload quotas and file-type checks |
| `src/lib/mainnet-bridge/` | CCTP V2 bridge: routes and fees, attestation validation, persisted transfers, recovery engine, viem runtime |
| `src/app/api/bridge/cctp/...` | Server proxy for Circle's Iris attestation, fee and re-attest APIs |
| `src/lib/mainnet-swap/` | Arc USDC/EURC swap: wallet-request guard (decodes adapter call data, permits), Arc fees, on-chain outcome check, App Kit runtime |
| `src/app/api/swap/circle/...` | Optional, session-authenticated and rate-limited proxy that adds `CIRCLE_SWAP_API_KEY` |
| `src/app/wallet-tools/{add-funds,bridge,swap}` | Mainnet Wallet tools, one route per section |
| `src/lib/site-nav.ts`, `src/components/showup-header.tsx`, `src/components/site-footer.tsx` | Header (desktop + mobile menu), active state, footer links |
| `scripts/blob-backup.mjs`, `scripts/blob-restore.mjs` | Blob store backup and restore |

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test        # upload quotas, browser actions, bridge engine, swap guard/proxy, navigation
npm run build
```

CI runs all four for both networks.
