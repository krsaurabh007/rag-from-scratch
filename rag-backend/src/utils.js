const fs = require('fs');
const pdf = require('pdf-parse');
const { encode } = require('gpt-tokenizer');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

async function extractText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text;
}

// ---- Chunking settings (tune these) ----
const MAX_TOKENS = 256;    // hard ceiling for one chunk
const OVERLAP_TOKENS = 40; // roughly how much of the previous chunk to repeat
const LONG_LINE = 70;      // a line this long (in chars) was probably hard-wrapped by the PDF

// Token counts come from gpt-tokenizer (OpenAI BPE). nomic-embed-text uses a different
// tokenizer, so this is an approximation - fine for sizing, not exact.
function countTokens(text) {
  return encode(text).length;
}

// Step 1 - normalize: pdf-parse hard-wraps lines with "\n", so a sentence is often spread
// over several lines. Rebuild flowing text, but keep bullets and short heading-like
// lines as their own lines so they stay natural boundaries.
// Returns paragraphs (split on blank lines), each an array of line-units.
function normalizeToParagraphs(text) {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' '); // collapse repeated spaces/tabs

  return cleaned
    .split(/\n\s*\n/) // blank-line paragraphs
    .map((para) => {
      const units = [];
      let prev = '';
      for (const line of para.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const isBullet = /^[–—•*-]\s/.test(line);
        // A wrapped continuation: previous line was long and did not end a sentence.
        const isContinuation =
          units.length > 0 && !isBullet && prev.length >= LONG_LINE && !/[.!?:]$/.test(prev);
        if (isContinuation) units[units.length - 1] += ' ' + line;
        else units.push(line); // bullet, heading, or start of a new line of content
        prev = line;
      }
      return units;
    })
    .filter((units) => units.length > 0);
}

