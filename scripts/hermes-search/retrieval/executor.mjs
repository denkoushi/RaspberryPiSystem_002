import { performance } from 'node:perf_hooks';
import { catalogEntries, fieldsWithRole } from './catalog.mjs';
import { RERANK_ACCEPT_AT } from './embed-runtime.mjs';
import { RELEVANCE_CANDIDATE_LIMIT } from './relevance-jev.mjs';
import { contentQuery, contentTokens } from './structural-text.mjs';
import { hasAppliedHardFilter } from './query-plan.mjs';
import { normalizeForMatch } from './value-index.mjs';

/** Reciprocal-rank constant. One value shared by fusion. */
export const RRF_K = 60;
/**
 * A content token is generic when it occurs in more than this fraction of the snapshot.
 * The IDF cutoff for a snapshot is specificTokenIdfThreshold(documentCount).
 */
export const GENERIC_DOCUMENT_RATE = 0.1;
/**
 * Cosine calibration kept for reference. It is not a final acceptance gate.
 * Five invented generic phrases, top-50 each against the sealed index
 * (250 scores): min 0.275, p50 0.339, p95 0.453, max 0.475.
 */
export const VECTOR_COSINE_MIN = 0.48;
const VECTOR_RELATIVE_RANK = 20;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const SEALED_EMBED_MODEL = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
const SEALED_EMBED_CACHE_FILE = 'hf_ggml-org_embeddinggemma-300M-Q8_0.gguf';
const VECTOR_SEARCH_LIMIT = 50;

export function specificTokenIdfThreshold(docCount) {
  const count = Math.max(1, docCount);
  const frequency = Math.min(count, Math.max(1, GENERIC_DOCUMENT_RATE * count));
  return Math.log(1 + ((count - frequency + 0.5) / (frequency + 0.5)));
}

export function tokenIdf(docCount, documentFrequency) {
  const count = Math.max(1, docCount);
  return Math.log(1 + ((count - documentFrequency + 0.5) / (documentFrequency + 0.5)));
}

export function isSpecificContentToken(documentFrequency, docCount) {
  if (documentFrequency <= 0) return false;
  if (documentFrequency === 1) return true;
  return tokenIdf(docCount, documentFrequency) > specificTokenIdfThreshold(docCount);
}
const SINGLE_KANJI = /^\p{Script=Han}$/u;
const SINGLE_KATAKANA = /^\p{Script=Katakana}$/u;
const KATAKANA_WORD = /^[\p{Script=Katakana}ー]+$/u;

function isSingleContentCharacter(token) {
  return SINGLE_KANJI.test(token) || SINGLE_KATAKANA.test(token);
}

function safeReason(error) {
  return String(error?.message ?? error ?? 'vector ranking failed').slice(0, 300);
}

function unigramTerm(token) {
  if (isSingleContentCharacter(token)) return token;
  if (KATAKANA_WORD.test(token)) return token;
  return null;
}

function tokenBigrams(token) {
  const grams = [];
  for (let index = 0; index < token.length - 1; index += 1) grams.push(token.slice(index, index + 2));
  return grams;
}

function enrichmentText(record) {
  const extra = record?.enrichment;
  if (!extra || typeof extra !== 'object') return '';
  const parts = [];
  if (typeof extra.summary === 'string' && extra.summary) parts.push(extra.summary);
  if (Array.isArray(extra.queries)) parts.push(...extra.queries.filter((item) => typeof item === 'string' && item));
  if (Array.isArray(extra.tags)) parts.push(...extra.tags.filter((item) => typeof item === 'string' && item));
  return parts.join('\n');
}

function bodyText(record, bodyFields) {
  const parts = [];
  for (const key of bodyFields) {
    const value = record?.[key];
    if (typeof value === 'string' && value) parts.push(value);
  }
  const extra = enrichmentText(record);
  if (extra) parts.push(extra);
  return parts.join('\n');
}

function queryTerms(tokens) {
  const bigrams = new Set();
  const unigrams = new Set();
  for (const token of tokens) {
    for (const gram of tokenBigrams(token)) bigrams.add(gram);
    const unigram = unigramTerm(token);
    if (unigram) unigrams.add(unigram);
  }
  return { bigrams, unigrams };
}

/**
 * Document frequencies for the query's character bigrams, over the whole snapshot.
 * Called once per execute, which is once per snapshot load in the CLI.
 */
