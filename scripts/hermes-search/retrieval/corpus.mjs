// Authorized rows become catalog records. Merge and stamp stay free of log text.
import { catalogEntries, fieldsWithRole, loadNonconformityCatalog } from './catalog.mjs';
import { prepareLexicalCorpus } from './executor.mjs';
import { buildValueIndex } from './value-index.mjs';

export function recordFromAuthorizedRow(row, catalog = loadNonconformityCatalog()) {
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  const entry = catalogEntries(catalog).find((entry) => entry.id === row.kind);
  if (!entry) return null;
  const record = { id: row.id, sourceId: entry.id };
  for (const { key } of entry.fields) {
    const value = row[key];
    if (typeof value === 'string') record[key] = value;
    else if (value == null) record[key] = '';
  }
  return record;
}

export function mergeRecords(previous, incoming) {
  const byId = new Map();
  const key = (record) => `${record.sourceId ?? 'nonconformity'}\0${record.id}`;
  for (const record of previous ?? []) {
    if (record && typeof record.id === 'string') byId.set(key(record), record);
  }
  for (const record of incoming ?? []) {
    if (record && typeof record.id === 'string') byId.set(key(record), record);
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
  const entries = catalogEntries(catalog);
  const bySource = Object.fromEntries(entries.map((entry) => {
    const sourceRecords = records.filter((record) => (record.sourceId ?? 'nonconformity') === entry.id);
    return [entry.id, {
      records: sourceRecords,
      lexicalCorpus: prepareLexicalCorpus(sourceRecords, fieldsWithRole(entry, 'body')),
    }];
  }));
  return {
    records,
    bySource,
    valueIndex: buildValueIndex(records, catalog),
    lexicalCorpus: entries.length === 1 && bySource[entries[0].id].records.length === records.length
      ? bySource[entries[0].id].lexicalCorpus
      : null,
    snapshotCount: records.length,
    dataAsOf: dataAsOf ?? null,
  };
}

/** Records from API rows: authorized rows are reduced to their text fields, other rows pass through. */
export function authorizedRecords(rows, catalog = loadNonconformityCatalog()) {
  // The one-argument flywheel contract also preserves rows already in record form.
  const explicitCatalog = arguments.length > 1 && arguments[1] !== undefined;
  const enabled = new Set(catalogEntries(catalog).map(entry => entry.id));
  return (Array.isArray(rows) ? rows : [])
    .map((row) => (row?.kind && (explicitCatalog || row.kind === 'nonconformity') ? recordFromAuthorizedRow(row, catalog) : row))
    .filter((row) => row && typeof row.id === 'string'
      && (!explicitCatalog || !row.sourceId || enabled.has(row.sourceId)));
}

export function replaceCorpus(current, catalog, message) {
  const incoming = authorizedRecords(message?.records, catalog);
  const records = message?.mode === 'incremental' ? mergeRecords(current?.records ?? [], incoming) : incoming;
  return buildCorpusView(records, catalog, message?.asOf ?? new Date().toISOString());
}
