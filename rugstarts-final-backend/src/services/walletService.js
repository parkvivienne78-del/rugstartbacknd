const { z } = require("zod");
const { withTransaction } = require("../db");

const createOrGetUserSchema = z.object({
  privyUserId: z.string().min(3),
  walletAddress: z.string().optional(),
});

const depositSchema = z.object({
  privyUserId: z.string().min(3),
  txSignature: z.string().min(10),
  amount: z.number().positive(),
  currency: z.string().default("SOL"),
  sourceAddress: z.string().optional(),
});

const withdrawalSchema = z.object({
  privyUserId: z.string().min(3),
  destinationAddress: z.string().min(20),
  amount: z.number().positive(),
  currency: z.string().default("SOL"),
});

async function createOrGetUser(input) {
  const data = createOrGetUserSchema.parse(input);

  return withTransaction(async (client) => {
    const upsert = await client.query(
      `
      INSERT INTO users (privy_user_id, wallet_address)
      VALUES ($1, $2)
      ON CONFLICT (privy_user_id)
      DO UPDATE SET wallet_address = COALESCE(EXCLUDED.wallet_address, users.wallet_address), updated_at = NOW()
      RETURNING id, privy_user_id AS "privyUserId", wallet_address AS "walletAddress", created_at AS "createdAt"
      `,
      [data.privyUserId, data.walletAddress || null]
    );

    const user = upsert.rows[0];

    await client.query(
      `
      INSERT INTO balances (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
      `,
      [user.id]
    );

    return user;
  });
}

async function getBalanceByPrivyUserId(privyUserId) {
  const result = await withTransaction(async (client) => {
    const row = await client.query(
      `
      SELECT
        u.id,
        u.privy_user_id AS "privyUserId",
        b.available::text AS "available",
        b.locked::text AS "locked",
        b.updated_at AS "updatedAt"
      FROM users u
      JOIN balances b ON b.user_id = u.id
      WHERE u.privy_user_id = $1
      `,
      [privyUserId]
    );
    return row.rows[0] || null;
  });

  return result;
}

async function recordConfirmedDeposit(input) {
  const data = depositSchema.parse(input);

  return withTransaction(async (client) => {
    const userRow = await client.query("SELECT id FROM users WHERE privy_user_id = $1", [data.privyUserId]);
    if (!userRow.rows[0]) {
      throw new Error("Unknown user.");
    }
    const userId = userRow.rows[0].id;

    const existing = await client.query("SELECT id FROM deposits WHERE tx_signature = $1", [data.txSignature]);
    if (existing.rows[0]) {
      return { duplicate: true };
    }

    await client.query(
      `
      INSERT INTO deposits (user_id, tx_signature, amount, currency, status, confirmations, source_address, confirmed_at)
      VALUES ($1, $2, $3, $4, 'confirmed', 1, $5, NOW())
      `,
      [userId, data.txSignature, data.amount, data.currency, data.sourceAddress || null]
    );

    await client.query(
      `
      UPDATE balances
      SET available = available + $2, updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId, data.amount]
    );

    await client.query(
      `
      INSERT INTO ledger_entries (user_id, entry_type, amount, currency, metadata)
      VALUES ($1, 'deposit', $2, $3, $4::jsonb)
      `,
      [userId, data.amount, data.currency, JSON.stringify({ txSignature: data.txSignature })]
    );

    return { duplicate: false };
  });
}

async function requestWithdrawal(input) {
  const data = withdrawalSchema.parse(input);

  return withTransaction(async (client) => {
    const userRow = await client.query("SELECT id FROM users WHERE privy_user_id = $1", [data.privyUserId]);
    if (!userRow.rows[0]) {
      throw new Error("Unknown user.");
    }
    const userId = userRow.rows[0].id;

    const balanceRow = await client.query("SELECT available FROM balances WHERE user_id = $1 FOR UPDATE", [userId]);
    const available = Number(balanceRow.rows[0]?.available || 0);

    if (available < data.amount) {
      throw new Error("Insufficient balance.");
    }

    const withdrawal = await client.query(
      `
      INSERT INTO withdrawals (user_id, destination_address, amount, currency, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING id, status, amount::text AS amount, currency, destination_address AS "destinationAddress"
      `,
      [userId, data.destinationAddress, data.amount, data.currency]
    );

    await client.query(
      `
      UPDATE balances
      SET available = available - $2, locked = locked + $2, updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId, data.amount]
    );

    await client.query(
      `
      INSERT INTO ledger_entries (user_id, entry_type, amount, currency, metadata)
      VALUES ($1, 'withdrawal', $2, $3, $4::jsonb)
      `,
      [userId, -Math.abs(data.amount), data.currency, JSON.stringify({ stage: "requested" })]
    );

    return withdrawal.rows[0];
  });
}

module.exports = {
  createOrGetUser,
  getBalanceByPrivyUserId,
  recordConfirmedDeposit,
  requestWithdrawal,
};