export function prepareLexicalCorpus(records, bodyFields) {
  const documents = [];
  let totalLength = 0;
  for (const record of records) {
    const folded = bodyText(record, bodyFields).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
    const length = Math.max(0, folded.length - 1);
    totalLength += length;
    documents.push({ id: record.id, folded, length });
  }
  const docCount = records.length;
  return { documents, docCount, totalLength, avgLength: docCount ? totalLength / docCount : 0 };
}

function filterValueTexts(filters) {
  const values = [];
  for (const filter of filters ?? []) {
    for (const value of filter?.values ?? []) {
      if (typeof value === 'string' && value.trim()) values.push(value.normalize('NFKC').toLowerCase());
    }
  }
  return values;
}

function tokenMatchesFilterValue(token, values) {
  if (!values.length) return false;
  const folded = token.normalize('NFKC').toLowerCase();
  return values.some((value) => value.includes(folded) || folded.includes(value));
}

export function buildLexicalIndex(records, bodyFields, query, corpus = null, filters = []) {
  const tokens = contentTokens(query);
  const filterValues = filterValueTexts(filters);
  const quietTokens = new Set(tokens.filter((token) => tokenMatchesFilterValue(token, filterValues)));
  const { bigrams: queryGrams, unigrams } = queryTerms(tokens);
  const df = new Map();
  for (const gram of queryGrams) df.set(gram, 0);
  for (const term of unigrams) df.set(term, 0);
  const tokenFrequency = new Map();
  for (const token of tokens) tokenFrequency.set(token, 0);
  const documents = new Map();
  const prepared = corpus?.documents ?? null;
  let totalLength = prepared ? corpus.totalLength ?? 0 : 0;
  const rows = prepared ?? records;
  for (const record of rows) {
    const folded = prepared
      ? record.folded
      : bodyText(record, bodyFields).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
    const length = prepared ? record.length : Math.max(0, folded.length - 1);
    if (!prepared) totalLength += length;
    const counts = new Map();
    const seen = new Set();
    for (let index = 0; index < folded.length - 1; index += 1) {
      const gram = folded.slice(index, index + 2);
      if (!queryGrams.has(gram)) continue;
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
      seen.add(gram);
    }
    for (const term of unigrams) {
      if (term.length === 2) continue;
      if (!folded.includes(term)) continue;
      let from = 0;
      let seenTerm = false;
      while (from <= folded.length - term.length) {
        const found = folded.indexOf(term, from);
        if (found < 0) break;
        counts.set(term, (counts.get(term) ?? 0) + 1);
        seenTerm = true;
        from = found + term.length;
      }
      if (seenTerm) seen.add(term);
    }
    for (const gram of seen) df.set(gram, (df.get(gram) ?? 0) + 1);
    for (const token of tokens) {
      if (folded.includes(token)) tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    }
    documents.set(record.id, { counts, length });
  }
  const docCount = prepared ? (corpus.docCount ?? prepared.length) : records.length;
  const idf = new Map();
  for (const [gram, frequency] of df) idf.set(gram, tokenIdf(docCount, frequency));
  const specificTokens = new Set();
  for (const [token, frequency] of tokenFrequency) {
    if (isSpecificContentToken(frequency, docCount)) specificTokens.add(token);
  }
  return {
    tokens,
    quietTokens,
    documents,
    idf,
    specificTokens,
    avgLength: docCount ? totalLength / docCount : 0,
  };
}

export function matchesSpecificToken(record, bodyFields, index) {
  if (!index?.specificTokens?.size) return false;
  const folded = bodyText(record, bodyFields).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
  if (!folded) return false;
  for (const token of index.specificTokens) {
    if (folded.includes(token)) return true;
  }
  return false;
}

function bm25Weight(tf, idf, length, average) {
  if (!tf || !idf) return 0;
  const denom = tf + (BM25_K1 * (1 - BM25_B + (BM25_B * (length / average))));
  return idf * ((tf * (BM25_K1 + 1)) / denom);
}

function scoreDocument(recordId, index) {
  const doc = index.documents.get(recordId);
  if (!doc || !index.tokens.length) return { score: 0, contentTokenScore: 0 };
  const average = index.avgLength || 1;
  let score = 0;
  let contentTokenScore = 0;
  for (const token of index.tokens) {
    const grams = tokenBigrams(token);
    const unigram = unigramTerm(token);
    let tokenScore = 0;
    let parts = 0;
    if (grams.length) {
      let gramScore = 0;
      for (const gram of grams) gramScore += bm25Weight(doc.counts.get(gram) ?? 0, index.idf.get(gram) ?? 0, doc.length, average);
      tokenScore += gramScore / grams.length;
      parts += 1;
    }
    if (unigram && unigram.length !== 2) {
      tokenScore += bm25Weight(doc.counts.get(unigram) ?? 0, index.idf.get(unigram) ?? 0, doc.length, average);
      parts += 1;
    }
    if (!parts) continue;
    if (index.quietTokens?.has(token)) continue;
    score += tokenScore;
    if (tokenScore > contentTokenScore) contentTokenScore = tokenScore;
  }
  return { score, contentTokenScore };
}

