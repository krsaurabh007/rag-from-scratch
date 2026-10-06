require('dotenv').config();
const path = require('path');
const { Pool } = require('pg');
const { ingestDocument } = require('../ingest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '../../uploads/Saurabh_Resumee.pdf');
  console.log(`Ingesting ${filePath} ...`);

  const { documentId, chunksStored, keywords } = await ingestDocument(pool, filePath, path.basename(filePath));

  console.log(`Stored ${chunksStored} chunks as document ${documentId}.`);
  console.log(`Keywords: ${keywords.join(', ')}`);
}

main()
  .catch((err) => {
    console.error('Ingestion failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
