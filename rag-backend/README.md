# rag-backend

## Database setup

1. Start Postgres with the pgvector image:

   ```bash
   docker run -d --name rag-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg16
   ```

2. Create a `.env` file in `rag-backend/`:

   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
   OLLAMA_URL=http://localhost:11434
   PORT=3000
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create the extension, tables and indexes (safe to re-run):

   ```bash
   npm run db:setup
   ```

For a hosted database such as Supabase, point `DATABASE_URL` at it and run the same command.