/**
 * Reciprocal rank fusion with RRF_K, then the recall floor.
 * A candidate stays when its lexical score is positive on a content token
 * or its vector rank is 20 or better. The fused list is capped at
 * RELEVANCE_CANDIDATE_LIMIT. VECTOR_COSINE_MIN is not applied.
 * Date sort, the relevance judgment, and limit happen after this list.
 */
export function fuseRankings(lexicalOrdered, vectorOrdered) {
  const lexicalRank = new Map();
  const contentScore = new Map();
  lexicalOrdered.forEach((item, index) => {
    if (lexicalRank.has(item.id)) return;
    lexicalRank.set(item.id, index + 1);
    contentScore.set(item.id, Number(item.contentTokenScore) || 0);
  });
  const vectorRank = new Map();
  vectorOrdered.forEach((item, index) => {
    if (!vectorRank.has(item.id)) vectorRank.set(item.id, index + 1);
  });
  const fused = [];
  for (const id of new Set([...lexicalRank.keys(), ...vectorRank.keys()])) {
    const lexicalPosition = lexicalRank.get(id) ?? null;
    const vectorPosition = vectorRank.get(id) ?? null;
    const lexicalHit = (contentScore.get(id) ?? 0) > 0;
    const vectorHit = vectorPosition != null && vectorPosition <= VECTOR_RELATIVE_RANK;
    if (!(lexicalHit || vectorHit)) continue;
    let score = 0;
    if (lexicalPosition != null) score += 1 / (RRF_K + lexicalPosition);
    if (vectorPosition != null) score += 1 / (RRF_K + vectorPosition);
    fused.push({ id, score, contentTokenScore: contentScore.get(id) ?? 0, vectorRank: vectorPosition });
  }
  fused.sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));
  return fused.slice(0, RELEVANCE_CANDIDATE_LIMIT);
}

function compareRaw(left, right) {
  const a = left == null ? '' : String(left);
  const b = right == null ? '' : String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function matchesFilter(record, filter) {
  const raw = record?.[filter.field];
  const text = raw == null ? '' : String(raw);
  if (filter.op === 'before' || filter.op === 'after' || filter.op === 'between') {
    if (!text) return false;
    const bounds = [...filter.values].sort((left, right) => compareRaw(left, right));
    if (filter.op === 'before') return text < bounds[0];
    if (filter.op === 'after') return text > bounds[0];
    return text >= bounds[0] && text <= bounds[bounds.length - 1];
  }
  const norm = normalizeForMatch(text);
  const values = filter.values.map((value) => normalizeForMatch(value));
  if (!norm && filter.op !== 'not_in') return false;
  if (filter.op === 'eq') return norm === values[0];
  if (filter.op === 'in') return values.includes(norm);
  if (filter.op === 'not_in') return !values.includes(norm);
  return false;
}

function originalFields(record, display) {
  const fields = {};
  for (const key of display) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    if (typeof value !== 'string') continue;
    fields[key] = value;
  }
  return fields;
}

function scoreMap(value) {
  if (!value) return new Map();
  if (value instanceof Map) return value;
  if (Array.isArray(value)) {
    return new Map(value.map((item) => [item.recordId, Number(item.score) || 0]));
  }
  return new Map();
}

