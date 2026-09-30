const fs = require('fs');
const pdf = require('pdf-parse');

async function extractText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text;
}

function chunkText(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = start + chunkSize;
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start = end - overlap;
  }
  return chunks;
}

async function getEmbedding(text) {
  const response = await fetch('http://localhost:11434/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', input: text })
  });
  const data = await response.json();
  return data.embeddings[0];
}

async function retrieveChunks(pool, question, topK = 5) {
  const questionEmbedding = await getEmbedding(question);
  const result = await pool.query(
    `SELECT content, metadata, embedding <=> $1 AS distance
     FROM document_chunks
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [JSON.stringify(questionEmbedding), topK]
  );
  return result.rows;
}

async function generateAnswer(question, contextChunks) {
  const context = contextChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
  const prompt = `You are answering questions based only on the context below. If the answer isn't in the context, say you don't know.

Context:
${context}

Question: ${question}

Answer:`;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3.1:8b', prompt, stream: false })
  });
  const data = await response.json();
  return data.response;
}

module.exports = { extractText, chunkText, getEmbedding, retrieveChunks, generateAnswer };