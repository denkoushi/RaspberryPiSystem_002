import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { createTypesafeDirectEvaluate } from './hermes-jev-record-pilot.mjs';

export const CLASSIFIER_SCHEMA = 'hermes-jev-record-classification/v1';
export const CLASSIFIER_DEFINITION_VERSION = 2;

const GROUPS = Object.freeze([
  {
    id: 'process', cardinality: 'single', label: '工程', options: [
      ['turning', '旋盤加工'], ['milling', 'フライス加工'], ['grinding', '研削加工'],
      ['inspection', '検査工程'], ['assembly', '組立工程'], ['other_recorded', '本文に記載されたその他の工程'],
      ['unknown', '本文から工程を特定できない']
    ]
  },
  {
    id: 'phenomenon', cardinality: 'multiple', label: '現象', options: [
      ['oversize', '寸法・形状が規格または上限を超えている'], ['undersize', '寸法・形状が規格または下限を下回っている'],
      ['position_error', '位置・ピッチ・ずれの不適合'], ['surface_damage', '傷・打痕・へこみなどの表面損傷'],
      ['missing_marking', '刻印・表示・識別情報の欠落'], ['crack_or_breakage', '割れ・破損・欠け'],
      ['other_recorded', '本文に記載されたその他の現象']
    ]
  },
  {
    id: 'treatment', cardinality: 'multiple', label: '処置・対応', options: [
      ['rework', '再加工・手直しを実施'], ['segregate', '選別・隔離を実施'],
      ['repair_or_replace', '修理・交換・再製作を実施'], ['inspection_or_confirmation', '検査・確認・精度調整を実施'],
      ['design_consultation', '設計・技術部門へ確認または相談'], ['other_recorded', '本文に記載されたその他の処置・対応']
    ]
  },
  {
    id: 'cause', cardinality: 'multiple', label: '原因', options: [
      ['tool_wear', '工具・刃具の摩耗または状態'], ['equipment_failure', '設備・機械の不具合'],
      ['confirmation_insufficient', '確認・測定・作業手順の不足'], ['material_or_part', '材料・部品・支給品の状態'],
      ['other_recorded', '本文に記載されたその他の原因']
    ]
  },
  {
    id: 'impact', cardinality: 'multiple', label: '影響・対象', options: [
      ['dimension', '寸法・公差への影響'], ['appearance', '外観・表面状態への影響'],
      ['function', '機能・性能への影響'], ['identification', '刻印・表示・識別への影響'],
      ['other_recorded', '本文に記載されたその他の影響']
    ]
  },
  {
    id: 'cause_status', cardinality: 'single', label: '原因の記録状態', options: [
      ['cause_recorded', '原因が本文に明記されている'], ['cause_not_recorded', '原因が本文に記載されていない'],
      ['unknown', '本文から原因の記録状態を確定できない']
    ]
  },
  {
    id: 'treatment_status', cardinality: 'single', label: '処置の記録状態', options: [
      ['treatment_recorded', '処置または対応が本文に明記されている'], ['treatment_not_recorded', '処置または対応が本文に記載されていない'],
      ['unknown', '本文から処置の記録状態を確定できない']
    ]
  }
]);

