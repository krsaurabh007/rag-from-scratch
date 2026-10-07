# RAG From Scratch

**A document Q&A system built end to end without LangChain or LlamaIndex.** Upload a PDF, ask questions in a chat, and get answers grounded in your documents. Embeddings, vector search and generation all run locally with Ollama and PostgreSQL.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Llama%203.1-000000)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

I built every step by hand (text extraction, chunking, embedding, hybrid search, routing and prompting) to understand how RAG works and why it fails. Each design choice below comes from a real problem I found while testing.

<!--
Add a screenshot or short GIF of the chat UI here, for example:
![Chat UI](docs/screenshot-chat.png)
-->

## Key features

- **Token-aware chunking.** Chunks are capped at 256 tokens and never cut mid-word or mid-sentence. The overlap is made of whole lines, and section headings are carried into every chunk so it still knows what it belongs to.
- **Hybrid retrieval.** pgvector cosine search and PostgreSQL full-text search run in a single SQL query. The two ranked lists are merged with Reciprocal Rank Fusion (RRF), so there are no score weights to tune.
- **Keyword-based document routing.** Each document gets keywords at upload. A question is matched against them so only the relevant documents are searched, and it falls back to searching everything when nothing matches.
- **Grounded answers.** The model answers only from the retrieved context and says "I don't know" otherwise, which reduces hallucination.
- **Normal and RAG modes.** A toggle switches between document-grounded answers and plain LLM chat.
- **Document management.** A collapsible sidebar lists documents and deletes them. Foreign keys with `ON DELETE CASCADE` remove all of a document's chunks automatically.
- **Debuggable by design.** Every `/chat` response includes the source chunks, which documents were routed to, and timings for each stage.
- **Fully local and reproducible.** Ollama runs the models, Docker runs Postgres, and one command (`npm run db:setup`) creates the schema.

## How it works

### 1. Ingestion (once per document)

```mermaid
flowchart LR
    A["PDF upload"] --> B["Extract text<br/>pdf-parse"]
    B --> C["Chunk<br/>256 tokens, overlap, headings"]
    C --> D["Embed each chunk<br/>nomic-embed-text, 768 dims"]
    D --> E[("PostgreSQL + pgvector")]
    B --> F["Document keywords<br/>filename + small LLM"]
    F --> E
```

### 2. Question answering (every question)

```mermaid
flowchart TD
    Q["Question"] --> R["Route by document keywords<br/>fallback: all documents"]
    R --> E["Embed question"]
    R --> K["Keyword search<br/>full-text, GIN index, top 20"]
    E --> V["Vector search<br/>cosine, HNSW index, top 20"]
    V --> M["Merge with RRF<br/>keep best 6 chunks"]
    K --> M
    M --> P["Grounded prompt<br/>rules + numbered chunks + question"]
    P --> L["Llama 3.1 8B via Ollama"]
    L --> A["Answer + sources + routing + timings"]
```

## Design decisions

| Decision | Why |
|---|---|
| Postgres + pgvector instead of a dedicated vector DB | Vectors live next to relational data, so I can filter and join in one SQL query and avoid syncing two systems. At very large scale a dedicated vector DB could make sense. |
| Token-based, boundary-aware chunking | My first version sliced every 500 characters. It cut words in half and left bullet points without the heading that explained them. |
| Section headings copied into chunks | A chunk of bullets that never names its company or project is hard to find with any search. |
| Hybrid search instead of vector only | Vector search finds meaning but can miss exact names and numbers. Keyword search finds exact terms but misses different wording. |
| RRF instead of adding scores | Vector distance and keyword rank are on different scales. RRF uses only rank positions. |
| OR-style keyword query | `plainto_tsquery` requires every word to match, so a natural question would match nothing. |
| Keyword routing instead of summary embeddings | It is simpler, needs no extra model call and is easy to debug. Summary embeddings scale better and are on the roadmap. |
| HNSW, GIN and B-tree indexes | One index per access pattern: nearest vectors, keyword search and document filtering. |
| Parameterized queries | User input is never pasted into SQL, which prevents SQL injection. |
| Config through environment variables | The same code runs locally and, later, on hosted services. |

## What testing taught me

