import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCanonicalManifest, resolveQmdBestChunk } from './hermes-qmd-manifest-adapter.mjs';
import {nonconformityDefinition} from './hermes-source-definition.mjs';
import {
  digestRecords,
  SNAPSHOT_SCHEMA,
  SOURCE_KIND,
  SOURCE_TABLE,
  SCAW_STFUTEKIGO_DASHBOARD_ID,
} from './hermes-qmd-snapshot-export.mjs';

export const QMD_EMBED_MODEL_URI = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
export const QMD_REPO_COMMIT = '04e4dbd8245c527a88f1a8f0bda547aef9ca81fb';
export const QMD_SETTINGS = Object.freeze({
  retrieval: 'structuredLexVec',
  queryExpansion: false,
  rerank: false,
  candidateScope: 'full-authorized-snapshot',
});

const DEFAULT_STOP_WORDS = new Set([
  'が', 'は', 'を', 'に', 'へ', 'で', 'と', 'や', 'も', 'の', 'から', 'まで', 'より',
  'ね', 'よ', 'か', 'な', 'て', 'た', 'だ', 'です', 'ます', 'する', 'した', 'して',
  'ある', 'あり', 'います', 'あります', 'ますか', 'ですか', 'ください', '教えて',
  'について', '何', 'その', 'または', 'による', 'など', '探し', '探す', 'お願い',
  'できます', '記録', '確認', '知り', 'たい', 'あっ', 'ありま', '原因', '対策',
  '教え', 'くだ', 'さい',
  '再発防止', '再発防止策', '処置', '是正', '改善', '対応', '不具合', '作業',
  '方法', '手順', '質問', '対象', '関連', '事例',
]);

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function normalizeAuthorizedSnapshot(payload) {
  const root = asObject(payload, 'snapshot');
  if (root.schema !== SNAPSHOT_SCHEMA) throw new Error(`snapshot schema must be ${SNAPSHOT_SCHEMA}`);
  if (root.kind !== SOURCE_KIND) throw new Error(`snapshot kind must be ${SOURCE_KIND}`);
  if (root.status !== 'ready') throw new Error('snapshot status must be ready');
  if (!Array.isArray(root.records)) throw new Error('snapshot records must be an array');
  if (root.digestAlgorithm !== 'sha256' || typeof root.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(root.digest)) {
    throw new Error('snapshot must provide a full SHA-256 digest');
  }
  if (!Number.isSafeInteger(root.recordCount) || root.recordCount !== root.records.length) {
    throw new Error('snapshot recordCount does not match records length');
  }
  if (root.digest !== digestRecords(root.records)) throw new Error('snapshot digest does not match canonical records');
  if (!root.source || root.source.table !== SOURCE_TABLE || root.source.predicate !== 'isPresentInLatestSnapshot=true' || root.source.dashboardId !== SCAW_STFUTEKIGO_DASHBOARD_ID) {
    throw new Error('snapshot source metadata is not the expected active-latest Hermes source');
  }
  if (typeof root.runId !== 'string' || !root.runId || typeof root.watermark !== 'string' || !root.watermark) {
    throw new Error('snapshot runId and watermark are required');
  }
  if (!root.run || root.run.id !== root.runId || root.run.status !== 'COMPLETED' || root.run.csvDashboardId !== SCAW_STFUTEKIGO_DASHBOARD_ID || !root.run.completedAt) {
    throw new Error('snapshot run metadata is incomplete or out of scope');
  }
  if (root.run.sourceReceivedAt !== root.watermark) throw new Error('snapshot watermark does not match run sourceReceivedAt');
  if (Number.isSafeInteger(root.run.rowsProcessed) && root.recordCount > root.run.rowsProcessed) {
    throw new Error('snapshot recordCount exceeds completed run rowsProcessed');
  }
  if (!root.sourceRange || root.sourceRange.ingestRunId !== root.runId || root.sourceRange.watermark !== root.watermark) {
    throw new Error('snapshot sourceRange does not match the run marker');
  }
  if (!Array.isArray(root.tombstones)) throw new Error('snapshot tombstones must be an array');
  const seen = new Set();
  for (const record of root.records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('snapshot contains a non-object record');
    }
    if (record.kind !== SOURCE_KIND || typeof record.id !== 'string' || !record.id || record.evidenceKey !== `nonconformity:${record.id}`) throw new Error('snapshot record identity is invalid');
    if (!record.provenance || record.provenance.source !== SOURCE_TABLE || record.provenance.activeLatest !== true) throw new Error(`snapshot record ${record.id} provenance is not active-latest ${SOURCE_TABLE}`);
    if (seen.has(record.id)) throw new Error(`snapshot contains duplicate record ${record.id}`);
    seen.add(record.id);
  }
  if (!root.records.length) throw new Error('snapshot contains no active latest nonconformity records');
  return {
    records: root.records,
    skipped: [],
    count: root.recordCount,
    digest: root.digest,
    snapshotId: `${root.runId}@${root.watermark}`,
    scope: `full active-latest snapshot from ${SOURCE_TABLE}; dashboard ${root.source.dashboardId}`,
    sourceVersion: root.sourceRange.sourceVersionDate ?? null,
    authorized: true,
  };
}

