require('dotenv').config();
const { Pool } = require('pg');
const { generateAnswer } = require('../utils');
const { routeAndRetrieve } = require('../search');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const question = process.argv[2] || "What does Saurabh know about authentication?";
  console.log(`Question: "${question}"\n`);
  console.log('Retrieving relevant chunks...');

  const { chunks, routing } = await routeAndRetrieve(pool, question);
  console.log(`Routing: ${JSON.stringify(routing)}`);
  console.log(`Found ${chunks.length} relevant chunks. Generating answer...\n`);

  const answer = await generateAnswer(question, chunks);
  console.log('--- Answer ---');
  console.log(answer);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
