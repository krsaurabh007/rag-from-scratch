require('dotenv').config();
const { Pool } = require('pg');
const { retrieveChunks, generateAnswer } = require('../utils');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const question = process.argv[2] || "What does Saurabh know about authentication?";
  console.log(`Question: "${question}"\n`);
  console.log('Retrieving relevant chunks...');

  const chunks = await retrieveChunks(pool, question);
  console.log(`Found ${chunks.length} relevant chunks. Generating answer...\n`);

  const answer = await generateAnswer(question, chunks);
  console.log('--- Answer ---');
  console.log(answer);

  await pool.end();
}

main().catch(console.error);