function safeDocName(recordId) {
  return `${sha256Text(recordId).slice(0, 32)}.md`;
}

async function writeDocuments(directory, manifest) {
  await fs.mkdir(directory, { recursive: true });
  const expected = new Set();
  for (const entry of manifest) {
    const filename = safeDocName(entry.recordId);
    expected.add(filename);
    await fs.writeFile(path.join(directory, filename), entry.documentText, 'utf8');
  }
  const existing = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(existing
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !expected.has(entry.name))
    .map((entry) => fs.unlink(path.join(directory, entry.name))));
}

function termsForLexicalQuery(question) {
  const normalized = String(question ?? '').normalize('NFKC').replace(/[\r\n]+/gu, ' ');
  const words = typeof Intl?.Segmenter === 'function'
    ? [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(normalized)]
      .filter((entry) => entry.isWordLike)
      .map((entry) => entry.segment)
    : (normalized.match(/[一-龯ぁ-んァ-ヶA-Za-z0-9_.-]+/gu) ?? []);
  const result = [];
  for (const word of words) {
    const term = word.trim();
    // Avoid FTS5 punctuation grammar (e.g. decimal dimensions) in the
    // lexical lane. Identifiers are still handled by the deterministic number
    // path; the semantic lane always receives the complete natural question.
    if ((!/[\p{Script=Han}]/u.test(term) && [...term].length < 2) || /[^\p{L}\p{N}]/u.test(term) || DEFAULT_STOP_WORDS.has(term) || result.includes(term)) continue;
    result.push(term);

  }
  return result;
}

export function buildLexicalQuery(question) {
  const terms = termsForLexicalQuery(question);
  if (!terms.length) return null;
  // Quote each generic segment to keep punctuation and FTS operators in the
  // user's question from changing the BM25 query grammar.
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' ');
}

export function retrievalSubject(question) {
  const text = String(question ?? '').normalize('NFKC').trim();
  // Strip the request for an answer, never a word from the described event.
  const boundary = text.search(/(?:事例|について|原因と|対策を|再発防止策を|再発防止を)/u);
  return boundary > 0 ? text.slice(0, boundary).replace(/[、,\s]+$/u, '') : text;
}

export function buildLexicalQueries(question) {
  const query = buildLexicalQuery(retrievalSubject(question));
  return query ? [query] : [];
}

function resultTrace(result, lane) {
  const explain = result?.explain;
  return explain ? {
    laneType: lane?.type ?? null,
    laneQuery: lane?.query ?? null,
    ftsScores: explain.ftsScores ?? [],
    vectorScores: explain.vectorScores ?? [],
    rrf: explain.rrf ?? null,
    rerankScore: explain.rerankScore ?? 0,
    blendedScore: explain.blendedScore ?? result.score ?? null,
  } : null;
}

// Each future source must provide its own authorized snapshot and canonical
// field mapping. Supplying a profile alone never enables a new database.
export const NONCONFORMITY_QMD_ADAPTER=Object.freeze({
  definition:nonconformityDefinition,
  normalizeSnapshot:normalizeAuthorizedSnapshot,
  buildManifest:buildCanonicalManifest,
  resolveResult:resolveQmdBestChunk,
});

