require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');
const { generateAnswer, OLLAMA_URL } = require('./utils');
const { ingestDocument } = require('./ingest');
const { routeAndRetrieve } = require('./search');

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
      `SELECT d.id AS document_id, d.filename AS source, d.keywords, COUNT(c.id)::int AS chunk_count
       FROM documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id
       GROUP BY d.id
       ORDER BY d.id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

app.post('/documents/upload', upload.single('file'), async (req, res) => {
  const filePath = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const { documentId, chunksStored, keywords } = await ingestDocument(pool, filePath, req.file.originalname);
    res.json({ message: 'Document processed', documentId, chunksStored, keywords });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  } finally {
    if (filePath) fs.unlink(filePath, () => {}); // always remove the temp upload
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { question, mode = 'rag' } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    if (mode === 'normal') {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.1:8b', prompt: question, stream: false })
      });
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);
      const data = await response.json();
      return res.json({ answer: data.response, sources: [] });
    }

    const { chunks, routing, timings } = await routeAndRetrieve(pool, question, { topK: 6 });
    const t0 = Date.now();
    const answer = await generateAnswer(question, chunks);
    timings.generateMs = Date.now() - t0;

    res.json({
      answer,
      sources: chunks.map((r) => ({ content: r.content, document_id: r.document_id, score: r.score })),
      routing,
      timings
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

app.delete('/documents/:id', async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'id must be an integer' });
    const id = Number(req.params.id);
    // The FK is ON DELETE CASCADE, so deleting the document removes its chunks too.
    const result = await pool.query('DELETE FROM documents WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ message: 'Document deleted', id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