function vectorOrder(ranked, allowed) {
  const cosineOf = (id) => {
    const fromMap = ranked?.cosines?.get?.(id);
    if (Number.isFinite(fromMap)) return fromMap;
    const fromScores = scoreMap(ranked?.scores).get(id);
    return Number.isFinite(fromScores) ? fromScores : null;
  };
  if (Array.isArray(ranked?.orderedIds)) {
    const ordered = [];
    const seen = new Set();
    for (const id of ranked.orderedIds) {
      if (!allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      ordered.push({ id, cosine: cosineOf(id) });
    }
    return ordered;
  }
  return [...scoreMap(ranked?.scores).entries()]
    .filter(([id]) => allowed.has(id))
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .map(([id, cosine]) => ({ id, cosine }));
}

function bodyFieldsFor(plan, options) {
  if (Array.isArray(options.bodyFields)) return options.bodyFields;
  if (options.catalog) return fieldsWithRole(options.catalog, 'body');
  return [];
}

function planLimit(plan) {
  return Number.isInteger(plan?.limit) ? Math.min(20, Math.max(1, plan.limit)) : 5;
}

function unavailableResult(reason, timings, plan) {
  const limit = planLimit(plan);
  return {
    status: 'unavailable',
    reason: safeReason(reason),
    results: [],
    insufficient: true,
    requested: limit,
    returned: 0,
    timings: {
      filterMs: timings.filterMs,
      lexicalMs: timings.lexicalMs,
      vectorMs: timings.vectorMs,
      vectorStatus: timings.vectorStatus,
      vectorReason: timings.vectorReason,
      relevanceMs: timings.relevanceMs,
      filteredCount: timings.filteredCount,
      totalMs: Math.round(performance.now() - timings.started),
    },
  };
}

export async function execute(plan, options = {}) {
  const started = performance.now();
  const records = options.records ?? [];
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (Array.isArray(plan?.unresolved) && plan.unresolved.length) {
    return {
      status: 'clarification',
      results: [],
      timings: { filterMs: 0, lexicalMs: 0, vectorMs: null, vectorStatus: 'not_requested', vectorReason: null, relevanceMs: null, filteredCount: 0, totalMs: 0 },
      insufficient: false,
      requested: null,
      returned: 0,
      clarification: { message: 'Some terms could not be resolved to an indexed value.', candidates: plan.unresolved },
    };
  }
  const filterStarted = performance.now();
  const filters = Array.isArray(plan?.filters) ? plan.filters : [];
  const filtered = records.filter((record) => filters.every((filter) => matchesFilter(record, filter)));
  const filterMs = Math.round(performance.now() - filterStarted);
  const semanticQuery = typeof plan?.semanticQuery === 'string' ? plan.semanticQuery.trim() : '';
  const bodyFields = bodyFieldsFor(plan, options);
  const customLexical = typeof options.lexical === 'function' ? options.lexical : null;
  const lexicalIndex = semanticQuery && !customLexical
    ? buildLexicalIndex(records, bodyFields, semanticQuery, options.lexicalCorpus, filters)
    : null;
  let vectorStatus = semanticQuery ? 'skipped' : 'not_requested';
  let vectorReason = semanticQuery && typeof options.vector !== 'function' ? 'vector ranker was not provided' : null;
  let vectorMs = null;
  let vectorOrdered = [];
  const lexicalStarted = performance.now();
  const lexicalScores = new Map();
  const lexicalRows = [];
  if (semanticQuery) {
    for (const record of filtered) {
      let score = 0;
      let contentTokenScore = 0;
      if (customLexical) {
        score = Number(customLexical(semanticQuery, record));
        if (!Number.isFinite(score)) score = 0;
        contentTokenScore = score > 0 ? score : 0;
      } else {
        const scored = scoreDocument(record.id, lexicalIndex);
        score = scored.score;
        contentTokenScore = scored.contentTokenScore;
      }
      lexicalScores.set(record.id, score);
      lexicalRows.push({ id: record.id, score, contentTokenScore });
    }
    lexicalRows.sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));
  }
  const lexicalMs = semanticQuery ? Math.round(performance.now() - lexicalStarted) : 0;
  if (semanticQuery && typeof options.vector === 'function') {
    const vectorStarted = performance.now();
    try {
      const ranked = await options.vector(semanticQuery, filtered);
      vectorMs = Math.round(performance.now() - vectorStarted);
      if (ranked?.ok) {
        vectorOrdered = vectorOrder(ranked, new Set(filtered.map((record) => record.id)));
        vectorStatus = 'ok';
        vectorReason = null;
        if (Number.isFinite(ranked.searchMs)) vectorMs = ranked.searchMs;
      } else {
        vectorStatus = 'failed';
        vectorReason = safeReason(ranked?.reason ?? 'vector ranking unavailable');
      }
    } catch (error) {
      vectorMs = Math.round(performance.now() - vectorStarted);
      vectorStatus = 'failed';
      vectorReason = safeReason(error);
    }
  }
  const byId = new Map(filtered.map((record) => [record.id, record]));
  const filteredOnly = !semanticQuery && hasAppliedHardFilter(plan, options.catalog);
  let ranked;
  if (filteredOnly) {
    ranked = filtered.map((record) => ({ record, score: 0, lexicalValue: 0 }));
  } else if (!semanticQuery) {
    ranked = [];
  } else if (vectorOrdered.length) {
    ranked = fuseRankings(lexicalRows.filter((item) => item.contentTokenScore > 0), vectorOrdered)
      .map((item) => ({ record: byId.get(item.id), score: item.score, lexicalValue: lexicalScores.get(item.id) ?? 0 }))
      .filter((item) => item.record);
  } else {
    const pool = filtered.length <= RELEVANCE_CANDIDATE_LIMIT ? lexicalRows : lexicalRows.slice(0, RELEVANCE_CANDIDATE_LIMIT);
    ranked = pool
      .map((item) => ({ record: byId.get(item.id), score: item.score, lexicalValue: lexicalScores.get(item.id) ?? 0 }))
      .filter((item) => item.record);
  }
  let relevanceMs = semanticQuery ? 0 : null;
  let rerankMs = null;
  if (semanticQuery && typeof options.rerank === 'function') {
    const rerankStarted = performance.now();
    const pool = ranked.slice(0, RELEVANCE_CANDIDATE_LIMIT);
    const judged = await options.rerank({
      semanticQuery,
      candidates: pool.map((item) => ({ id: item.record.id, record: item.record })),
      bodyFields,
    });
    rerankMs = Math.round(performance.now() - rerankStarted);
    const scored = new Map((judged?.ranked ?? []).map((item) => [item.id, Number(item.score) || 0]));
    const kept = pool.filter((item) => (scored.get(item.record.id) ?? 0) >= (options.rerankMin ?? RERANK_ACCEPT_AT));
    ranked = kept.map((item) => ({ ...item, score: scored.get(item.record.id) ?? 0 }));
    if (options.rerankMode === 'replace') {
      relevanceMs = null;
    }
  }
  if (semanticQuery && typeof options.relevance === 'function' && options.rerankMode !== 'replace') {
    const relevanceStarted = performance.now();
    try {
      const judged = await options.relevance({
        semanticQuery,
        candidates: ranked.map((item) => ({ id: item.record.id, record: item.record })),
        bodyFields,
      });
      relevanceMs = Number.isFinite(judged?.relevanceMs)
        ? judged.relevanceMs
        : Math.round(performance.now() - relevanceStarted);
      if (!judged?.ok || !Array.isArray(judged.ranked)) {
        return unavailableResult(judged?.reason ?? 'relevance judgment unavailable', {
          filterMs, lexicalMs, vectorMs, vectorStatus, vectorReason, relevanceMs, filteredCount: filtered.length, started,
        }, plan);
      }
      const probability = new Map(judged.ranked.map((item) => [item.id, Number(item.probability) || 0]));
      ranked = ranked
        .filter((item) => probability.has(item.record.id))
        .map((item) => ({ ...item, score: probability.get(item.record.id) }));
    } catch (error) {
      relevanceMs = Number.isFinite(error?.relevanceMs) ? error.relevanceMs : Math.round(performance.now() - relevanceStarted);
      return unavailableResult(safeReason(error), {
        filterMs, lexicalMs, vectorMs, vectorStatus, vectorReason, relevanceMs, filteredCount: filtered.length, started,
      }, plan);
    }
  }
  const direction = filteredOnly && (plan?.sort === 'relevance' || !plan?.sort)
    ? -1
    : (plan?.sort && plan.sort !== 'relevance' ? (plan.sort.direction === 'asc' ? 1 : -1) : null);
  const sortField = direction
    ? (plan?.sort && plan.sort !== 'relevance' ? plan.sort.field : (options.catalog ? fieldsWithRole(options.catalog, 'date')[0] : null))
    : null;
  ranked.sort((left, right) => {
    if (sortField) {
      const compared = compareRaw(left.record?.[sortField], right.record?.[sortField]) * direction;
      if (compared !== 0) return compared;
    } else if (left.score !== right.score) {
      return right.score - left.score;
    }
    return String(left.record?.id ?? '').localeCompare(String(right.record?.id ?? ''));
  });
  const limit = planLimit(plan);
  const display = Array.isArray(plan?.display) ? plan.display : [];
  const sourceId = Array.isArray(plan?.sources) && plan.sources.length === 1
    ? plan.sources[0]
    : (options.sourceId ?? plan?.sources?.[0] ?? null);
  const results = ranked.slice(0, limit).map((item) => ({
    sourceId,
    recordId: item.record.id,
    fields: originalFields(item.record, display),
  }));
  return {
    status: results.length ? 'answer' : 'no_result',
    insufficient: plan?.diagnostics?.limitExplicit === false ? false : results.length < limit,
    requested: limit,
    returned: results.length,
    results,
    timings: {
      filterMs,
      lexicalMs,
      vectorMs,
      vectorStatus,
      vectorReason,
      relevanceMs,
      rerankMs,
      filteredCount: filtered.length,
      totalMs: Math.round(performance.now() - started),
    },
  };
}

