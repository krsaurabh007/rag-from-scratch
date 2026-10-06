// The single ingestion path, used by both POST /documents/upload and scripts/embed.js.
const { encode, decode } = require('gpt-tokenizer');
const { extractText, chunkText, countTokens, getEmbedding, OLLAMA_URL } = require('./utils');

const KEYWORD_MODEL = 'qwen2.5:3b';
const KEYWORD_SAMPLE_TOKENS = 600; // per slice: beginning, middle and end of the document
const MAX_KEYWORDS = 25;
const MAX_LLM_KEYWORDS = 6; // leave room for the extractor: the small model often mangles names

// Words that are never useful as keywords.
const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have had he her his i in into is it its of on or our ' +
    'she that the their them they this to was we were which with you your using used use built ' +
    'based across within also more most such than then these those will can not about after all ' +
    'any been both each during how if over per so some their there when where while who why').split(' ')
);

// Section labels / contact labels that appear in many documents and say nothing about this one.
const GENERIC = new Set(
  ('phone email github linkedin summary experience education skills introduction conclusion').split(' ')
);

// ---- helpers ----

function filenameTokens(filename) {
  return filename
    .replace(/\.[^.]+$/, '') // strip extension
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

// Emails, URLs and phone numbers are identifiers, not topics. Remove them before any analysis.
// (pdf-parse often glues them to neighbouring words, so match whole whitespace-free runs.)
function stripIdentifiers(text) {
  return text
    .replace(/\S*@\S*/g, ' ')
    .replace(/\S*(?:https?:\/\/|www\.)\S*/gi, ' ')
    .replace(/\S*\.(?:com|org|net|io|in|dev|co)\b\S*/gi, ' ')
    .replace(/\+?\d[\d\s()-]{6,}\d/g, ' ');
}

// Letters and digits only, lowercase: lets "Nexora AI Desk" be found in "nexora-ai desk".
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const mixesLettersAndDigits = (word) => /[a-z]/i.test(word) && /\d/.test(word);

// Sample the beginning, middle and end so long documents are represented, not just page 1.
function sampleText(text, sliceTokens) {
  const tokens = encode(text);
  if (tokens.length <= sliceTokens * 3) return text;
  const mid = Math.floor(tokens.length / 2 - sliceTokens / 2);
  return [
    decode(tokens.slice(0, sliceTokens)),
    decode(tokens.slice(mid, mid + sliceTokens)),
    decode(tokens.slice(-sliceTokens))
  ].join('\n...\n');
}

// ---- LLM keywords (validated against the source) ----

async function llmKeywords(text) {
  const prompt =
    'Extract up to 15 short lowercase keywords or phrases from the document excerpts below: proper ' +
    'nouns, company, product and person names, technologies, places, and the main topics. Only use ' +
    'words that appear in the text; do not invent any. Never include email addresses, URLs or phone ' +
    'numbers. Respond with JSON only, in the form {"keywords": ["...", "..."]}.\n\nDocument:\n' +
    sampleText(text, KEYWORD_SAMPLE_TOKENS);

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: KEYWORD_MODEL, prompt, stream: false, format: 'json' })
  });
  if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);
  const data = await response.json();
  const parsed = JSON.parse(data.response);
  if (!Array.isArray(parsed.keywords)) throw new Error('no keywords array in LLM response');
  return parsed.keywords.filter((k) => typeof k === 'string');
}

// A small model can invent or mangle words, so keep only keywords that really occur in the text.
function validateAgainstSource(keywords, cleanText) {
  const haystack = squash(cleanText);
  return keywords
    .map((k) => k.toLowerCase().trim().replace(/\s+/g, ' '))
    .filter((k) => k.length >= 3)
    .filter((k) => !k.split(' ').some((w) => mixesLettersAndDigits(w) || GENERIC.has(w)))
    .filter((k) => haystack.includes(squash(k)));
}

// ---- programmatic extractor (always runs) ----

