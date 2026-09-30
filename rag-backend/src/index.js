require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');
const { extractText, chunkText, getEmbedding, retrieveChunks, generateAnswer } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const upload = multer({ dest: 'uploads/' });

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/documents', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT document_id, metadata->>'source' AS source, COUNT(*) AS chunk_count
       FROM document_chunks
       GROUP BY document_id, metadata->>'source'
       ORDER BY document_id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

app.post('/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const text = await extractText(filePath);
    const chunks = chunkText(text);

    const docIdResult = await pool.query(
      `SELECT COALESCE(MAX(document_id), 0) + 1 AS next_id FROM document_chunks`
    );
    const documentId = docIdResult.rows[0].next_id;

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await getEmbedding(chunks[i]);
      await pool.query(
        `INSERT INTO document_chunks (document_id, content, embedding, metadata)
         VALUES ($1, $2, $3, $4)`,
        [documentId, chunks[i], JSON.stringify(embedding), JSON.stringify({ source: req.file.originalname, chunk_index: i })]
      );
    }

    fs.unlinkSync(filePath); // clean up the uploaded file now that it's processed

    res.json({ message: 'Document processed', documentId, chunksStored: chunks.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { question, mode = 'rag' } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    if (mode === 'normal') {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.1:8b', prompt: question, stream: false })
      });
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);
      const data = await response.json();
      return res.json({ answer: data.response, sources: [] });
    }

    const chunks = await retrieveChunks(pool, question, 5);
    const answer = await generateAnswer(question, chunks);

    res.json({
      answer,
      sources: chunks.map(r => ({ content: r.content, distance: r.distance }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

app.delete('/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM document_chunks WHERE document_id = $1`,
      [id]
    );
    res.json({ message: 'Document deleted', rowsDeleted: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));