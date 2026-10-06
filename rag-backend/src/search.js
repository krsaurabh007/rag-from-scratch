// Document routing + hybrid (vector + keyword) retrieval.
const { getEmbedding } = require('./utils');

// Question words and filler that say nothing about which document or chunk is relevant.
const STOPWORDS = new Set(
  ('a an and are as at be been being but by can could did do does for from had has have how i if in ' +
    'into is it its list me my of on or our please show tell than that the their them there these ' +
    'they this those to us was we were what when where which who whom why will with would you your ' +
    'all any about give out some something anything everything total').split(' ')
);

// lowercase, drop apostrophes ("saurabh's" -> "saurabhs"), turn other punctuation into spaces
function normalize(text) {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function questionTokens(question) {
  return normalize(question)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

// Pure function (no DB, no Ollama): which documents' keywords appear in the question?
// documents: [{ id, keywords }]  ->  array of matching ids ([] when nothing matches)
function matchDocuments(question, documents) {
  const tokens = new Set(questionTokens(question));
  const padded = ` ${normalize(question)} `;

  // Single words match a question token; a trailing "s" is ignored so plurals still match.
  const wordMatches = (w) =>
    tokens.has(w) || tokens.has(w + 's') || (w.endsWith('s') && tokens.has(w.slice(0, -1)));

  return documents
    .filter((doc) =>
      (doc.keywords || []).some((keyword) => {
        const k = normalize(keyword);
        if (!k) return false;
        return k.includes(' ') ? padded.includes(` ${k} `) : wordMatches(k);
      })
    )
    .map((doc) => doc.id);
}

// Build an OR-style tsquery string. plainto_/websearch_to_tsquery AND every term together, so a
// natural-language question ("list out all the companies where I have worked") would match
// nothing. Tokens are restricted to [a-z0-9] so user input can never break to_tsquery.
function buildTsQuery(question) {
  const tokens = [...new Set(questionTokens(question).flatMap((t) => t.match(/[a-z0-9]+/g) || []))];
  const usable = tokens.filter((t) => t.length >= 2);
  return usable.length ? usable.join(' | ') : null;
}

// Hybrid search: the vector branch finds chunks that mean the same thing, the keyword branch
// finds chunks containing the exact words (names, acronyms) that embeddings often blur.
// The two lists are merged with Reciprocal Rank Fusion (RRF): score = sum of 1/(60 + rank).
// RRF is used instead of mixing ts_rank with cosine distance because those scores live on
// different scales; ranks are comparable, so there is no weight to tune.
async function retrieveChunks(pool, question, { topK = 6, documentIds = null, queryEmbedding = null } = {}) {
  const embedding = queryEmbedding || (await getEmbedding(question));
  const tsQuery = buildTsQuery(question); // null -> keyword branch returns nothing (vector only)

  const result = await pool.query(
    `WITH vector_hits AS (
       SELECT id,
              embedding <=> $1::vector AS distance,
              ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
       FROM document_chunks
       WHERE ($3::int[] IS NULL OR document_id = ANY($3::int[]))
       ORDER BY embedding <=> $1::vector
       LIMIT 20
     ),
     keyword_hits AS (
       SELECT c.id,
              ROW_NUMBER() OVER (ORDER BY ts_rank(c.content_tsv, q.query) DESC) AS rank
       FROM document_chunks c, to_tsquery('english', $2::text) AS q(query)
       WHERE c.content_tsv @@ q.query
         AND ($3::int[] IS NULL OR c.document_id = ANY($3::int[]))
       ORDER BY ts_rank(c.content_tsv, q.query) DESC
       LIMIT 20
     ),
     fused AS (
       SELECT COALESCE(v.id, k.id) AS id,
              v.rank AS vector_rank,
              k.rank AS keyword_rank,
              v.distance,
              COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + k.rank), 0) AS score
       FROM vector_hits v
       FULL OUTER JOIN keyword_hits k ON k.id = v.id
     )
     SELECT c.id, c.document_id, c.content, c.metadata,
            f.score::float AS score, f.vector_rank::int AS vector_rank,
            f.keyword_rank::int AS keyword_rank, f.distance
     FROM fused f
     JOIN document_chunks c ON c.id = f.id
     ORDER BY f.score DESC
     LIMIT $4`,
    [JSON.stringify(embedding), tsQuery, documentIds, topK]
  );
  return result.rows;
}

// Route the question to the documents whose keywords it mentions, then search only those.
// If no document matches (e.g. "list all companies"), search everything rather than nothing.
async function routeAndRetrieve(pool, question, { topK = 6 } = {}) {
  const t0 = Date.now();
  const docs = await pool.query('SELECT id, keywords FROM documents');
  const matched = matchDocuments(question, docs.rows);
  const fellBack = matched.length === 0;
  const t1 = Date.now();

  const queryEmbedding = await getEmbedding(question); // embedded once, reused by retrieveChunks
  const t2 = Date.now();

  const chunks = await retrieveChunks(pool, question, {
    topK,
    documentIds: fellBack ? null : matched,
    queryEmbedding
  });
  const t3 = Date.now();

  return {
    chunks,
    routing: { matchedDocumentIds: matched, fellBack },
    timings: { routeMs: t1 - t0, embedMs: t2 - t1, searchMs: t3 - t2 }
  };
}

module.exports = { matchDocuments, retrieveChunks, routeAndRetrieve };