export class HermesQmdLocal {
  constructor({
    rootDirectory,
    dataDirectory,
    dbPath,
    embedModelPath,
    qmdRoot,
    sourceAdapter=NONCONFORMITY_QMD_ADAPTER,
    inference=null,
    allowIndexUpdate=true,
  }) {
    if(!sourceAdapter?.definition?.id || ['normalizeSnapshot','buildManifest','resolveResult'].some(name=>typeof sourceAdapter[name]!=='function')) {
      throw new Error('complete authorized source adapter is required');
    }
    this.sourceAdapter=sourceAdapter;
    this.inference=inference;
    this.allowIndexUpdate=allowIndexUpdate;
    this.rootDirectory = path.resolve(rootDirectory);
    this.dataDirectory = path.resolve(dataDirectory);
    this.docsDirectory = path.join(this.dataDirectory, 'docs');
    this.dbPath = path.resolve(dbPath);
    this.embedModelPath = inference ? inference.embedModelName : path.resolve(embedModelPath);
    this.qmdRoot = path.resolve(qmdRoot);
    this.store = null;
    this.snapshot = null;
    this.manifest = [];
    this.manifestByRecordId = new Map();
    this.recordsById = new Map();
    this.runtime = null;
  }

  async prepare(snapshotPayload) {
    const started = performance.now();
    this.snapshot = this.sourceAdapter.normalizeSnapshot(snapshotPayload);
    this.manifest = this.sourceAdapter.buildManifest(this.snapshot.records);
    this.manifestByRecordId = new Map(this.manifest.map((entry) => [entry.recordId, entry]));
    this.lexicalBodies = this.snapshot.records.map(record =>
      this.sourceAdapter.definition.lexicalFields
        .map(field => String(record[field] ?? '')).join('\n').normalize('NFKC').toLowerCase());
    this.recordsById = new Map(this.snapshot.records.map((record) => [record.evidenceKey, record]));
    await writeDocuments(this.docsDirectory, this.manifest);
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    // llm.ts reads XDG_CACHE_HOME at module import time.  Keep QMD's model
    // cache and SQLite index inside the trial workspace before importing it.
    const qmdCacheRoot = path.join(this.rootDirectory, 'work/cache');
    process.env.XDG_CACHE_HOME = qmdCacheRoot;
    process.env.QMD_EMBED_MODEL = this.embedModelPath;
    process.env.HF_HUB_OFFLINE = '1';
    process.env.TRANSFORMERS_OFFLINE = '1';

    const qmd = await import(pathToFileURL(path.join(this.qmdRoot, 'dist/index.js')).href);
    this.store = await qmd.createStore({
      dbPath: this.dbPath,
      config: {
        models: { embed: this.embedModelPath },
        collections: {
          hermes: { path: this.docsDirectory, pattern: '*.md', includeByDefault: true },
        },
      },
    });
    if (this.inference) {
      // QMD exposes its per-store dependency. Keep its FTS/vector/fusion code.
      const local = this.store.internal.llm;
      this.store.internal.llm = this.inference;
      await local.dispose();
    }
    const update = await this.store.update({ collections: ['hermes'] });
    let status = await this.store.getStatus();
    let embed = null;
    if (status.needsEmbedding > 0 || !status.hasVectorIndex) {
      if (!this.allowIndexUpdate) throw new Error('search index needs offline preparation');
      embed = await this.store.embed({
        model: this.embedModelPath,
        collection: 'hermes',
        maxDocsPerBatch: 8,
      });
      status = await this.store.getStatus();
    }
    this.runtime = {
      qmdRepoCommit: QMD_REPO_COMMIT,
      qmdRoot: this.qmdRoot,
      dbPath: this.dbPath,
      docsDirectory: this.docsDirectory,
      embedModelUri: this.embedModelPath,
      embedModelFamily: QMD_EMBED_MODEL_URI,
      snapshotId: this.snapshot.snapshotId,
      snapshotDigest: this.snapshot.digest,
      snapshotCount: this.snapshot.count,
      snapshotScope: this.snapshot.scope,
      snapshotAuthorizedFlag: this.snapshot.authorized,
      skippedSnapshotRecords: this.snapshot.skipped.length,
      indexStatus: status,
      update,
      embed,
      settings: QMD_SETTINGS,
      prepareMs: Math.round((performance.now() - started) * 10) / 10,
    };
    return this.runtime;
  }

