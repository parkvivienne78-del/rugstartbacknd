const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
let pool = null;

function getPool() {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Add it in Railway Variables.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  withTransaction,
};