// Counts proper-noun phrases ("arjun mehta", "nexora ai desk"), single proper nouns ("zeksta",
// "tenantiq") and frequent plain terms. Pure string work: no model, so it is cheap and stable.
function extractCandidates(cleanText) {
  const isNoise = (w) => {
    const l = w.toLowerCase();
    return STOPWORDS.has(l) || GENERIC.has(l) || mixesLettersAndDigits(w) || /(?:ed|ing)$/.test(l);
  };
  const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
  // Company-style names ("Zeksta Technology Pvt Ltd") identify a document better than a tool
  // name does, so they get a head start when frequencies tie.
  const COMPANY_WORD = /^(?:pvt|ltd|inc|llc|corp|technology|technologies|labs|systems|solutions|partners)$/i;

  const phrases = new Map();
  const strong = new Map(); // names we are confident about: lead words of phrases, TenantIQ-style
  const weak = new Map(); // capitalized mid-sentence words: plausible, but often just ordinary nouns

  // Runs of 2+ capitalized words separated by single spaces, e.g. "Nexora AI Desk".
  const phraseRe = /\b[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)+\b/g;
  for (const match of cleanText.match(phraseRe) || []) {
    const words = match.split(' ');
    while (words.length && isNoise(words[0])) words.shift(); // sentence-opening "The", "Developed"
    while (words.length && isNoise(words[words.length - 1])) words.pop();
    if (words.length >= 2 && !words.some((w) => mixesLettersAndDigits(w))) {
      bump(phrases, words.join(' ').toLowerCase(), words.some((w) => COMPANY_WORD.test(w)) ? 5 : 1);
    }
    // The lead word of a proper-noun phrase is itself a name ("Zeksta" in "Zeksta Technology").
    if (words.length >= 2 && words[0].length >= 3) bump(strong, words[0].toLowerCase(), words.some((w) => COMPANY_WORD.test(w)) ? 5 : 1);
  }

  // Single capitalized words: internal capitals (TenantIQ, eBook) or seen mid-sentence (Bengaluru).
  const wordRe = /(^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]*)/g;
  let m;
  while ((m = wordRe.exec(cleanText))) {
    const word = m[2];
    if (word.length < 3 || isNoise(word) || mixesLettersAndDigits(word)) continue;
    const internalCapital = /[a-z][A-Z]/.test(word);
    const before = cleanText.slice(Math.max(0, m.index - 3), m.index + m[1].length);
    const sentenceInitial = m.index === 0 || /(^|[.!?:–—•-]|\n)\s*$/.test(before);
    if (!/^[A-Za-z]/.test(word)) continue;
    if (internalCapital) bump(strong, word.toLowerCase());
    else if (/^[A-Z]/.test(word) && !sentenceInitial) bump(weak, word.toLowerCase());
  }

  // Entry-title lines ("TenantIQ — Multi-Tenant SaaS| Live", "Zeksta Technology ... 2024 – 2025"):
  // a short line with a separator or a year starts with the name of the thing it introduces.
  for (const line of cleanText.split('\n')) {
    const trimmed = line.trim();
    const isTitleLine =
      trimmed.length < 80 && !/[.!?]$/.test(trimmed) && (/\s[—–-]\s|\|/.test(trimmed) || /\b(?:19|20)\d{2}\b/.test(trimmed));
    const first = isTitleLine && trimmed.match(/^[A-Za-z][A-Za-z0-9]*/);
    if (first && first[0].length >= 3 && !isNoise(first[0])) bump(strong, first[0].toLowerCase(), 3);
  }

  // Frequent plain lowercase terms (topics): appear at least twice.
  const terms = new Map();
  for (const w of cleanText.toLowerCase().match(/[a-z]{4,}/g) || []) {
    if (!isNoise(w)) bump(terms, w);
  }

  const byFrequency = (map, min) =>
    [...map.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([k]) => k);

  return {
    phrases: byFrequency(phrases, 1),
    strongNames: byFrequency(strong, 1),
    weakNames: byFrequency(weak, 1),
    frequentTerms: byFrequency(terms, 2)
  };
}

// Keywords power document routing at question time. Never let this fail an upload.
async function generateKeywords(text, filename) {
  const cleanText = stripIdentifiers(text);

  let llm = [];
  try {
    llm = validateAgainstSource(await llmKeywords(cleanText), cleanText);
  } catch (err) {
    console.warn(`Keyword generation via LLM failed (${err.message}); using extractor only.`);
  }

  let extracted = { phrases: [], strongNames: [], weakNames: [], frequentTerms: [] };
  try {
    extracted = extractCandidates(cleanText);
  } catch (err) {
    console.warn("Keyword extractor failed (" + err.message + ").");
  }

  // Merge in order of reliability. Each group may add at most `cap` NEW keywords, so one noisy
  // group cannot crowd out the rest. Filename tokens go first: they survive on every code path.
  const seen = new Set();
  const result = [];
  const take = (list, cap) => {
    let added = 0;
    for (const raw of list) {
      const k = raw.toLowerCase().trim();
      if (added >= cap || result.length >= MAX_KEYWORDS) break;
      if (k.length < 3 || seen.has(k)) continue;
      seen.add(k);
      result.push(k);
      added++;
    }
  };
  take(filenameTokens(filename), MAX_KEYWORDS);
  take(llm, MAX_LLM_KEYWORDS);
  take(extracted.phrases, 10);
  take(extracted.strongNames, 6);
  take(extracted.weakNames, 2);
  take(extracted.frequentTerms, 4);
  return result;
}

async function ingestDocument(pool, filePath, filename) {
  const text = await extractText(filePath);
  const chunks = chunkText(text);

  const docResult = await pool.query('INSERT INTO documents (filename) VALUES ($1) RETURNING id', [filename]);
  const documentId = docResult.rows[0].id;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await getEmbedding(chunks[i]);
      // content_tsv is a generated column, so we do not insert it.
      await pool.query(
        `INSERT INTO document_chunks (document_id, content, embedding, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          documentId,
          chunks[i],
          JSON.stringify(embedding),
          JSON.stringify({ source: filename, chunk_index: i, token_count: countTokens(chunks[i]) })
        ]
      );
    }
  } catch (err) {
    // No half-ingested documents: the FK cascade removes any chunks already stored.
    await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);
    throw err;
  }

  // Keywords are a bonus (used for routing). A failure here must not lose a good ingestion.
  let keywords = [];
  try {
    keywords = await generateKeywords(text, filename);
    if (keywords.length === 0) console.warn(`Document ${documentId}: keyword list is empty.`);
    const update = await pool.query('UPDATE documents SET keywords = $1 WHERE id = $2', [keywords, documentId]);
    if (update.rowCount !== 1) console.warn(`Document ${documentId}: keyword UPDATE matched ${update.rowCount} rows.`);
  } catch (err) {
    console.warn(`Document ${documentId}: could not store keywords (${err.message}).`);
  }
  return { documentId, chunksStored: chunks.length, keywords };
}

module.exports = { ingestDocument, generateKeywords, extractCandidates };
