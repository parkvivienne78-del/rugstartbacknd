# Rugstarts Final Backend

This is the matching backend for the final frontend.

Includes:

- Candleflip-style live game engine
- Socket.IO live chart/game updates
- Privy user sync route
- Wallet balance routes
- Solana mainnet deposit verification
- Manual withdrawal request route
- Leaderboard / profile / MFA compatibility routes

## Railway Variables

Set these in Railway:

```env
NODE_ENV=production
DATABASE_URL=${{ Postgres.DATABASE_URL }}
CORS_ORIGIN=https://rugstarts.com,https://www.rugstarts.com

SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_TREASURY_WALLET=UsAKYwFikVycjNb46UVJRT2oMxEson3fUNLiXXG8eJb
MIN_DEPOSIT_SOL=0.001
WITHDRAWALS_MODE=manual
```

## Deploy

Upload these files to the backend repo root and redeploy Railway.

## Run once after deploy

```bash
npm run db:migrate
```

## Test

Open:

```text
https://rugstartbacknd-production.up.railway.app/api/health
```

Then:

```text
https://rugstartbacknd-production.up.railway.app/api/solana/deposit-address
```
