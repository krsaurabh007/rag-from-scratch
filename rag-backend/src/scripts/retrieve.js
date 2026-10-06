// Debugging tool for tuning retrieval: shows routing and per-chunk ranks. Does not call the LLM.
require('dotenv').config();
const { Pool } = require('pg');
const { routeAndRetrieve } = require('../search');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const question = process.argv[2] || "What does Saurabh know about authentication?";
  console.log(`Question: "${question}"\n`);

  const { chunks, routing, timings } = await routeAndRetrieve(pool, question);
  console.log('Routing:', JSON.stringify(routing));
  console.log('Timings:', JSON.stringify(timings), '\n');

  chunks.forEach((row, i) => {
    console.log(
      `--- Match ${i + 1} | document_id: ${row.document_id} | score: ${row.score.toFixed(5)} | ` +
        `vector_rank: ${row.vector_rank ?? '-'} | keyword_rank: ${row.keyword_rank ?? '-'} ---`
    );
    console.log(row.content);
    console.log();
  });
}

main()
  .catch(console.error)
  .finally(() => pool.end());
