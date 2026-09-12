import { createHash } from 'node:crypto';

/**
 * Build the small sidecar needed to turn a QMD result back into an
 * authorized, canonical Hermes field. This is deliberately independent of
 * QMD and of the database: the input is the already authorized MCP payload.
 */
export function canonicalCorrectiveContent(record) {
  // The adapter accepts the existing MCP canonical field only. The API's
  // source columns are intentionally not inferred or reconstructed here.
  const value = record.correctiveContent || null;
  return {
    value,
    sourceFields: value ? ['correctiveContent'] : [],
  };
}

const FIELD_ORDER = [
  ['nonconformityNo', 'nonconformityNo'],
  ['partNumber', 'partNumber'],
  ['partName', 'partName'],
  ['machineName', 'machineName'],
  ['originDepartmentCode', 'originDepartmentCode'],
  ['originDepartmentName', 'originDepartmentName'],
  ['discoveredOn', 'discoveredOn'],
  ['condition', 'condition'],
  ['remarks', 'remarks'],
  ['correctiveContent', 'correctiveContent'],
  ['disposition', 'disposition'],
];

function recordIdOf(record) {
  if (!record || typeof record !== 'object') throw new Error('record must be an object');
  if (record.kind !== undefined && record.kind !== 'nonconformity') throw new Error('record kind must be nonconformity');
  if (typeof record.id !== 'string' || !record.id) throw new Error('record must have a string id');
  const expected = `nonconformity:${record.id}`;
  if (record.evidenceKey !== expected) throw new Error('evidenceKey does not match record id');
  return expected;
}

function fieldValue(record, fieldId) {
  if (fieldId === 'correctiveContent') return canonicalCorrectiveContent(record);
  const value = record[fieldId];
  return { value: value == null ? null : String(value), sourceFields: value == null ? [] : [fieldId] };
}

export function buildCanonicalManifest(records) {
  const seenRecordIds = new Set();
  return records.map((record) => {
    const recordId = recordIdOf(record);
    if (seenRecordIds.has(recordId)) throw new Error(`duplicate recordId: ${recordId}`);
    seenRecordIds.add(recordId);
    const metadata = {
      hermes_record_id: recordId,
      hermes_source: 'ScawStfutekigoCurrent',
      hermes_active_latest: true,
      ...(record.sourceVersionDate != null ? { hermes_source_version: String(record.sourceVersionDate) } : {}),
    };
    const frontmatter = [
      '---',
      'qmd:',
      '  metadata:',
      ...Object.entries(metadata).map(([key, value]) => `    ${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`),
      '---',
      '',
    ].join('\n');
    let body = frontmatter;
    const fieldSpans = {};
    for (const [fieldId, key] of FIELD_ORDER) {
      const { value, sourceFields } = fieldValue(record, key);
      // Empty/null values are omitted so the manifest never fabricates text.
      if (!value || !sourceFields.length) continue;
      const prefix = `${fieldId}: `;
      const start = body.length + prefix.length;
      body += `${prefix}${value}\n`;
      fieldSpans[fieldId] = {
        fieldId,
        start,
        end: start + value.length,
        sourceFields,
      };
    }
    const contentHash = createHash('sha256').update(body).digest('hex');
    return {
      recordId,
      contentHash,
      sourceHash: contentHash,
      docid: contentHash.slice(0, 6),
      body,
      fieldSpans,
      // This is the exact text to write as the indexed document. Metadata is
      // in QMD's YAML frontmatter, so QMD and the sidecar hash the same bytes.
      documentText: body,
      metadata,
    };
  });
}

/**
 * Resolve QMD's result to domain evidence. QMD's six-character content hash
 * is checked, but its virtual file path is intentionally never used as the
 * domain ID.
 */
export function resolveQmdBestChunk(manifest, qmdResult) {
  const recordId = qmdResult?.metadata?.hermes_record_id;
  if (!recordId) throw new Error('QMD result lacks hermes_record_id metadata');
  const document = manifest.find((entry) => entry.recordId === recordId);
  if (!document) throw new Error(`record not present in manifest: ${recordId}`);
  if (qmdResult.body !== document.body) throw new Error('QMD body is stale or from a different document');
  if (qmdResult.docid !== document.docid) throw new Error('QMD docid does not match manifest content hash');
  if (!Number.isInteger(qmdResult.bestChunkPos) || qmdResult.bestChunkPos < 0) {
    throw new Error('QMD bestChunkPos is invalid');
  }
  const bestChunk = String(qmdResult.bestChunk ?? '');
  if (!bestChunk) throw new Error('QMD bestChunk is empty');
  const end = qmdResult.bestChunkPos + bestChunk.length;
  if (end > document.body.length || document.body.slice(qmdResult.bestChunkPos, end) !== bestChunk) {
    throw new Error('QMD bestChunk does not match body at bestChunkPos');
  }
  const spans = Object.values(document.fieldSpans)
    .filter((span) => span.start < end && span.end > qmdResult.bestChunkPos)
    .map((span) => ({
      ...span,
      originalValue: document.body.slice(span.start, span.end),
    }));
  if (!spans.length) throw new Error('QMD bestChunk does not intersect a canonical field');
  return { recordId: document.recordId, docid: document.docid, bestChunk, spans };
}
