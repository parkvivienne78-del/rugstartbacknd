require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getPool } = require("../src/db");

async function run() {
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const pool = getPool();
  await pool.query(sql);
  console.log("Migration complete.");
  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
