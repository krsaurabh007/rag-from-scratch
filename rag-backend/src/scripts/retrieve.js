require('dotenv').config();
const { Pool } = require('pg');
const { retrieveChunks } = require('../utils');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const question = process.argv[2] || "What does Saurabh know about authentication?";
  console.log(`Question: "${question}"\n`);

  const chunks = await retrieveChunks(pool, question);
  chunks.forEach((row, i) => {
    console.log(`--- Match ${i + 1} (distance: ${row.distance.toFixed(4)}) ---`);
    console.log(row.content);
    console.log();
  });

  await pool.end();
}

main().catch(console.error);