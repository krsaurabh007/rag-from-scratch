// One-command database setup, so a fresh clone or a hosted Postgres (e.g. Supabase)
// can be prepared with `npm run db:setup` instead of pasting SQL by hand.
// db/schema.sql is idempotent (IF NOT EXISTS everywhere), so running this repeatedly is safe
// and never touches existing data.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
  await pool.query(sql); // no parameters, so pg runs all statements in one go
  console.log('Database setup complete: extension, tables and indexes are in place.');
}

main()
  .catch((err) => {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