async function sha256File(filePath) {
  const { createHash } = await import('node:crypto');
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function ensureIndexCopy(fs, sourcePath, dbPath) {
  const sourceHash = await sha256File(sourcePath);
  let copyHash = '';
  try {
    await fs.access(dbPath);
    copyHash = await sha256File(dbPath);
  } catch {
    copyHash = '';
  }
  await fs.rm(`${dbPath}-wal`, { force: true });
  await fs.rm(`${dbPath}-shm`, { force: true });
  if (copyHash === sourceHash) return;
  await fs.copyFile(sourcePath, dbPath);
  await fs.chmod(dbPath, 0o600);
}

async function ensureModelLink(fs, path, embedModelPath, cacheFile) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
  const expected = path.resolve(embedModelPath);
  let current = '';
  try {
    current = path.resolve(await fs.readlink(cacheFile));
  } catch {
    current = '';
  }
  if (current === expected) return;
  await fs.rm(cacheFile, { force: true });
  await fs.symlink(expected, cacheFile);
}

export async function openQmdVectorRanker({
  indexSourcePath,
  embedModelPath,
  workRoot,
  qmdRoot,
  sourceId,
} = {}) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  if (!indexSourcePath || !embedModelPath) throw new Error('qmd index or embed model flag is not set');
  await fs.access(indexSourcePath);
  await fs.access(embedModelPath);
  await fs.mkdir(workRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(workRoot, 0o700);
  const dbPath = path.join(workRoot, 'qmd-index.sqlite');
  const started = performance.now();
  await ensureIndexCopy(fs, indexSourcePath, dbPath);
  const cacheHome = path.join(workRoot, 'cachehome');
  await ensureModelLink(fs, path, embedModelPath, path.join(cacheHome, 'qmd', 'models', SEALED_EMBED_CACHE_FILE));
  process.env.XDG_CACHE_HOME = cacheHome;
  process.env.QMD_EMBED_MODEL = SEALED_EMBED_MODEL;
  process.env.HF_HUB_OFFLINE = '1';
  const qmd = await import(pathToFileURL(path.join(qmdRoot, 'dist/index.js')).href);
  const store = await qmd.createStore({ dbPath });
  let status;
  try {
    status = await store.getStatus();
  } catch (error) {
    try { await store.close(); } catch { /* store may already be closed */ }
    throw error;
  }
  if (!status?.hasVectorIndex || Number(status.needsEmbedding) > 0) {
    try { await store.close(); } catch { /* store may already be closed */ }
    throw new Error('search index needs offline preparation');
  }
  const prepareMs = Math.round(performance.now() - started);
  const prefix = `${sourceId}:`;
  return {
    prepareMs,
    indexStatus: status,
    async rank(query, filteredRecords) {
      const allowed = new Set((filteredRecords ?? []).map((record) => record.id));
      const text = contentQuery(query) || String(query ?? '');
      const searchStarted = performance.now();
      const results = await store.searchVector(text, {
        limit: VECTOR_SEARCH_LIMIT,
        collection: 'hermes',
      });
      const searchMs = Math.round(performance.now() - searchStarted);
      const orderedIds = [];
      const scores = new Map();
      const cosines = new Map();
      for (const result of results ?? []) {
        const raw = result?.metadata?.hermes_record_id;
        if (typeof raw !== 'string' || !raw) continue;
        const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
        if (!allowed.has(id) || scores.has(id)) continue;
        const cosine = Number(result.score);
        const value = Number.isFinite(cosine) ? cosine : 0;
        scores.set(id, value);
        cosines.set(id, value);
        orderedIds.push(id);
      }
      return { ok: true, scores, cosines, orderedIds, searchMs };
    },
    async close() {
      await store.close();
    },
  };
}

export function catalogSourceId(catalog) {
  const entries = catalogEntries(catalog);
  if (entries.length !== 1) return null;
  return entries[0].id;
}
