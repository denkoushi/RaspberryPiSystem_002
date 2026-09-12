/*
 * Scratch-only, deterministic answer projection for already retrieved
 * nonconformity records.
 *
 * This module deliberately does not search, call a model, or infer facts. It
 * chooses fields from the Business Hermes record contract and keeps every
 * selected value attached to its source record for supervisor checks.
 */

const MISSING_VALUE = '未記録（空欄。未実施を意味しません）';
const UNKNOWN_INTENT_MESSAGE = '必要な情報を指定してください。対策、処置、または原因のどれを確認したいか入力してください。';
const NO_RETRIEVED_RECORD_MESSAGE = '取得済みの記録がありません。指定された項目を回答できる根拠がありません。';
const NO_MATCH_MESSAGE = '指定された番号の記録は、取得済み記録にはありません。取得済み記録にない内容は推測していません。';
const CAUSE_CONTRACT_NOTE = 'この抽出処理は、記録本文から原因の記述を選ぶことには未対応です。備考や不適合内容を原因として再分類していません。';

const FIELD_DEFINITIONS = Object.freeze({
  correctiveContent: Object.freeze({
    key: 'correctiveContent',
    label: '個別是正内容'
  }),
  disposition: Object.freeze({
    key: 'disposition',
    label: '処置内容'
  })
});

