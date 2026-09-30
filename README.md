# RAG From Scratch

A Retrieval-Augmented Generation (RAG) system built from scratch to understand the full pipeline end-to-end — no LangChain/LlamaIndex abstractions. Upload a PDF, ask questions grounded in its content, powered by locally-run open-source models via [Ollama](https://ollama.com).

## Structure

- [`/backend`](./backend) — Express API: PDF ingestion, chunking, embedding, pgvector storage/retrieval, LLM generation
- [`/frontend`](./frontend) — React + TypeScript chat interface

## Architecture
PDF Upload → Text Extraction → Chunking → Embedding (nomic-embed-text)
↓
PostgreSQL + pgvector storage
↓
Question → Embedding → Cosine Similarity Search → Top-K Chunks
↓
Chunks + Question → Llama 3.1 8B → Answer


## Tech stack

**Backend:** Node.js, Express, PostgreSQL + pgvector, Ollama (llama3.1:8b, nomic-embed-text), pdf-parse
**Frontend:** React, TypeScript, Vite, Zustand, TanStack React Query

## Features

- PDF upload with automatic chunking and embedding
- Semantic search via vector similarity (cosine distance)
- Context-grounded answer generation with hallucination guardrails
- Toggle between RAG mode (document-grounded) and normal chat (direct LLM)
- Document management — list and delete (cascades to chunks)

## Setup

See [`/backend/README.md`](./backend/README.md) and [`/frontend/README.md`](./frontend/README.md) for setup instructions for each half.

## Design decisions and learnings

- Chose pgvector over a dedicated vector DB (Pinecone/Weaviate/Qdrant) to keep vector and relational data in one database — simpler at this project's scale, avoids syncing two systems
- Initial character-based chunking caused mid-word cuts and duplicate-context retrieval — motivated a planned v2 improvement to boundary-aware chunking
- Explicit prompt grounding prevents hallucination, with the trade-off that ambiguous phrasing can cause the model to under-use information that is technically present in context
- Added a mode toggle after observing that strict context-grounding causes the system to refuse general questions unrelated to uploaded documents — by design, but not always the desired UX

## Roadmap (v2)

- Paragraph/sentence-boundary-aware chunking
- Hybrid search (vector + PostgreSQL full-text search)
- Metadata-based document routing to scope retrieval and reduce latency
