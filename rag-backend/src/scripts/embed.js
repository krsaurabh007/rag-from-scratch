require('dotenv').config();
const path = require('path');
const { Pool } = require('pg');
const { extractText, chunkText, countTokens, getEmbedding } = require('../utils');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const filePath = path.join(__dirname, '../../uploads/Saurabh_Resumee.pdf');
  const text = await extractText(filePath);
  const chunks = chunkText(text);

  console.log(`Embedding and storing ${chunks.length} chunks...\n`);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i]);
    await pool.query(
      `INSERT INTO document_chunks (document_id, content, embedding, metadata)
       VALUES ($1, $2, $3, $4)`,
      [1, chunks[i], JSON.stringify(embedding), JSON.stringify({ source: 'Saurabh_Resumee.pdf', chunk_index: i, token_count: countTokens(chunks[i]) })]
    );
    console.log(`Chunk ${i + 1}/${chunks.length} stored`);
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(console.error);