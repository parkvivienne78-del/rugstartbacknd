# Rugs Backend (Railway Ready)

Backend scaffold for:
- user sync (Privy user id)
- balances
- confirmed deposits
- withdrawal requests
- ledger entries

## 1) Install

```bash
npm install
```

## 2) Configure env

```bash
cp .env.example .env
```

Set `DATABASE_URL` and `CORS_ORIGIN`.

## 3) Run migrations

```bash
npm run db:migrate
```

## 4) Start API

```bash
npm run dev
```

## 5) Endpoints

- `GET /api/health`
- `POST /api/users/sync`
- `GET /api/wallet/balance/:privyUserId`
- `POST /api/wallet/deposits/confirm`
- `POST /api/wallet/withdrawals/request`

## Deploy on Railway

1. Push `backend` folder to GitHub repo.
2. Create Railway service from repo.
3. Add PostgreSQL plugin.
4. Set env vars:
   - `NODE_ENV=production`
   - `DATABASE_URL=...`
   - `CORS_ORIGIN=https://your-cloudflare-domain`
5. Run migration once:
   - `npm run db:migrate`
6. Start command:
   - `npm run start`
