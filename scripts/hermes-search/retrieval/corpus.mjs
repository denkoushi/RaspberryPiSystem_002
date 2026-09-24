// Authorized rows become catalog records. Merge and stamp stay free of log text.
import { fieldsWithRole } from './catalog.mjs';
import { prepareLexicalCorpus } from './executor.mjs';
import { buildValueIndex } from './value-index.mjs';

const TEXT_FIELDS = [
  'nonconformityNo', 'partNumber', 'partName', 'machineName', 'originDepartmentName',
  'discoveredOn', 'condition', 'remarks', 'correctiveContent', 'disposition',
];

export function recordFromAuthorizedRow(row) {
  if (!row || row.kind !== 'nonconformity' || typeof row.id !== 'string' || !row.id) return null;
  const record = { id: row.id };
  for (const key of TEXT_FIELDS) {
    const value = row[key];
    if (typeof value === 'string') record[key] = value;
    else if (value == null) record[key] = '';
  }
  return record;
}

export function mergeRecords(previous, incoming) {
  const byId = new Map();
  for (const record of previous ?? []) {
    if (record && typeof record.id === 'string') byId.set(record.id, record);
  }
  for (const record of incoming ?? []) {
    if (record && typeof record.id === 'string') byId.set(record.id, record);
  }
  return [...byId.values()];
}

export function formatDataAsOf(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

export function stampAnswer(answer, dataAsOf) {
  const stamp = formatDataAsOf(dataAsOf);
  if (!stamp) return { answer, dataAsOf: null };
  return { answer: `${answer}\nデータ時点: ${stamp}`, dataAsOf: stamp };
}

export function buildCorpusView(records, catalog, dataAsOf) {
  return {
    records,
    valueIndex: buildValueIndex(records, catalog),
    lexicalCorpus: prepareLexicalCorpus(records, fieldsWithRole(catalog, 'body')),
    snapshotCount: records.length,
    dataAsOf: dataAsOf ?? null,
  };
}

export function replaceCorpus(current, catalog, message) {
  const incoming = (Array.isArray(message?.records) ? message.records : [])
    .map((row) => (row?.kind === 'nonconformity' ? recordFromAuthorizedRow(row) : row))
    .filter((row) => row && typeof row.id === 'string');
  const records = message?.mode === 'incremental' ? mergeRecords(current?.records ?? [], incoming) : incoming;
  return buildCorpusView(records, catalog, message?.asOf ?? new Date().toISOString());
}