| Observation in v1 | Cause | Fix in v2 |
|---|---|---|
| Chunks began mid-word, for example "nd architecture" | Fixed 500-character slicing | Token-based, boundary-aware chunking |
| A chunk of bullets did not contain the company name | Heading was in the previous chunk | Context headers on every chunk |
| "List all companies" returned only one company | The other company's chunk was not retrieved | Better chunks, hybrid search and a larger result set |
| "Total experience" said "I don't know" although the answer was in the text | Retrieval was fine, the prompt and wording were not | Learned that retrieval and generation fail separately, then tightened the prompt |
| Setup only worked on my machine | Schema lived inside my Docker database | `db/schema.sql` and `npm run db:setup` |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Zustand, TanStack React Query |
| Backend | Node.js, Express, multer, pdf-parse, gpt-tokenizer |
| Database | PostgreSQL with pgvector (HNSW, GIN and B-tree indexes) |
| Models (via Ollama) | `llama3.1:8b` for answers, `nomic-embed-text` for embeddings, `qwen2.5:3b` for document keywords |
| Infrastructure | Docker for Postgres, `.env` for configuration |

## Project structure

```
rag-from-scratch/
├── rag-backend/
│   ├── db/schema.sql           # tables, foreign keys, indexes
│   └── src/
│       ├── index.js            # Express routes
│       ├── ingest.js           # upload pipeline and keyword generation
│       ├── search.js           # routing and hybrid search (RRF)
│       ├── utils.js            # extraction, chunking, embeddings, generation
│       └── scripts/            # CLI tools: setup-db, embed, retrieve, generate, preview-chunks
└── rag-frontend/
    └── src/
        ├── App.tsx             # chat screen
        ├── components/         # sidebar
        ├── services/           # API client
        └── store/              # Zustand chat state
```

## Getting started

**Prerequisites:** Node.js 18+, Docker, and [Ollama](https://ollama.com). The 8B model needs roughly 6 GB of free RAM. It runs on a CPU, but answers are slower than on a GPU.

**1. Pull the models**

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
ollama pull qwen2.5:3b
```

**2. Start PostgreSQL with pgvector**

```bash
docker run --name rag-postgres -e POSTGRES_PASSWORD=yourpassword -p 5432:5432 -d pgvector/pgvector:pg16
```

**3. Start the backend**

```bash
cd rag-backend
npm install
cp .env.example .env      # then set your database password
npm run db:setup          # creates tables and indexes (safe to run again)
npm start                 # http://localhost:3000
```

`.env` values:

```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/postgres
OLLAMA_URL=http://localhost:11434
PORT=3000
```

**4. Start the frontend**

```bash
cd rag-frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`), upload a PDF, switch to **RAG** mode and ask a question. The frontend expects the backend at `http://localhost:3000`.

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/documents` | List documents with keywords and chunk counts |
| `POST` | `/documents/upload` | Ingest a PDF (multipart field `file`) |
| `DELETE` | `/documents/:id` | Delete a document and, by cascade, its chunks |
| `POST` | `/chat` | Body: `{ "question": "...", "mode": "rag" }` or `"mode": "normal"` |

Example `/chat` response in RAG mode (shape only):

```json
{
  "answer": "...",
  "sources": [{ "content": "...", "document_id": 1, "score": 0.032 }],
  "routing": { "matchedDocumentIds": [1], "fellBack": false },
  "timings": { "routeMs": 4, "embedMs": 38, "searchMs": 12, "generateMs": 9000 }
}
```

## Debugging tools

Each stage of the pipeline can be run on its own from `rag-backend`:

```bash
npm run preview -- path/to/file.pdf    # show the chunks (no Ollama or database needed)
npm run embed -- path/to/file.pdf      # ingest a PDF from the command line
npm run retrieve -- "your question"    # routing, scores and ranks per chunk
npm run generate -- "your question"    # full retrieval + answer
```

## Roadmap

- [x] Token-based, boundary-aware chunking with context headers
- [x] Hybrid search (vector + full-text) merged with RRF
- [x] Keyword-based document routing with fallback
- [x] Documents table, cascade delete and reproducible schema
- [ ] Chat memory (send conversation history, persist chats)
- [ ] Stronger routing with summary embeddings
- [ ] Re-ranking model after retrieval
- [ ] Streaming responses
- [ ] OCR for scanned PDFs
- [ ] Evaluation set to measure retrieval and answer quality
- [ ] Deployment (Vercel, Render, Supabase, Ollama through a tunnel)

## Author

**Saurabh Kumar**, Full Stack Developer
[GitHub](https://github.com/krsaurabh007) · [LinkedIn](https://linkedin.com/in/saurabh-kumar-99009b24a)