const STOP_WORDS = new Set(['について', '確認', 'したい', '探して', '検索', '記録', '不適合', '最近', '最新', '直近', '原文', '内容', '発生', '発生日', '教えて', 'ください', '除く', '除外', '以外', 'の', 'を', 'が', 'は', 'で', 'に', 'へ', 'と', 'や', 'も']);
const OBSERVED_TOPIC_EXCLUDED_FIELDS = new Set([
  'id', 'kind', 'nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentCode',
  'originDepartmentName', 'originDepartmentMeaning', 'evidenceKey', 'discoveredOn', 'sourceVersionDate',
  'sourceUpdatedOn', 'lastEvaluatedIngestRunId', 'lastSnapshotReceivedAt', 'provenance', 'rawText', 'sourceContentSha256'
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return null;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function rawText(record) {
  const fields = [
    ['不適合番号', record.nonconformityNo], ['品番', record.partNumber], ['品名', record.partName],
    ['機械名', record.machineName], ['起因部署', record.originDepartmentName], ['発見日', record.discoveredOn],
    ['不適合内容', record.condition], ['備考', record.remarks], ['個別是正内容', record.correctiveContent], ['処置内容', record.disposition]
  ];
  return fields.filter(([, value]) => text(value)).map(([label, value]) => `${label}: ${text(value)}`).join('\n');
}

function sourceRecord(record) {
  if (!isObject(record) || typeof record.id !== 'string' || !record.id) throw new Error('invalid nonconformity source record');
  return {
    ...record,
    rawText: text(record.rawText) || rawText(record),
    sourceContentSha256: sha256(canonicalJson(record))
  };
}

function groupOptions(group, mode) {
  const prefix = mode === 'record' ? '本文' : '検索質問';
  const options = group.options.map((option) => Array.isArray(option) ? { id: option[0], description: option[1] } : option);
  if (group.cardinality === 'single') {
    return {
      type: 'choice',
      instructions: `${prefix}に記載された${group.label}を一つ選ぶ。記載がなければ unknown を選び、記載のない原因・処置・工程を補わない。`,
      criteria: Object.fromEntries(options.map((option) => [option.id, option.description]))
    };
  }
  return null;
}

function buildQuestions(definition, mode) {
  const questions = {};
  for (const group of definition.groups) {
    const options = group.options.map((option) => Array.isArray(option) ? { id: option[0], description: option[1] } : option);
    const single = groupOptions(group, mode);
    if (single) questions[group.id] = single;
    else for (const { id, description } of options) {
      questions[`${group.id}:${id}`] = {
        type: 'choice',
        instructions: `${mode === 'record' ? '本文' : '検索質問'}に、${group.label}として「${description}」が明記または明確に示されているか判定する。記載がない場合は absent。推測で present にしない。`,
        criteria: { present: '本文または質問に該当する内容がある', absent: '該当する内容がない、または判断できない' }
      };
    }
  }
  return questions;
}

function choice(answer) {
  return isObject(answer) && answer.type === 'choice' && typeof answer.choice === 'string' ? answer.choice : null;
}

function classificationFromAnswers(answers, definition) {
  if (!isObject(answers)) throw new Error('JEV response has no answers');
  const classification = {};
  for (const group of definition.groups) {
    const options = group.options.map((option) => Array.isArray(option) ? { id: option[0], description: option[1] } : option);
    if (group.cardinality === 'single') {
      const value = choice(answers[group.id]);
      if (!options.some((option) => option.id === value)) throw new Error(`JEV returned unsupported ${group.id}`);
      classification[group.id] = value;
      continue;
    }
    const selected = options.filter((option) => choice(answers[`${group.id}:${option.id}`]) === 'present').map((option) => option.id);
    classification[group.id] = selected;
  }
  return classification;
}

function observedFields(records) {
  const fields = new Set();
  for (const record of records) for (const [key, value] of Object.entries(record)) {
    if (['rawText', 'sourceContentSha256'].includes(key)) continue;
    if (text(value)) fields.add(key);
  }
  return [...fields].sort();
}

function observedTopicOptions(records) {
  const counts = new Map();
  const labels = new Set(['不適合番号', '品番', '品名', '機械名', '起因部署', '発見日', '不適合内容', '備考', '個別是正内容', '処置内容']);
  const segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
  for (const record of records) {
    const values = Object.entries(record)
      .filter(([key]) => !OBSERVED_TOPIC_EXCLUDED_FIELDS.has(key))
      .map(([, value]) => text(value)).filter(Boolean);
    const terms = new Set();
    for (const value of values) {
      const normalized = value.normalize('NFKC').replace(/[「」『』【】（）()［］[\]、。！？!?：:;,，．\n]/g, ' ');
      if (segmenter) {
        let run = '';
        const flush = () => {
          const candidate = run.trim();
          if (Array.from(candidate).length >= 2 && !STOP_WORDS.has(candidate) && !labels.has(candidate)) terms.add(candidate);
          run = '';
        };
        for (const segment of segmenter.segment(normalized)) {
          if (!segment.isWordLike) { flush(); continue; }
          run += segment.segment;
          const token = segment.segment.trim();
          if (token.length >= 2 && !STOP_WORDS.has(token) && !labels.has(token)) terms.add(token);
        }
        flush();
      } else {
        for (const candidate of normalized.split(/\s+/u)) if (Array.from(candidate).length >= 2 && !STOP_WORDS.has(candidate)) terms.add(candidate);
      }
    }
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .slice(0, 32)
    .map(([term, count], index) => ({ id: `topic_${index + 1}`, description: `実データ本文に現れる検索テーマ「${term}」（${count}件）`, observedTerm: term }));
}

export function buildClassificationDefinition(records, previousDefinition = null) {
  const normalized = records.map(sourceRecord);
  const observedTopics = mergeObservedTopicOptions(observedTopicOptions(normalized), previousDefinition?.groups
    ?.find((group) => group.id === 'observed_topic')?.options);
  return {
    schema: 'hermes-classification-definition/v1',
    version: CLASSIFIER_DEFINITION_VERSION,
    groups: [
      ...GROUPS.map((group) => ({ id: group.id, label: group.label, cardinality: group.cardinality, options: group.options.map(([id, description]) => ({ id, description })) })),
      { id: 'observed_topic', label: '実データに現れる検索テーマ', cardinality: 'multiple', options: observedTopics }
    ],
    exactFields: ['nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentCode', 'originDepartmentName', 'discoveredOn'],
    observedFields: observedFields(normalized),
    source: 'active ScawStfutekigoCurrent records',
    draftPolicy: 'semantic groups are reviewed against observed fields; exact identifiers and dates remain code-owned',
  };
}

function mergeObservedTopicOptions(currentOptions, previousOptions = []) {
  const currentByTerm = new Map(currentOptions.map((option) => [option.observedTerm, option]));
  const merged = [];
  const seen = new Set();
  for (const previous of Array.isArray(previousOptions) ? previousOptions : []) {
    if (!isObject(previous) || typeof previous.observedTerm !== 'string' || seen.has(previous.observedTerm)) continue;
    const current = currentByTerm.get(previous.observedTerm);
    merged.push({ ...(current ?? previous), id: previous.id });
    seen.add(previous.observedTerm);
  }
  let nextId = merged.reduce((maximum, option) => {
    const number = /^topic_(\d+)$/.exec(option.id ?? '')?.[1];
    return Math.max(maximum, number ? Number(number) : 0);
  }, 0) + 1;
  for (const current of currentOptions) {
    if (seen.has(current.observedTerm)) continue;
    merged.push({ ...current, id: `topic_${nextId}` });
    nextId += 1;
  }
  return merged;
}

export function definitionHash(definition) {
  return sha256(canonicalJson(definition));
}

function normalizeSnapshot(snapshot) {
  if (!isObject(snapshot) || !Array.isArray(snapshot.records) || snapshot.records.length === 0) throw new Error('active nonconformity snapshot is missing or empty');
  return snapshot.records.map((record) => sourceRecord(record));
}

async function readSnapshot(snapshotPath) {
  return normalizeSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')));
}

async function readStore(storePath) {
  try {
    const value = JSON.parse(await readFile(storePath, 'utf8'));
    return isObject(value) && value.schema === CLASSIFIER_SCHEMA && Array.isArray(value.records) && Array.isArray(value.classifications) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeStore(storePath, value) {
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporary = `${storePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, storePath);
}

function reusableClassification(value, savedDefinition, definition) {
  if (!isObject(value) || !isObject(savedDefinition) || savedDefinition.version !== definition.version) return null;
  const savedGroups = new Map(Array.isArray(savedDefinition.groups) ? savedDefinition.groups.map((group) => [group.id, group]) : []);
  for (const group of definition.groups) {
    const savedGroup = savedGroups.get(group.id);
    if (group.id !== 'observed_topic' && canonicalJson(savedGroup) !== canonicalJson(group)) return null;
    if (group.id === 'observed_topic') {
      if (!isObject(savedGroup) || savedGroup.cardinality !== group.cardinality) return null;
      const savedOptionIds = new Set((savedGroup.options ?? []).map((option) => option?.id).filter(Boolean));
      const currentOptionIds = new Set((group.options ?? []).map((option) => option?.id).filter(Boolean));
      // A new observed topic changes the meaning of an existing row's
      // multi-tag result. Treat that row as pending instead of silently
      // reusing a classification that cannot answer the new topic.
      if ([...currentOptionIds].some((id) => !savedOptionIds.has(id))) return null;
    }
  }
  const normalized = {};
  for (const group of definition.groups) {
    const candidate = value[group.id];
    const allowed = new Set(group.options.map((option) => option.id));
    if (group.cardinality === 'single') {
      if (!allowed.has(candidate)) return null;
      normalized[group.id] = candidate;
    } else {
      if (!Array.isArray(candidate) || candidate.some((item) => !allowed.has(item))) return null;
      normalized[group.id] = candidate;
    }
  }
  return normalized;
}

function questionTerms(question) {
  const normalized = question.normalize('NFKC').replace(/[「」『』【】（）()［］[\]、。！？!?：:;,，．]/g, ' ');
  const words = new Set();
  const add = (value) => {
    const item = value.trim();
    if (Array.from(item).length >= 2 && !STOP_WORDS.has(item)) words.add(item);
  };
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    for (const segment of segmenter.segment(normalized)) if (segment.isWordLike) add(segment.segment);
  }
  for (const identifier of normalized.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) ?? []) add(identifier);
  return [...words].sort((left, right) => right.length - left.length).slice(0, 16);
}

function firstMatch(question, records, field) {
  const candidates = [...new Set(records.map((record) => text(record[field])).filter(Boolean))].sort((left, right) => right.length - left.length);
  return candidates.find((value) => question.includes(value)) ?? null;
}

export function extractStructuredConditions(question, records) {
  const result = {};
  const exclude = {};
  const normalized = question.normalize('NFKC');
  const numbers = normalized.match(/(?:不適合|記録|番号)?\s*([0-9０-９]{4,})(?!\s*年)/u)?.[1];
  if (numbers) result.nonconformityNo = numbers.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  for (const field of ['partNumber', 'partName', 'machineName', 'originDepartmentCode', 'originDepartmentName']) {
    const match = firstMatch(normalized, records, field);
    if (match) {
      if (new RegExp(`${match}(?:を|は)?(?:除く|除外|以外)`).test(normalized)) exclude[field] = match;
      else result[field] = match;
    }
  }
  const date = normalized.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/u);
  if (date) result.discoveredOn = `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}`;
  return { include: result, exclude };
}

function displayOnlyRequest(question, conditions = {}) {
  return Object.keys(conditions).length === 0
    && /発生日|発見日|日付|いつ|年月日/.test(question)
    && !/どの記録|どの不適合|番号|品番|工程|現象|原因|処置|部署|機械/.test(question);
}

function hasRecentRequest(question) {
  return /最近|最新|直近/.test(question);
}

export function resolvedConditionCount(question, classification, conditions, exclude = {}) {
  const semantic = Object.entries(classification).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value && value !== 'unknown');
  return semantic.length + Object.keys(conditions).length + Object.keys(exclude).length + (questionTerms(question).length > 0 && !displayOnlyRequest(question, conditions) ? 1 : 0);
}

function matchesClassification(saved, query) {
  for (const group of query.groups) {
    const value = query.classification[group.id];
    if (group.cardinality === 'single') {
      if (value !== 'unknown' && saved[group.id] !== value) return false;
    } else if (Array.isArray(value) && value.length && !value.every((item) => saved[group.id]?.includes(item))) return false;
  }
  return true;
}

function matchesConditions(record, conditions) {
  return Object.entries(conditions).every(([field, expected]) => {
    const actual = field === 'nonconformityNo' ? text(record.nonconformityNo).replace(/^0+(?=\d)/, '') : text(record[field]);
    const wanted = field === 'nonconformityNo' ? String(expected).replace(/^0+(?=\d)/, '') : String(expected);
    return actual === wanted;
  });
}

function lexicalMatch(record, terms) {
  if (terms.length === 0) return true;
  const haystack = Object.values(record).filter((value) => typeof value === 'string').join('\n').normalize('NFKC');
  return terms.some((term) => haystack.includes(term));
}

function limitFromQuestion(question) {
  const match = question.normalize('NFKC').match(/([1-9][0-9]*)\s*件/u);
  return Math.min(20, match ? Number(match[1]) : 20);
}

export function searchStored(store, query) {
  const matches = store.records.filter((record) => store.classificationsById.has(record.id)
    && matchesClassification(store.classificationsById.get(record.id) ?? {}, query)
    && matchesConditions(record, query.conditions)
    && (Object.keys(query.exclude).length === 0 || !matchesConditions(record, query.exclude))
    && lexicalMatch(record, query.lexicalTerms));
  const ordered = hasRecentRequest(query.question)
    ? [...matches].sort((left, right) => String(right.discoveredOn ?? '').localeCompare(String(left.discoveredOn ?? '')))
    : matches;
  return ordered.slice(0, query.limit);
}

function queryConversationState(question, conversation = {}) {
  const safeConversation = isObject(conversation) ? conversation : {};
  const dialogue = Array.isArray(safeConversation.relatedHistory)
    ? safeConversation.relatedHistory.filter((item) => isObject(item) && typeof item.role === 'string' && typeof item.content === 'string').slice(-8)
    : [];
  const previousRequest = typeof safeConversation.searchRequest === 'string' && safeConversation.searchRequest.trim() && safeConversation.searchRequest !== question
    ? [{ role: 'user', content: safeConversation.searchRequest }]
    : [];
  return {
    request: question,
    relatedHistory: [...previousRequest, ...dialogue],
    confirmationPending: safeConversation.confirmationPending ?? safeConversation.pending ?? null,
  };
}

async function classifyText(question, definition, evaluate, mode, conversation = {}) {
  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state: mode === 'query' ? queryConversationState(question, conversation) : { request: question, relatedHistory: [], confirmationPending: null },
    questions: buildQuestions(definition, mode),
    maxRetries: 0
  });
  return { classification: classificationFromAnswers(result?.answers, definition), response: result?.response ?? null, usage: result?.usage ?? null };
}

export class AuthorizedRecordClassifier {
  constructor({ snapshotPath, storePath, evaluateImplementation = createTypesafeDirectEvaluate() } = {}) {
    this.snapshotPath = snapshotPath;
    this.storePath = storePath;
    this.evaluateImplementation = evaluateImplementation;
    this.definition = null;
    this.store = null;
    this.runtime = null;
    this.calls = [];
    this.pendingRecordIds = new Set();
    this.classificationPromise = null;
    this.closed = false;
  }

  async persistStore() {
    const classifications = this.store.records
      .map((record) => {
        const classification = this.store.classificationsById.get(record.id);
        return classification ? { id: record.id, classification } : null;
      })
      .filter(Boolean);
    this.store.classifications = classifications;
    await writeStore(this.storePath, {
      schema: CLASSIFIER_SCHEMA,
      definitionSha256: this.store.definitionSha256,
      definition: this.definition,
      source: this.store.source,
      records: this.store.records,
      classifications,
      pendingRecordIds: [...this.pendingRecordIds],
    });
  }

  async classifyPending(records, { continueOnError = false } = {}) {
    for (const record of records) {
      if (this.closed) return;
      const started = performance.now();
      try {
        const evaluated = await classifyText(record.rawText, this.definition, this.evaluateImplementation, 'record');
        this.calls.push({ phase: 'record', recordIdSha256: sha256(record.id), requestSha256: sha256(record.rawText), questionCount: Object.keys(buildQuestions(this.definition, 'record')).length, elapsedMs: Number((performance.now() - started).toFixed(3)) });
        this.store.classificationsById.set(record.id, evaluated.classification);
        this.pendingRecordIds.delete(record.id);
        this.runtime.classifiedRecordCount += 1;
        this.runtime.pendingRecordCount = this.pendingRecordIds.size;
        await this.persistStore();
      } catch (error) {
        this.runtime.classificationFailureCount += 1;
        this.runtime.pendingRecordCount = this.pendingRecordIds.size;
        this.runtime.classificationStatus = 'partial';
        if (!continueOnError) throw error;
      }
    }
    this.runtime.pendingRecordCount = this.pendingRecordIds.size;
    this.runtime.classificationStatus = this.pendingRecordIds.size === 0 ? 'complete' : 'partial';
  }

  async prepare({ background = false } = {}) {
    if (!this.snapshotPath || !this.storePath) throw new Error('record classification source and store are required');
    if (this.runtime) return this.runtime;
    const records = await readSnapshot(this.snapshotPath);
    const saved = await readStore(this.storePath);
    this.definition = buildClassificationDefinition(records, saved?.definition);
    const definitionSha256 = definitionHash(this.definition);
    const savedRecords = new Map((saved?.records ?? []).map((record) => [record.id, record]));
    const savedClassifications = new Map((saved?.classifications ?? []).map((classification) => [classification.id, classification]));
    const classificationsById = new Map();
    const pendingRecords = [];
    let reusedRecordCount = 0;
    for (const record of records) {
      const previous = savedRecords.get(record.id);
      const previousClassification = savedClassifications.get(record.id)?.classification;
      const reusable = reusableClassification(previousClassification, saved?.definition, this.definition);
      if (previous?.sourceContentSha256 === record.sourceContentSha256 && reusable) {
        classificationsById.set(record.id, reusable);
        reusedRecordCount += 1;
        continue;
      }
      pendingRecords.push(record);
    }
    this.pendingRecordIds = new Set(pendingRecords.map((record) => record.id));
    this.store = {
      schema: CLASSIFIER_SCHEMA,
      definitionSha256,
      source: { snapshotDigest: sha256(canonicalJson(records)), recordCount: records.length },
      records,
      classifications: [],
      classificationsById,
    };
    this.runtime = {
      definitionVersion: CLASSIFIER_DEFINITION_VERSION,
      definitionSha256,
      recordCount: records.length,
      reusedRecordCount,
      classifiedRecordCount: 0,
      pendingRecordCount: pendingRecords.length,
      classificationFailureCount: 0,
      classificationStatus: pendingRecords.length === 0 ? 'complete' : 'running',
      classificationCalls: this.calls.filter((call) => call.phase === 'record').length,
      source: 'authorized latest nonconformity snapshot'
    };
    await this.persistStore();
    if (background) {
      this.classificationPromise = this.classifyPending(pendingRecords, { continueOnError: true }).catch(() => {
        this.runtime.classificationStatus = 'partial';
      });
    } else {
      await this.classifyPending(pendingRecords);
    }
    return this.runtime;
  }

  coverage() {
    const total = this.store?.records.length ?? 0;
    const classified = this.store?.classificationsById.size ?? 0;
    return { total, classified, pending: Math.max(0, total - classified), complete: total > 0 && classified === total };
  }

  coverageNotice(coverage) {
    if (coverage.complete) return '';
    return `分類処理中のため、現在は分類済み ${coverage.classified}/${coverage.total} 件だけが検索対象です。未分類の記録は結果に含まれていません。`;
  }

  sessionFor(question, conversation, pending) {
    const safeConversation = isObject(conversation) ? conversation : {};
    return {
      pending: pending ?? null,
      searchRequest: typeof safeConversation.searchRequest === 'string' ? safeConversation.searchRequest : question,
      jevDialogue: Array.isArray(safeConversation.relatedHistory)
        ? safeConversation.relatedHistory.filter((item) => isObject(item) && item.role === 'assistant' && typeof item.content === 'string').slice(-8)
        : [],
    };
  }

  async answer(question, conversation = {}) {
    if (!this.store || !this.definition) throw new Error('record classifier is not ready');
    const started = performance.now();
    const pending = isObject(conversation) ? (conversation.confirmationPending ?? conversation.pending ?? null) : null;
    const evaluated = await classifyText(question, this.definition, async (input) => {
      const callStarted = performance.now();
      const result = await this.evaluateImplementation(input);
      this.calls.push({ phase: 'query', requestSha256: sha256(question), questionCount: Object.keys(input.questions).length, elapsedMs: Number((performance.now() - callStarted).toFixed(3)) });
      return result;
    }, 'query', conversation);
    const coverage = this.coverage();
    const coverageNotice = this.coverageNotice(coverage);
    const structured = extractStructuredConditions(question, this.store.records);
    const query = {
      question,
      classification: evaluated.classification,
      groups: this.definition.groups,
      conditions: structured.include,
      exclude: structured.exclude,
      lexicalTerms: questionTerms(question).filter((term) => ![...Object.values(structured.include), ...Object.values(structured.exclude)]
        .some((value) => String(value).includes(term))),
      limit: limitFromQuestion(question)
    };
    if (resolvedConditionCount(question, evaluated.classification, structured.include, structured.exclude) === 0 || displayOnlyRequest(question, structured.include)) {
      return {
        status: 'clarification',
        answer: [coverageNotice, displayOnlyRequest(question, structured.include) ? '発生日を確認する対象の不適合番号、品番、工程、現象、部署などを指定してください。' : '検索条件を特定できませんでした。工程、現象、処置、原因、品番、不適合番号、部署などを指定してください。'].filter(Boolean).join('\n\n'),
        recordIds: [],
        confirmationPending: pending,
        classifier: { classification: evaluated.classification, conditions: structured.include, exclude: structured.exclude, display: { originalText: true }, reason: 'conditions_not_resolved', coverage },
        session: this.sessionFor(question, conversation, pending),
        elapsedMs: Number((performance.now() - started).toFixed(3))
      };
    }
    const records = searchStored(this.store, query);
    const answer = records.map((record) => record.rawText).join('\n\n');
    return {
      status: 'completed',
      answer: [coverageNotice, answer || '指定条件に一致する記録はありませんでした。未分類の記録については判断していません。'].filter(Boolean).join('\n\n'),
      recordIds: records.map((record) => `nonconformity:${record.id}`),
      confirmationPending: pending,
      classifier: { classification: evaluated.classification, conditions: structured.include, exclude: structured.exclude, display: { originalText: true }, matchedCount: records.length, limit: query.limit, coverage },
      elapsedMs: Number((performance.now() - started).toFixed(3))
    };
  }

  metrics() {
    return { ...this.runtime, ...this.coverage(), classificationCalls: this.calls.filter((call) => call.phase === 'record').length, queryClassificationCalls: this.calls.filter((call) => call.phase === 'query').length, apiCalls: this.calls.length, calls: this.calls };
  }

  async close() { this.closed = true; }
}

export { GROUPS };