  async search(question, { limit = 20 } = {}) {
    if (!this.store || !this.snapshot) throw new Error('QMD local runtime is not prepared');
    if (typeof question !== 'string' || !question.trim()) {
      return { status: 'clarification', lexicalQuery: null, semanticQuery: '', results: [], candidateIds: [] };
    }
    const terms = termsForLexicalQuery(retrievalSubject(question));
    // Corpus document frequency prioritizes discriminative literal terms.
    // This is data-derived query weighting, not a synonym/answer dictionary.
    const rankedTerms = terms.map(term => ({ term, count: this.lexicalBodies.reduce(
      (count, body) => count + Number(body.includes(term.toLowerCase())), 0,
    ) })).filter(item => item.count > 0).sort((a, b) => a.count - b.count);
    const lexicalQueries = rankedTerms.slice(0, 2).map(({ term }) => `"${term}"`);
    const lexicalQuery = lexicalQueries.length ? lexicalQueries.join(' OR ') : null;
    if (!terms.length) {
      return {
        status: 'clarification',
        lexicalQuery: null,
        semanticQuery: question.replace(/[\r\n]+/gu, ' ').trim(),
        results: [],
        candidateIds: [],
      };
    }
    const queries = [];
    for (const query of lexicalQueries) queries.push({ type: 'lex', query });
    queries.push({ type: 'vec', query: question.replace(/[\r\n]+/gu, ' ').trim() });
    const subject = retrievalSubject(question).replace(/[\r\n]+/gu, ' ').trim();
    if (subject !== question.trim()) queries.push({ type: 'vec', query: subject });
    const started = performance.now();
    // Let the pinned QMD implementation fuse lexical and semantic rankings.
    // The lexical lane keeps all content terms together; the vector lane sees
    // the complete question, including conditions and colloquial wording.
    const rawResults = await this.store.search({
      queries, collections: ['hermes'], limit, candidateLimit: limit,
      rerank: false, explain: true,
    });
    const resultsByRecordId = new Map();
    const rejected = [];
    for (const result of rawResults) {
      try {
        const resolved = this.sourceAdapter.resolveResult(this.manifest, result);
        const record = this.recordsById.get(resolved.recordId);
        if (!record) throw new Error('record is absent from normalized snapshot');
        const laneScore = Number(result.score);
        const candidate = {
          recordId: resolved.recordId,
          record,
          score: Number.isFinite(laneScore) ? laneScore : 0,
          file: result.file,
          docid: result.docid,
          bestChunk: resolved.bestChunk,
          bestChunkPos: result.bestChunkPos,
          intersectedFields: resolved.spans.map((span) => span.fieldId),
          trace: resultTrace(result, null) ? [resultTrace(result, null)] : [],
          laneHits: queries,
        };
        const existing = resultsByRecordId.get(resolved.recordId);
        if (!existing) {
          resultsByRecordId.set(resolved.recordId, candidate);
        }

      } catch (error) {
        rejected.push({ file: result?.file ?? null, reason: String(error?.message ?? error) });
      }
    }
    if (rejected.length > 0) {
      return {
        status: 'validation_error',
        lexicalQuery,
        semanticQuery: question.replace(/[\r\n]+/gu, ' ').trim(),
        queries,
        scope: this.snapshot.scope,
        snapshotId: this.snapshot.snapshotId,
        snapshotDigest: this.snapshot.digest,
        candidateIds: [],
        results: [],
        rejected,
        validationError: 'one or more QMD results failed manifest/source validation',
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    const results = [...resultsByRecordId.values()];
    return {
      status: results.length ? 'ok' : 'no_results',
      lexicalQuery,
      semanticQuery: question.replace(/[\r\n]+/gu, ' ').trim(),
      queries,
      scope: this.snapshot.scope,
      snapshotId: this.snapshot.snapshotId,
      snapshotDigest: this.snapshot.digest,
      candidateIds: results.map((result) => result.recordId),
      rankedCandidates: results.map((result, index) => ({
        rank: index + 1,
        recordId: result.recordId,
        score: result.score,
        intersectedFields: result.intersectedFields,
        trace: result.trace,
      })),
      results,
      rejected,
      elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    };
  }

  getRecord(recordId) {
    return this.recordsById.get(recordId) ?? null;
  }

  getManifestEntry(recordId) {
    return this.manifestByRecordId.get(recordId) ?? null;
  }

  async close() {
    if (this.store) await this.store.close();
    this.store = null;
  }
}