// Step 2 - break one oversized piece down: sentences first, then words as a last resort.
// Returned pieces fit in maxTokens (except a single giant word, which can't be split).
function splitOversized(unit, maxTokens) {
  const sentences = unit.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
  const pieces = [];
  for (const sentence of sentences) {
    if (countTokens(sentence) <= maxTokens) {
      pieces.push(sentence);
      continue;
    }
    let current = '';
    for (const word of sentence.split(/\s+/)) {
      const candidate = current ? current + ' ' + word : word;
      if (current && countTokens(candidate) > maxTokens) {
        pieces.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) pieces.push(current);
  }
  return pieces;
}

// A heading-like line: short, single line, not a bullet, no sentence punctuation at the end.
// Covers section headings ("Experience"), entry titles ("Zeksta ... 2024 - 2025") and role lines.
const HEADING_MAX_CHARS = 80;
function isHeadingLine(text) {
  return (
    !text.includes('\n') &&
    text.length < HEADING_MAX_CHARS &&
    !/^[–—•*-]\s/.test(text) &&
    !/[.!?]$/.test(text)
  );
}

// A section heading is a very short, plain-words line ("Summary", "Technical Skills").
// Anything else heading-like is treated as an entry title under the current section.
function isSectionHeading(text) {
  return /^[A-Za-z&/ ]+$/.test(text) && text.split(/\s+/).length <= 2;
}

// Step 2 - turn text into units, preferring the biggest natural boundary that fits.
// Each unit also records `heading` and `ctx` (the section + entry titles it sits under),
// so a chunk that starts mid-section can be told where it came from.
function splitIntoUnits(text, maxTokens) {
  const units = [];
  const add = (t, canBeHeading) =>
    units.push({ text: t, tokens: countTokens(t), heading: canBeHeading && isHeadingLine(t) });

  for (const lines of normalizeToParagraphs(text)) {
    const paragraph = lines.join('\n');
    if (countTokens(paragraph) <= maxTokens) {
      add(paragraph, true); // whole paragraph fits: keep it intact
      continue;
    }
    for (const line of lines) { // otherwise fall back to bullet/heading lines
      if (countTokens(line) <= maxTokens) add(line, true);
      else splitOversized(line, maxTokens).forEach((p) => add(p, false)); // sentences, then words
    }
  }

  // Walk the units once, remembering the latest section heading and the entry titles under it.
  let section = null;
  let entries = [];
  let prevWasHeading = false;
  for (const u of units) {
    if (u.heading && isSectionHeading(u.text)) {
      u.ctx = { section: null, entries: [] };
      section = u.text;
      entries = [];
    } else {
      // A new run of heading lines after body text means a new entry: forget the old titles.
      if (u.heading && !prevWasHeading) entries = [];
      u.ctx = { section, entries: [...entries] };
      // "Label: value" lines (e.g. "Languages: JavaScript") are content, not titles to repeat.
      if (u.heading && !/:\s/.test(u.text)) entries.push(u.text);
    }
    prevWasHeading = u.heading;
  }
  return units;
}

// Step 3 - pack whole units greedily. Three things keep chunks self-explanatory:
//  * overlap: a new chunk starts with 1-2 whole units from the end of the previous one;
//  * heading carry: heading lines never end a chunk, they move to the next one;
//  * context header: a chunk that starts mid-section gets the section + entry title lines.
function buildChunks(text, options = {}) {
  const maxTokens = options.maxTokens ?? MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? OVERLAP_TOKENS;
  const units = splitIntoUnits(text, maxTokens);

  // Measure the real joined text (header + units), since newlines cost tokens too.
  const render = (header, list) => [...header, ...list.map((u) => u.text)].join('\n');
  const tokensOf = (header, list) => countTokens(render(header, list));

  // Header lines for a chunk whose first unit is `first`. `short` keeps entry titles only.
  // Lines that already open the chunk are skipped so nothing is printed twice.
  const headerFor = (first, leading, short) => {
    const { section, entries } = first.ctx;
    const lines = (short ? entries : [section, ...entries]).filter(Boolean);
    const already = new Set(leading.filter((u) => u.heading).map((u) => u.text));
    return lines.filter((l) => !already.has(l));
  };

  // Start a chunk from [overlap, carried headings, new unit]. Shed overlap first, then
  // shorten the header, then drop it, until everything fits. Returns null if even the
  // bare carried headings + unit do not fit (caller then retries without carrying).
  const startChunk = (kept, carry, unit, mustFit) => {
    const overlap = [];
    for (let i = kept.length - 1; i >= 0 && overlap.length < 2; i--) {
      if (tokensOf([], [kept[i], ...overlap]) > overlapTokens) break;
      overlap.unshift(kept[i]);
    }
    const attempts = [];
    for (let k = 0; k <= overlap.length; k++) attempts.push([overlap.slice(k), false]);
    attempts.push([[], true]); // no overlap, entry-title header only
    for (const [ov, short] of attempts) {
      const body = [...ov, ...carry, unit];
      const header = headerFor(body[0], body, short);
      if (tokensOf(header, body) <= maxTokens) return { header, units: body, ownStart: ov.length };
    }
    if (!mustFit) return null;
    const body = [...carry, unit]; // a single oversized word: nothing more we can do
    return { header: [], units: body, ownStart: 0 };
  };

  const chunks = [];
  let current = null;

  for (const unit of units) {
    if (!current) {
      current = { header: headerFor(unit, [unit], false), units: [unit], ownStart: 0 };
      if (tokensOf(current.header, current.units) > maxTokens) current.header = [];
      continue;
    }
    if (tokensOf(current.header, [...current.units, unit]) <= maxTokens) {
      current.units.push(unit);
      continue;
    }

    // Close the chunk. Trailing heading lines are carried over so no chunk ends on one.
    const kept = current.units.slice();
    const carry = [];
    while (kept.length > 1 && kept[kept.length - 1].heading) carry.unshift(kept.pop());

    let next = startChunk(kept, carry, unit, false);
    if (next) {
      current.units = kept;
    } else {
      next = startChunk(current.units, [], unit, true); // carrying did not fit: keep as is
    }
    chunks.push(current);
    current = next;
  }
  if (current) chunks.push(current);

  // Avoid a tiny trailing chunk: fold its own content into the previous chunk if it fits.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const own = last.units.slice(last.ownStart);
    const prev = chunks[chunks.length - 2];
    if (tokensOf([], own) < overlapTokens && tokensOf(prev.header, [...prev.units, ...own]) <= maxTokens) {
      prev.units.push(...own);
      chunks.pop();
    }
  }

  return chunks
    .map((c) => ({ text: render(c.header, c.units).trim(), header: c.header }))
    .filter((c) => c.text.length > 0);
}

// Public API: just the strings.
function chunkText(text, options = {}) {
  return buildChunks(text, options).map((c) => c.text);
}

async function getEmbedding(text) {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', input: text })
  });
  const data = await response.json();
  return data.embeddings[0];
}

async function generateAnswer(question, contextChunks) {
  const context = contextChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are answering questions based only on the context below. If the answer isn't in the context, say you don't know.

Today's date is ${today}. In the context, "Present" in a date range means ${today}.
If the context states the answer directly (for example "2.7 years of experience" in a summary), quote that value as-is and do not recalculate it.
Keep answers concise. Do not show step-by-step arithmetic unless the user asks for it.

Context:
${context}

Question: ${question}

Answer:`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3.1:8b', prompt, stream: false })
  });
  const data = await response.json();
  return data.response;
}

module.exports = { extractText, chunkText, buildChunks, countTokens, getEmbedding, generateAnswer, OLLAMA_URL };