const INTENT_FIELDS = Object.freeze({
  countermeasure: Object.freeze([
    FIELD_DEFINITIONS.correctiveContent,
    FIELD_DEFINITIONS.disposition
  ]),
  handling: Object.freeze([
    FIELD_DEFINITIONS.disposition
  ])
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function surface(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
}

function textValue(value) {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeRecordNumber(value) {
  const normalized = surface(value).toLocaleUpperCase('en-US').replace(/\s+/gu, '');
  if (!normalized) return null;
  if (/^\d+$/u.test(normalized)) return normalized.replace(/^0+(?=\d)/u, '');
  return normalized;
}

function recordNumber(record) {
  return textValue(record.nonconformityNo);
}

function sameRecordNumber(left, right) {
  const normalizedLeft = normalizeRecordNumber(left);
  const normalizedRight = normalizeRecordNumber(right);
  return normalizedLeft !== null && normalizedLeft === normalizedRight;
}

function addUnique(target, value) {
  if (!value || target.some((entry) => sameRecordNumber(entry, value))) return;
  target.push(value);
}

function requestedRecordNumbers(question) {
  const normalized = surface(question);
  if (!normalized) return [];
  const values = [];

  // Numbered references are accepted in the common labeled forms. The
  // optional standalone numeric form supports questions such as "8204の対策";
  // date, quantity, dimension, and product-number contexts are excluded.
  const labeled = /(?:(?:不適合|非適合)\s*(?:番号|No\.?|＃|#)|No\.?|№)\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,119})/giu;
  for (const match of normalized.matchAll(labeled)) {
    addUnique(values, match[1]);
  }

  // Japanese connective particles are letters too, so the boundary follows
  // the search worker contract and excludes only ASCII identifier characters.
  const standalone = /(?<![A-Za-z0-9])([0-9]{3,120})(?![A-Za-z0-9])/gu;
  for (const match of normalized.matchAll(standalone)) {
    const candidate = match[1];
    const start = match.index ?? 0;
    const before = normalized.slice(Math.max(0, start - 16), start);
    const after = normalized.slice(start + candidate.length);
    if (/(?:品番|年|月|日|日時|mm|ミリ|個|件|ページ)\s*[:：#]?\s*$/iu.test(before)
      || /^\s*(?:年|月|日|日時|mm|ミリ|個|件|ページ)/iu.test(after)) continue;
    addUnique(values, candidate);
  }
  return values;
}

function detectIntent(question) {
  const normalized = surface(question);
  const cause = /原因|起因|発生(?:の)?理由|なぜ/iu.test(normalized);
  const handling = /処置/iu.test(normalized);
  // "対応" is a broad countermeasure request in this source contract. A
  // question containing both 対策 and 処置 still asks for both requested
  // categories; a question containing only 処置 selects disposition alone.
  const countermeasure = /対策|是正|改善|再発防止|対応/iu.test(normalized);
  if (!cause && !handling && !countermeasure) {
    return { kind: 'unknown', requestedFields: [], definitions: [] };
  }
  const definitions = [];
  if (countermeasure) definitions.push(...INTENT_FIELDS.countermeasure);
  else if (handling) definitions.push(...INTENT_FIELDS.handling);
  const uniqueDefinitions = definitions.filter((definition, index) => definitions.findIndex((entry) => entry.key === definition.key) === index);
  const kind = cause
    ? countermeasure ? 'cause_and_countermeasure' : handling ? 'cause_and_handling' : 'cause'
    : countermeasure ? 'countermeasure' : 'handling';
  return {
    kind,
    requestedFields: uniqueDefinitions.map((definition) => definition.key),
    definitions: uniqueDefinitions,
    asksCause: cause,
    unsupportedRequests: cause ? ['cause'] : []
  };
}

function readField(record, definition) {
  const value = textValue(record[definition.key]);
  return { value, sourceFields: [definition.key] };
}

function sourceRecordKey(record, index) {
  const evidenceKey = textValue(record.evidenceKey);
  if (evidenceKey) return evidenceKey;
  const id = textValue(record.id);
  const kind = textValue(record.kind);
  if (id && kind) return `${kind}:${id}`;
  return `record:${index + 1}`;
}

function formatRecordHeader(record, index) {
  const number = recordNumber(record);
  return number ? `【不適合番号 ${number}】` : `【非適合記録 ${index + 1}】`;
}

function projectRecord(record, index, intent) {
  const key = sourceRecordKey(record, index);
  const number = recordNumber(record);
  const selectedFields = intent.definitions.map((definition) => {
    const source = readField(record, definition);
    const value = source.value;
    return {
      recordKey: key,
      recordNumber: number,
      field: definition.key,
      label: definition.label,
      sourceFields: source.sourceFields,
      value,
      present: value !== null
    };
  });
  const missingFields = selectedFields.filter((field) => !field.present).map((field) => ({
    recordKey: field.recordKey,
    recordNumber: field.recordNumber,
    field: field.field,
    label: field.label,
    sourceFields: field.sourceFields
  }));
  const lines = [formatRecordHeader(record, index)];
  if (intent.asksCause) lines.push(`原因の扱い: ${CAUSE_CONTRACT_NOTE}`);
  for (const field of selectedFields) {
    lines.push(`${field.label}: ${field.present ? field.value : MISSING_VALUE}`);
  }
  return {
    recordKey: key,
    recordNumber: number,
    selectedFields,
    missingFields,
    lines
  };
}

/**
 * Project requested answer fields from already retrieved records.
 *
 * The call form is: extractNumberedRecordAnswer({ question, records }). No
 * network, model, or record lookup is performed here.
 */
export function extractNumberedRecordAnswer(input) {
  const question = isRecord(input) ? input.question : '';
  const records = isRecord(input) ? input.records : [];
  const intent = detectIntent(question);
  const requestedNumbers = requestedRecordNumbers(question);
  const inputRecords = Array.isArray(records) ? records.filter(isRecord) : [];

  if (intent.kind === 'unknown') {
    return {
      status: 'clarification',
      intent: intent.kind,
      requestedFields: intent.requestedFields,
      requestedRecordNumbers: requestedNumbers,
      matchedRecordNumbers: [],
      unmatchedRecordNumbers: requestedNumbers,
      answer: UNKNOWN_INTENT_MESSAGE,
      selectedFields: [],
      missingFields: [],
      unsupportedRequests: []
    };
  }

  const targetRecords = requestedNumbers.length > 0
    ? inputRecords.filter((record) => requestedNumbers.some((number) => sameRecordNumber(recordNumber(record), number)))
    : inputRecords;
  const matchedRecordNumbers = [];
  for (const record of targetRecords) addUnique(matchedRecordNumbers, recordNumber(record));
  const unmatchedRecordNumbers = requestedNumbers.filter((number) => !matchedRecordNumbers.some((matched) => sameRecordNumber(matched, number)));

  if (targetRecords.length === 0) {
    const answer = requestedNumbers.length > 0 ? NO_MATCH_MESSAGE : NO_RETRIEVED_RECORD_MESSAGE;
    return {
      status: 'no_match',
      intent: intent.kind,
      requestedFields: intent.requestedFields,
      requestedRecordNumbers: requestedNumbers,
      matchedRecordNumbers,
      unmatchedRecordNumbers: requestedNumbers,
      answer,
      selectedFields: [],
      missingFields: [],
      unsupportedRequests: intent.unsupportedRequests
    };
  }

  const projections = targetRecords.map((record, index) => projectRecord(record, index, intent));
  const answerLines = projections.flatMap((projection) => [...projection.lines, '']);
  if (unmatchedRecordNumbers.length > 0) {
    answerLines.push(`取得済み記録にない不適合番号: ${unmatchedRecordNumbers.join('、')}`);
  }
  const selectedFields = projections.flatMap((projection) => projection.selectedFields);
  const missingFields = projections.flatMap((projection) => projection.missingFields);
  return {
    status: 'ready',
    intent: intent.kind,
    requestedFields: intent.requestedFields,
    requestedRecordNumbers: requestedNumbers,
    matchedRecordNumbers,
    unmatchedRecordNumbers,
    answer: answerLines.join('\n').trim(),
    selectedFields,
    missingFields,
    unsupportedRequests: intent.unsupportedRequests,
    records: projections.map(({ lines, ...projection }) => projection)
  };
}

export default extractNumberedRecordAnswer;
