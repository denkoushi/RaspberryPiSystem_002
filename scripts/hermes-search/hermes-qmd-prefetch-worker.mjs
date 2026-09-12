/*
 * Read-only Hermes search trial worker.
 *
 * Data flow: authorized snapshot -> local QMD structured lex/vec retrieval ->
 * reviewed source selection -> deterministic exact-text answer.
 * The device mode delegates model inference only; search and sources stay local.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { HermesQmdLocal, retrievalSubject } from './hermes-qmd-local.mjs';
import extractNumberedRecordAnswer from './hermes-answer-extract.mjs';
import {OrganizedRecords, projectOrganized} from './hermes-organized-records.mjs';
import {relevancePolicy} from './hermes-sources/nonconformity-answer.mjs';
import {quantityConstraint,fieldInputs} from './hermes-evidence-units.mjs';
import {nonconformityDefinition,nonconformityDefinitionDigest} from './hermes-source-definition.mjs';
import {RemoteInference} from './hermes-remote-inference.mjs';
import {prepareDeviceArtifact} from './hermes-device-artifact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.resolve(process.env.HERMES_UI_TRIAL_WORKSPACE ?? ROOT);
const SNAPSHOT_PATH = path.resolve(
  process.env.HERMES_TRIAL_SNAPSHOT_PATH
    ?? path.join(WORKSPACE, 'work/onecall-fiveq-input.json'),
);
const DATA_DIRECTORY = path.resolve(
  process.env.HERMES_TRIAL_DATA_DIR
    ?? (process.env.HERMES_SEARCH_ARTIFACT_ROOT ? path.join(path.dirname(process.env.HERMES_SEARCH_ARTIFACT_ROOT),'runtime',process.env.HOSTNAME ?? 'local') : null)
    ?? path.join(WORKSPACE, 'work/hermes-qmd-prefetch-trial'),
);
const QMD_ROOT = path.resolve(
  process.env.HERMES_QMD_ROOT ?? path.join(ROOT, 'work/vendor/qmd'),
);
const EMBED_MODEL_PATH = path.resolve(
  process.env.HERMES_QMD_EMBED_MODEL_PATH
    ?? path.join(ROOT, 'work/cache/qmd/models/hf_ggml-org_embeddinggemma-300M-Q8_0.gguf'),
);
const OPEN_PROVENCE_MODEL_DIR = path.resolve(
  process.env.HERMES_OPEN_PROVENCE_MODEL_DIR
    ?? path.join(ROOT, 'work/models/open-provence-reranker-xsmall-v1'),
);
const SELECTOR_ADAPTER_PATH = path.resolve(
  process.env.HERMES_SELECTOR_ADAPTER_PATH
    ?? path.join(ROOT, 'scratch/open_provence_selector_adapter.py'),
);
const PYTHON = path.resolve(
  process.env.HERMES_SELECTOR_PYTHON ?? process.env.HERMES_OPEN_PROVENCE_PYTHON
    ?? path.join(ROOT, 'work/open-provence-venv/bin/python'),
);
const SELECTOR_RUNNER = path.resolve(
  process.env.HERMES_SELECTOR_RUNNER
    ?? path.join(ROOT, 'scratch/hermes_open_provence_runner.py'),
);
const PREFIX = '__HERMES_UI_PREFETCH__';
const SELECTOR_PREFIX = '__HERMES_SELECTOR__';

const FIELD_ORDER = Object.keys(nonconformityDefinition.bodyFields);
const CONTEXT_ATTRIBUTE_ORDER = nonconformityDefinition.contextAttributes;
const FIELD_LABELS = nonconformityDefinition.bodyFields;

function emit(value) {
  process.stdout.write(PREFIX + JSON.stringify(value, (_key, current) => (
    typeof current === 'bigint' ? Number(current) : current
  )) + '\n');
  process.stdout.flush?.();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function loadSnapshot() {
  const text = await fs.readFile(SNAPSHOT_PATH, 'utf8');
  return JSON.parse(text);
}

function recordNumber(record) {
  const value = record?.[nonconformityDefinition.recordNumberField];
  return value == null ? '' : String(value).trim();
}

function normalizeNumber(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLocaleUpperCase('en-US').replace(/\s+/gu, '');
  if (!normalized) return '';
  return /^\d+$/u.test(normalized) ? normalized.replace(/^0+(?=\d)/u, '') : normalized;
}

function codePointOffsetToUtf16(text, codePointOffset) {
  return Array.from(text).slice(0, codePointOffset).join('').length;
}

function materializeOriginalSpans(span, context) {
  const contextCodePoints = Array.from(context.sourceText);
  if (span.offsetUnit !== 'unicode_code_points' || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || span.end > contextCodePoints.length) {
    throw new Error('selector returned invalid Unicode code-point span');
  }
  const selectedContextText = contextCodePoints.slice(span.start, span.end).join('');
  if (selectedContextText !== span.text) throw new Error('selector returned stale composite source text');
  const originalSpans = [];
  for (const segment of context.segments) {
    const start = Math.max(span.start, segment.contentStart);
    const end = Math.min(span.end, segment.contentEnd);
    if (start >= end) continue;
    const fieldCodePoints = Array.from(segment.sourceText);
    const fieldStart = start - segment.contentStart;
    const fieldEnd = end - segment.contentStart;
    const text = fieldCodePoints.slice(fieldStart, fieldEnd).join('');
    originalSpans.push({
      ...span,
      canonicalField: segment.canonicalField,
      sourceFields: [segment.canonicalField],
      pythonStart: fieldStart,
      pythonEnd: fieldEnd,
      pythonOffsetUnit: 'unicode_code_points',
      start: codePointOffsetToUtf16(segment.sourceText, fieldStart),
      end: codePointOffsetToUtf16(segment.sourceText, fieldEnd),
      offsetUnit: 'javascript_utf16_code_units',
      text,
      sourceHash: sha256(segment.sourceText),
    });
  }
  return originalSpans;
}

function sourceRecordInputs(results, fields = FIELD_ORDER) {
  const sourceRecords = [];
  const contextSegments = new Map();
  for (const result of results) {
    const record = result.record;
    let contextText = '';
    const segments = [];
    // Attributes participate in generic record-level relevance, while only
    // canonical body fields below are eligible for returned original spans.
    // This keeps part/machine constraints available to OpenProvence without
    // fabricating answer text from metadata.
    for (const attribute of CONTEXT_ATTRIBUTE_ORDER) {
      const value = record[attribute];
      if (value == null || !String(value).trim()) continue;
      contextText += `${attribute}: ${String(value)}\n`;
    }
    for (const canonicalField of fields) {
      const fieldText = typeof record[canonicalField] === 'string' ? record[canonicalField] : '';
      if (!fieldText.trim()) continue;
      const label = `${FIELD_LABELS[canonicalField] ?? canonicalField}: `;
      const contentStart = Array.from(contextText).length + Array.from(label).length;
      contextText += label + fieldText + '\n';
      const contentEnd = contentStart + Array.from(fieldText).length;
      segments.push({ canonicalField, contentStart, contentEnd, sourceText: fieldText });
    }
    if (!segments.length) continue;
    const key = result.recordId;
    contextSegments.set(key, { sourceText: contextText, segments });
    sourceRecords.push({
      recordId: result.recordId,
      canonicalField: 'recordContext',
      sourceFields: FIELD_ORDER,
      sourceText: contextText,
    });
  }
  return { sourceRecords, contextSegments };
}

function selectedSpanKey(span) {
  return `${span.recordId}\u0000${span.canonicalField}\u0000${span.start}\u0000${span.end}`;
}

function buildSelectedAnswer(question, results, spans) {
  const byId = new Map(results.map((result) => [result.recordId, result.record]));
  const grouped = new Map();
  for (const span of spans) {
    const list = grouped.get(span.recordId) ?? [];
    if (!list.some((existing) => selectedSpanKey(existing) === selectedSpanKey(span))) list.push(span);
    grouped.set(span.recordId, list);
  }
  const orderedRecordIds = results
    .map((result) => result.recordId)
    .filter((recordId, index, ids) => ids.indexOf(recordId) === index && grouped.has(recordId));
  const lines = [];
  for (const recordId of orderedRecordIds) {
    const record = byId.get(recordId);
    const number = recordNumber(record);
    lines.push(number ? `【不適合番号 ${number}】` : `【${recordId}】`);
    const recordSpans = grouped.get(recordId).sort((left, right) => {
      const fieldDelta = FIELD_ORDER.indexOf(left.canonicalField) - FIELD_ORDER.indexOf(right.canonicalField);
      return fieldDelta || left.start - right.start;
    });
    for (const span of recordSpans) lines.push(`${FIELD_LABELS[span.canonicalField] ?? span.canonicalField}: ${span.text}`);
    lines.push('');
  }
  return {
    answer: lines.join('\n').trim(),
    recordIds: orderedRecordIds,
    selectedSourceSpans: spans,
    question,
  };
}

export function projectRequestedFields(question, results) {
  const wantsMeasures = /対策|再発防止|是正|対応|確認|指示|教育|どう/u.test(question);
  const wantsDisposition = /処置|処理|手直し/u.test(question);
  const wantsCase = /事例|現象|不具合|原因|状況|経緯|工程|破損/u.test(question);
  const selected = [];
  const missing = new Map();
  for (const result of results) {
    const record = result.record;
    const fields = new Set();
    if (wantsCase || (!wantsMeasures && !wantsDisposition)) {
      fields.add('remarks');
      // Avoid repeating an identical cause already contained in the requested
      // corrective field, without altering either original field.
      if (!(wantsMeasures && record.condition && record.correctiveContent?.includes(record.condition))) fields.add('condition');
    }
    if (wantsMeasures) {
      fields.add('correctiveContent');
      if (!record.correctiveContent?.trim()) {
        missing.set(result.recordId, '個別是正内容は未記録です（未実施という意味ではありません）。');
        fields.add('disposition');
      }
    }
    if (wantsDisposition) fields.add('disposition');
    const seen = new Set();
    for (const field of FIELD_ORDER) {
      const text = record[field];
      if (!fields.has(field) || typeof text !== 'string' || !text.trim() || seen.has(text)) continue;
      seen.add(text);
      selected.push({recordId: result.recordId, canonicalField: field, sourceFields: [field],
        start: 0, end: text.length, offsetUnit: 'javascript_utf16_code_units',
        text, sourceHash: sha256(text)});
    }
  }
  const projected = buildSelectedAnswer(question, results, selected);
  for (const [recordId, message] of missing) {
    const record = results.find(result => result.recordId === recordId)?.record;
    const heading = `【不適合番号 ${recordNumber(record)}】`;
    projected.answer = projected.answer.replace(heading, `${heading}\n${message}`);
  }
  return projected;
}

function selectorRecordScores(value, count) {
  if (!Array.isArray(value)) return [];
  const candidate = Array.isArray(value[0]) ? value[0] : value;
  const scores = candidate.map((score) => Number(score));
  return scores.length === count && scores.every((score) => Number.isFinite(score)) ? scores : [];
}

function chooseRelevantRecords(results, selection, question) {
  const scores = selectorRecordScores(selection.rerankingScore, results.length);
  if (!scores.length) return { status: 'unavailable', results: [], reason: 'record relevance score was not returned' };
  const ranked = results.map((result, index) => ({ result, score: scores[index] }))
    .sort((left, right) => right.score - left.score);
  // Only limit display after all candidates have been reranked. A score is
  // an ordering signal; close scores do not mean an ambiguous question.
  const countMatch = question.normalize('NFKC').match(/([1-3])件/u);
  const displayLimit = countMatch ? Number(countMatch[1]) : /複数|いくつか/u.test(question) ? 3 : 1;
  const chosen = ranked.filter(entry => entry.score > 0).slice(0, displayLimit).map(entry => entry.result);
  return { status: chosen.length ? 'ok' : 'unavailable', results: chosen, scores };
}

function sourceSpansForDirectAnswer(direct, recordsByNumber) {
  const spans = [];
  for (const projection of direct.records ?? []) {
    const record = recordsByNumber.get(normalizeNumber(projection.recordNumber));
    if (!record) continue;
    for (const field of projection.selectedFields ?? []) {
      if (!field.present || typeof record[field.field] !== 'string') continue;
      const sourceText = record[field.field];
      spans.push({
        recordId: record.evidenceKey,
        canonicalField: field.field,
        sourceFields: [field.field],
        sentenceIndex: 0,
        start: 0,
        end: sourceText.length,
        offsetUnit: 'javascript_utf16_code_units',
        text: sourceText,
        probability: 1,
        sourceHash: sha256(sourceText),
      });
    }
  }
  return spans;
}

function directNumberRequest(question, records) {
  // The existing deterministic number route remains the fast path.  Its
  // returned record projection is still checked against the current snapshot.
  const probe = extractNumberedRecordAnswer({ question, records: [] });
  if (!probe.requestedRecordNumbers?.length) return null;
  const recordsByNumber = new Map(records.map((record) => [normalizeNumber(record.nonconformityNo), record]));
  // Pass the complete authorized snapshot through the existing extractor so
  // its established zero-padding normalization (8204 == 00008204) remains in
  // force and unmatched references are reported honestly.
  const direct = extractNumberedRecordAnswer({ question, records });
  return { probe, direct, recordsByNumber };
}

class SelectorClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.pending = new Map();
    this.startPromise = null;
    this.runtime = null;
  }

  async start() {
    if (this.runtime) return this.runtime;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const child = spawn(PYTHON, [SELECTOR_RUNNER], {
        cwd: ROOT,
        env: {
          ...process.env,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          HERMES_OPEN_PROVENCE_MODEL_DIR: OPEN_PROVENCE_MODEL_DIR,
          HERMES_SELECTOR_ADAPTER_PATH: SELECTOR_ADAPTER_PATH,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.stdout.on('data', (chunk) => this.consume(chunk.toString('utf8')));
      child.once('error', (error) => reject(error));
      child.once('close', (code, signal) => {
        if (!this.runtime) reject(new Error(`selector runner closed before ready (${code}, ${signal}): ${stderr.slice(-500)}`));
        for (const entry of this.pending.values()) entry.reject(new Error(`selector runner closed (${code}, ${signal})`));
        this.pending.clear();
        this.child = null;
      });
      this.startReject = reject;
      this.startResolve = resolve;
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/u);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith(SELECTOR_PREFIX)) continue;
      let row;
      try { row = JSON.parse(line.slice(SELECTOR_PREFIX.length)); } catch (error) {
        this.startReject?.(new Error(`selector emitted invalid protocol JSON: ${error.message}`));
        continue;
      }
      if (row.workerReady === true) {
        this.runtime = row.runtime;
        this.startResolve?.(this.runtime);
        continue;
      }
      const entry = this.pending.get(row.workerRequestId);
      if (!entry) continue;
      this.pending.delete(row.workerRequestId);
      if (row.workerError) entry.reject(new Error(row.detail ?? row.workerError));
      else entry.resolve(row);
    }
  }

  async select(question, sourceRecords, eventQuestion) {
    await this.start();
    const requestId = `selector-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.child.stdin.write(JSON.stringify({
        type: 'request',
        requestId,
        question,
        eventQuestion,
        threshold: 0.1,
        sourceRecords,
      }) + '\n');
    });
  }

  stop() {
    this.child?.stdin.end();
    this.child?.kill('SIGTERM');
    this.child = null;
  }
}

class TrialWorker {
  constructor() {
    this.qmd = null;
    this.remote = process.env.HERMES_INFERENCE_ORIGIN ? new RemoteInference({
      baseUrl:process.env.HERMES_INFERENCE_ORIGIN, token:process.env.HERMES_INFERENCE_TOKEN,
      embedModel:process.env.HERMES_QMD_INDEX_MODEL,
    }) : null;
    this.selector = this.remote ?? new SelectorClient();
    this.runtime = null;
  }

  async start() {
    if(process.env.HERMES_SEARCH_ARTIFACT_ROOT) {
      if(!this.remote)throw new Error('device trial requires remote inference');
      await prepareDeviceArtifact(process.env.HERMES_SEARCH_ARTIFACT_ROOT,DATA_DIRECTORY);
    }
    const snapshot = await loadSnapshot();
    if (!this.remote) {
      if (!(await fs.stat(EMBED_MODEL_PATH)).isFile()) throw new Error(`QMD embedding model is missing: ${EMBED_MODEL_PATH}`);
      if (!(await fs.stat(PYTHON)).isFile()) throw new Error(`OpenProvence Python runtime is missing: ${PYTHON}`);
    }
    this.qmd = new HermesQmdLocal({
      rootDirectory: this.remote ? DATA_DIRECTORY : ROOT,
      dataDirectory: DATA_DIRECTORY,
      dbPath: path.join(DATA_DIRECTORY, 'qmd-index.sqlite'),
      embedModelPath: EMBED_MODEL_PATH,
      qmdRoot: QMD_ROOT,
      inference:this.remote,
      allowIndexUpdate:!this.remote || process.env.HERMES_ALLOW_INDEX_UPDATE === 'true',
    });
    const qmdRuntime = await this.qmd.prepare(snapshot);
    const selectorRuntime = await this.selector.start();
    let organizedRuntime = null;
    if (process.env.HERMES_ORGANIZED_MANIFEST) {
      this.organized = new OrganizedRecords(this.qmd, path.resolve(process.env.HERMES_ORGANIZED_MANIFEST));
      organizedRuntime = await this.organized.prepare();
    }
    if (selectorRuntime.family === 'bge-reranker-v2-m3' && !this.organized) {
      throw new Error('BGE trial requires a reviewed original-span manifest');
    }
    // Initialize lazy embedding/vector kernels before announcing readiness.
    // Use an unrelated synthetic query, never an acceptance question/answer.
    const warmStarted=performance.now();
    if (!this.remote) await this.qmd.search('試験用の容器の色を確認する', {limit:1});
    const searchWarmupMs=Math.round((performance.now()-warmStarted)*10)/10;
    this.runtime = {
      protocol: 'hermes-ui-prefetch/v2',
      platform: process.platform,
      executionPlane: this.remote ? 'local-search-remote-inference' : 'Mac-local',
      piUsed: this.remote ? null : false,
      snapshot: {
        snapshotId: qmdRuntime.snapshotId,
        digest: qmdRuntime.snapshotDigest,
        count: qmdRuntime.snapshotCount,
        scope: qmdRuntime.snapshotScope,
        authorizedFlag: qmdRuntime.snapshotAuthorizedFlag,
      },
      qmd: {
        repoCommit: qmdRuntime.qmdRepoCommit,
        embedModelFamily: qmdRuntime.embedModelFamily,
        embedModelPath: qmdRuntime.embedModelUri,
        indexStatus: qmdRuntime.indexStatus,
        settings: qmdRuntime.settings,
        prepareMs: qmdRuntime.prepareMs,
        searchWarmupMs,
      },
      selector: selectorRuntime,
      sourceDefinition:{id:nonconformityDefinition.id,digest:nonconformityDefinitionDigest},
      relevancePolicy,
      organized: organizedRuntime,
    };
    return this.runtime;
  }

  async answer(question) {
    if (!this.qmd || !this.runtime) throw new Error('trial worker is not ready');
    const started = performance.now();
    const records = this.qmd.snapshot.records;
    const directRequest = directNumberRequest(question, records);
    if (directRequest) {
      const { direct, recordsByNumber } = directRequest;
      const spans = sourceSpansForDirectAnswer(direct, recordsByNumber);
      return {
        status: direct.status === 'ready' ? 'completed' : direct.status,
        mode: 'direct_number_lookup',
        answer: direct.answer,
        recordIds: direct.records?.map((item) => item.recordKey) ?? [],
        selectedSourceSpans: spans,
        qmd: { used: false, reason: 'preserved deterministic number lookup' },
        selector: { used: false, reason: 'preserved deterministic number lookup' },
        unsupportedRequests: direct.unsupportedRequests ?? [],
        snapshot: this.runtime.snapshot,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    if (typeof question !== 'string' || !question.trim()) {
      return {
        status: 'clarification',
        mode: 'clarification',
        answer: '質問内容を入力してください。',
        recordIds: [],
        selectedSourceSpans: [],
        qmd: { used: false },
        selector: { used: false },
        snapshot: this.runtime.snapshot,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    const qmd = await this.qmd.search(question, { limit: 20 });
    if (qmd.status !== 'ok') {
      if (qmd.status === 'clarification') {
        return {
          status: 'clarification',
          mode: 'clarification',
          answer: '検索対象を特定できる語がありませんでした。品番、不適合番号、対象工程、または不具合の具体的な特徴を入力してください。',
          recordIds: [],
          selectedSourceSpans: [],
          qmd: { ...qmd, results: undefined },
          selector: { used: false },
          snapshot: this.runtime.snapshot,
          elapsedMs: Math.round((performance.now() - started) * 10) / 10,
        };
      }
      return {
        status: qmd.status === 'no_results' ? 'completed' : 'unavailable',
        mode: qmd.status === 'no_results' ? 'bounded_no_result' : 'qmd_validation_error',
        answer: qmd.status === 'no_results'
          ? `この試用で読み込んだ承認済みの最新スナップショット（${this.runtime.snapshot.count}件）では、質問に対応する記録を確認できませんでした。読み込んでいない記録については判断していません。`
          : '検索結果の原文対応付けを検証できなかったため、回答を表示していません。',
        recordIds: [],
        selectedSourceSpans: [],
        qmd: { ...qmd, results: undefined },
        selector: { used: false },
        snapshot: this.runtime.snapshot,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    if (this.organized) {
      const candidates = await this.organized.retrieve(question, qmd.results);
      const selection = candidates.length ? await this.selector.select(question, candidates.map(row => ({
        recordId: row.recordId, canonicalField: 'organizedContext', sourceFields: FIELD_ORDER,
        sourceText: row.rankingText,
      }))) : {rerankingScore:[]};
      if (!Array.isArray(selection.rerankingScore) || selection.rerankingScore.length!==candidates.length) throw new Error('reranking record count mismatch');
      const scores=selection.scoreKind==='raw_relevance_logit'?selection.rerankingScore:selectorRecordScores(selection.rerankingScore,candidates.length);
      const constraints=quantityConstraint(question,candidates,this.organized.source.definition);
      const conditionSelections=[];
      let permitted=candidates.map((_row,index)=>index);
      let conditionFailure;
      if(constraints) {
        permitted=permitted.filter(index=>constraints.eligibleIds.includes(candidates[index].recordId));
        if(constraints.unsupported)conditionFailure='この試用では数値の範囲・大小条件を確実に照合できません。対象の記録を指定してください。';
        else if(!permitted.length)conditionFailure='整理済みの原文に指定された数値・単位を対応付けられませんでした。数値や単位を確認してください。未整理の記録まで存在しないと判断したものではありません。';
        else for(const clause of this.organized.source.nonNumericConditionQueries?.(question)??[]) {
          const ranked=await this.selector.select(clause,candidates.map(row=>({recordId:row.recordId,sourceText:row.rankingText})));
          if(!Array.isArray(ranked.rerankingScore)||ranked.rerankingScore.length!==candidates.length
            ||ranked.rerankingScore.some(score=>typeof score!=='number'||!Number.isFinite(score)))throw new Error('invalid condition ranking');
          const best=ranked.rerankingScore.reduce((best,score,index)=>score>ranked.rerankingScore[best]?index:best,0);
          conditionSelections.push({question:clause,recordId:candidates[best].recordId,elapsedMs:ranked.elapsedMs,
            scores:ranked.rerankingScore,agreementIsEntailmentProof:false});
          // Independent condition retrieval pointing outside the literal-value
          // matches is ambiguity, not permission to combine different records.
          if(!permitted.includes(best))conditionFailure='数値の条件と、現象の条件に対応する記録を同じ記録に絞れませんでした。数値と現象が同じ事例の条件か、確認してください。該当記録が存在しないと判断したものではありません。';
        }
      }
      const decision = conditionFailure?{rows:[],reason:conditionFailure}:this.organized.select(question,
        permitted.map(index=>candidates[index]),permitted.map(index=>scores[index]),{scoreKind:selection.scoreKind});
      const fieldSelection=[];
      const focusedQuestion=this.organized.source.semanticFieldQuery?.(question);
      if(focusedQuestion&&decision.rows.length) {
        const projectedRows=[];
        for(const row of decision.rows) {
          const inputs=fieldInputs(row,this.organized.source.definition);
          const ranked=await this.selector.select(focusedQuestion,inputs);
          if(!Array.isArray(ranked.rerankingScore)||ranked.rerankingScore.length!==inputs.length
            ||ranked.rerankingScore.some(score=>typeof score!=='number'||!Number.isFinite(score)))throw new Error('invalid field ranking');
          const best=ranked.rerankingScore.reduce((best,score,index)=>score>ranked.rerankingScore[best]?index:best,0);
          projectedRows.push({...row,requestedClasses:[inputs[best].class]});
          fieldSelection.push({recordId:row.recordId,question:focusedQuestion,selectedClass:inputs[best].class,
            scores:inputs.map((input,index)=>({class:input.class,score:ranked.rerankingScore[index]})),elapsedMs:ranked.elapsedMs});
        }
        decision.rows=projectedRows;
      }
      const projected = projectOrganized(question, decision.rows, this.qmd.recordsById);
      if (decision.insufficientCount) projected.answer += `\n\n希望された${decision.requestedCount}件を揃えられていません。残りの記録が存在しないという意味ではありません。`;
      return {
        status: projected.answer ? 'completed' : 'clarification', mode: 'offline_organized_original_answer',
        answer: projected.answer || decision.reason, recordIds: projected.recordIds, selectedSourceSpans: projected.selectedSourceSpans,
        qmd: {...qmd, results:undefined}, selector:{used:true, elapsedMs:selection.elapsedMs, rerankingScore:selection.rerankingScore,
          scoreKind:selection.scoreKind, chunks:selection.chunks,conditionSelections,fieldSelection},
        organized:{...this.runtime.organized,constraints, decision:{...decision,rows:undefined}, candidateIds:candidates.map(r=>r.recordId)},
        snapshot: this.runtime.snapshot, elapsedMs:Math.round((performance.now()-started)*10)/10,
      };
    }
    // Rerank every retrieved candidate before imposing a display limit.
    const relevantResults = qmd.results;
    const { sourceRecords, contextSegments } = sourceRecordInputs(relevantResults, ['condition', 'remarks']);
    if (!sourceRecords.length) {
      return {
        status: 'unavailable',
        mode: 'bounded_no_result',
        answer: '取得候補に表示可能な原文フィールドがありません。根拠のない内容は推測していません。',
        recordIds: relevantResults.map((result) => result.recordId),
        selectedSourceSpans: [],
        qmd: { ...qmd, results: undefined },
        selector: { used: false },
        snapshot: this.runtime.snapshot,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    let selection;
    try {
      selection = await this.selector.select(retrievalSubject(question), sourceRecords);
    } catch (error) {
      return {
        status: 'unavailable',
        mode: 'selector_unavailable',
        answer: '候補記録は取得できましたが、必要な原文箇所を確認できませんでした。内容は推測していません。',
        recordIds: relevantResults.map((result) => result.recordId),
        selectedSourceSpans: [],
        qmd: { ...qmd, results: undefined },
        selector: { used: true, error: String(error?.message ?? error) },
        snapshot: this.runtime.snapshot,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    const sourceByKey = new Map(sourceRecords.map((record) => [`${record.recordId}\u0000${record.canonicalField}`, record]));
    const spans = [];
    for (const span of selection.spans ?? []) {
      const source = sourceByKey.get(`${span.recordId}\u0000${span.canonicalField}`);
      if (!source) throw new Error('selector returned an unlisted source identity');
      if (span.sourceHash !== sha256(source.sourceText)) throw new Error('selector composite source hash mismatch');
      spans.push(...materializeOriginalSpans(span, contextSegments.get(span.recordId)));
    }
    const recordSelection = chooseRelevantRecords(relevantResults, selection, question);
    if (recordSelection.status !== 'ok') {
      return {
        status: 'unavailable',
        mode: recordSelection.status === 'ambiguous' ? 'record_relevance_ambiguous' : 'record_relevance_unavailable',
        answer: recordSelection.status === 'ambiguous'
          ? '質問に対応する記録を一つに絞り込めなかったため、回答を表示していません。番号や品番など対象を指定してください。'
          : '質問に対応する記録の関連度を確認できなかったため、回答を表示していません。',
        recordIds: [],
        selectedSourceSpans: [],
        qmd: { ...qmd, results: undefined },
        selector: {
          used: true,
          selectedCount: selection.selectedCount,
          sourceCount: selection.sourceCount,
          elapsedMs: selection.elapsedMs,
          offsetUnit: selection.offsetUnit,
          rerankingScore: selection.rerankingScore ?? null,
          recordRelevance: recordSelection,
        },
        snapshot: this.runtime.snapshot,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      };
    }
    const projected = projectRequestedFields(question, recordSelection.results);
    return {
      status: projected.answer ? 'completed' : 'unavailable',
      mode: projected.answer ? 'qmd_lex_vec_open_provence' : 'selector_no_selection',
      answer: projected.answer || '候補記録から質問に対応する原文箇所を確認できませんでした。内容は推測していません。',
      recordIds: projected.recordIds,
      selectedSourceSpans: projected.selectedSourceSpans,
      qmd: { ...qmd, results: undefined },
      selector: {
        used: true,
        selectedCount: selection.selectedCount,
        sourceCount: selection.sourceCount,
        elapsedMs: selection.elapsedMs,
        offsetUnit: selection.offsetUnit,
        rerankingScore: selection.rerankingScore ?? null,
      },
      snapshot: this.runtime.snapshot,
      elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    };
  }

  async stop() {
    this.selector.stop();
    await this.qmd?.close();
  }
}

async function main() {
  const worker = new TrialWorker();
  try {
    const runtime = await worker.start();
    emit({ workerReady: true, runtime });
  } catch (error) {
    emit({ workerError: 'trial worker startup failed', detail: String(error?.stack ?? error) });
    process.exitCode = 1;
    return;
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let request = null;
    try {
      request = JSON.parse(line);
      if (request.type === 'cancel') continue;
      if (request.type !== 'request' || typeof request.requestId !== 'string' || typeof request.question !== 'string') throw new Error('request type, requestId, and question are required');
      const result = await worker.answer(request.question);
      emit({ workerRequestId: request.requestId, stage: 'completed', result, elapsedMs: result.elapsedMs });
    } catch (error) {
      emit({
        workerRequestId: request && typeof request.requestId === 'string' ? request.requestId : null,
        workerError: 'trial worker request failed',
        detail: String(error?.message ?? error),
      });
    }
  }
  await worker.stop();
}

if (process.argv.includes('--hermes-ui-prefetch-worker') || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    emit({ workerError: 'trial worker fatal error', detail: String(error?.stack ?? error) });
    process.exitCode = 1;
  });
}

export { TrialWorker, buildSelectedAnswer, directNumberRequest, sourceSpansForDirectAnswer };
