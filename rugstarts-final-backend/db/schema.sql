CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deposit_status') THEN
    CREATE TYPE deposit_status AS ENUM ('pending', 'confirmed', 'failed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN
    CREATE TYPE withdrawal_status AS ENUM ('pending', 'approved', 'sent', 'failed', 'cancelled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id TEXT UNIQUE NOT NULL,
  wallet_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit', 'withdrawal', 'bet', 'payout', 'adjustment')),
  amount NUMERIC(18, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SOL',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_id_created_at
  ON ledger_entries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  available NUMERIC(18, 6) NOT NULL DEFAULT 0,
  locked NUMERIC(18, 6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tx_signature TEXT UNIQUE NOT NULL,
  amount NUMERIC(18, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SOL',
  status deposit_status NOT NULL DEFAULT 'pending',
  confirmations INTEGER NOT NULL DEFAULT 0,
  source_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deposits_user_id_created_at
  ON deposits(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  destination_address TEXT NOT NULL,
  amount NUMERIC(18, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SOL',
  status withdrawal_status NOT NULL DEFAULT 'pending',
  tx_signature TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id_created_at
  ON withdrawals(user_id, created_at DESC);
