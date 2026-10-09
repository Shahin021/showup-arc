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
| `scripts/blob-backup.mjs`, `scripts/blob-restore.mjs` | Blob store backup and restore |

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

CI runs all three for both networks.
