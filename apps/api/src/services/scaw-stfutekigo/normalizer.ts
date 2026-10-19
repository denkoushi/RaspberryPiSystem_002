import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ScawStfutekigoNormalizedRow, ScawStfutekigoNormalizationResult } from './types.js';

const FIELDS = [
  'originDepartmentCode',
  'originDepartmentName',
  'quantity',
  'remarks',
  'nonconformityContent',
  'correctiveContent1',
  'correctiveContent2',
  'dispositionContent',
  'discoveredOn',
  'sourceUpdatedOn',
  'manufacturingOrderNo',
  'sourceSeiban',
  'qaIssueCode',
  'nonconformityNo',
  'dispositionOn',
  'drawingNumber',
] as const;

type SourceRow = Record<string, unknown>;

export class ScawStfutekigoValidationError extends Error {
  readonly code = 'SCAW_STFUTEKIGO_INVALID_ROW';

  constructor(message: string) {
    super(message);
    this.name = 'ScawStfutekigoValidationError';
  }
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\r\n?/gu, '\n').trim();
  return text.length > 0 ? text : null;
}

function normalizeIdentifier(value: unknown): string | null {
  const text = normalizeText(value)?.normalize('NFKC') ?? null;
  return text && text.length > 0 ? text : null;
}

function normalizeKey(value: unknown): string {
  return normalizeIdentifier(value)?.replace(/\s+/gu, ' ') ?? '';
}

function toRawJsonValue(value: unknown): Prisma.JsonValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
  } catch {
    return String(value);
  }
}

function parseDate(value: unknown, field: string, warnings: string[]): Date | null {
  const text = normalizeText(value);
  if (!text) return null;
  const match = /^(\d{4})\s*(?:[-/]\s*(\d{1,2})|年\s*(\d{1,2})月)\s*(?:[-/]\s*(\d{1,2})|日)?(?:[ T].*)?$/u.exec(text);
  let year: number;
  let month: number;
  let day: number;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2] ?? match[3]);
    day = Number(match[4] ?? text.match(/(\d{1,2})日/u)?.[1]);
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)/u.exec(text);
    if (!iso) {
      warnings.push(`${field}: invalid date ignored (${text})`);
      return null;
    }
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    warnings.push(`${field}: invalid date ignored (${text})`);
    return null;
  }
  const result = new Date(Date.UTC(year, month - 1, day));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) {
    warnings.push(`${field}: invalid calendar date ignored (${text})`);
    return null;
  }
  return result;
}

function parseQuantity(value: unknown, warnings: string[]): Prisma.Decimal | null {
  const text = normalizeText(value);
  if (!text) return null;
  const numericText = text.normalize('NFKC');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(numericText)) {
    warnings.push(`quantity: invalid decimal ignored (${text})`);
    return null;
  }
  try {
    return new Prisma.Decimal(numericText);
  } catch {
    warnings.push(`quantity: invalid decimal ignored (${text})`);
    return null;
  }
}

function datePayload(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeRow(row: SourceRow, sourceRowOrdinal: number | null, warnings: string[]): ScawStfutekigoNormalizedRow {
  const missing = FIELDS.filter((field) => !(field in row));
  if (missing.length > 0) {
    throw new ScawStfutekigoValidationError(`missing semantic columns: ${missing.join(', ')}`);
  }
  const nonconformityNo = normalizeKey(row.nonconformityNo);
  if (!nonconformityNo) {
    throw new ScawStfutekigoValidationError('nonconformityNo (FFUTEKIGONO) is required');
  }

  const discoveredOn = parseDate(row.discoveredOn, 'discoveredOn', warnings);
  const sourceUpdatedOn = parseDate(row.sourceUpdatedOn, 'sourceUpdatedOn', warnings);
  const dispositionOn = parseDate(row.dispositionOn, 'dispositionOn', warnings);
  const quantity = parseQuantity(row.quantity, warnings);
  const rawPayload: Record<string, Prisma.JsonValue> = Object.fromEntries(
    FIELDS.map((field) => [field, toRawJsonValue(row[field])])
  );
  const originDepartmentCode = normalizeIdentifier(row.originDepartmentCode);
  const originDepartmentName = normalizeText(row.originDepartmentName);
  const remarks = normalizeText(row.remarks);
  const nonconformityContent = normalizeText(row.nonconformityContent);
  const correctiveContent1 = normalizeText(row.correctiveContent1);
  const correctiveContent2 = normalizeText(row.correctiveContent2);
  const dispositionContent = normalizeText(row.dispositionContent);
  const manufacturingOrderNo = normalizeIdentifier(row.manufacturingOrderNo)?.toUpperCase() ?? null;
  const sourceSeiban = normalizeIdentifier(row.sourceSeiban);
  const qaIssueCode = normalizeIdentifier(row.qaIssueCode);
  const drawingNumber = normalizeIdentifier(row.drawingNumber);
  const normalizedPayload: Record<string, unknown> = {
    originDepartmentCode,
    originDepartmentName,
    quantity: quantity?.toString() ?? null,
    remarks,
    nonconformityContent,
    correctiveContent1,
    correctiveContent2,
    dispositionContent,
    discoveredOn: datePayload(discoveredOn),
    sourceUpdatedOn: datePayload(sourceUpdatedOn),
    manufacturingOrderNo,
    sourceSeiban,
    qaIssueCode,
    nonconformityNo,
    dispositionOn: datePayload(dispositionOn),
    drawingNumber,
  };

  return {
    originDepartmentCode,
    originDepartmentName,
    quantity,
    remarks,
    nonconformityContent,
    correctiveContent1,
    correctiveContent2,
    dispositionContent,
    discoveredOn,
    sourceUpdatedOn,
    manufacturingOrderNo,
    sourceSeiban,
    qaIssueCode,
    nonconformityNo,
    dispositionOn,
    drawingNumber,
    rawPayload: rawPayload as ScawStfutekigoNormalizedRow['rawPayload'],
    contentHash: hashPayload(normalizedPayload),
    sourceRowOrdinal,
  };
}

/** Normalize a full snapshot; duplicate keys use the last source row. */
export function normalizeScawStfutekigoRows(
  rows: readonly { rowData: unknown; sourceRowOrdinal?: number | null }[]
): ScawStfutekigoNormalizationResult {
  if (rows.length === 0) {
    throw new ScawStfutekigoValidationError('scawSTFUTEKIGO full snapshot is empty');
  }
  const warnings: string[] = [];
  const byKey = new Map<string, ScawStfutekigoNormalizedRow>();
  for (const item of rows) {
    if (!item.rowData || typeof item.rowData !== 'object' || Array.isArray(item.rowData)) {
      throw new ScawStfutekigoValidationError('rowData must be an object');
    }
    const normalized = normalizeRow(item.rowData as SourceRow, item.sourceRowOrdinal ?? null, warnings);
    byKey.set(normalized.nonconformityNo, normalized);
  }
  return {
    rows: [...byKey.values()],
    duplicateCount: rows.length - byKey.size,
    warnings,
  };
}
