// Dry run: extract + chunk a PDF and print the result. No Ollama, no database.
const path = require('path');
const { extractText, buildChunks, countTokens } = require('../utils');

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '../../uploads/Saurabh_Resumee.pdf');
  const text = await extractText(filePath);
  const chunks = buildChunks(text); // same chunks as chunkText, plus which header lines were added

  const tokenCounts = chunks.map((c) => countTokens(c.text));
  chunks.forEach((chunk, i) => {
    const note = chunk.header.length ? ` | context header: ${chunk.header.length} line(s)` : '';
    console.log(`===== Chunk ${i} | ${tokenCounts[i]} tokens | ${chunk.text.length} chars${note} =====`);
    console.log(chunk.text);
    console.log();
  });

  const total = tokenCounts.reduce((a, b) => a + b, 0);
  console.log('--- Totals ---');
  console.log(`Chunks: ${chunks.length} (${chunks.filter((c) => c.header.length).length} with a context header)`);
  console.log(`Tokens: min ${Math.min(...tokenCounts)} / avg ${(total / chunks.length).toFixed(1)} / max ${Math.max(...tokenCounts)}`);
}

main().catch(console.error);
