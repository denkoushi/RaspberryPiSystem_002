import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

type ActualHoursCsvRow = {
  FSEIBAN?: string;
  FHINCD?: string;
  FSEZONO?: string;
  FSEZOSIJISU?: string;
  FSIGENCD?: string;
  FSAGYOHOUR?: string;
  FKOJUN?: string;
  FSAGYOYMD?: string;
};

export type ProductionActualHoursImportResult = {
  rowsProcessed: number;
  rowsInserted: number;
  rowsIgnored: number;
};

const REQUIRED_HEADERS = ['FHINCD', 'FSEZOSIJISU', 'FSIGENCD', 'FSAGYOHOUR', 'FSAGYOYMD'] as const;
const INSERT_CHUNK_SIZE = 1000;

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toUpperCase();
}

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const jpMatch = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(trimmed);
  if (jpMatch) {
    const year = Number(jpMatch[1]);
    const month = Number(jpMatch[2]);
    const day = Number(jpMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const plainDate = new Date(trimmed);
  return Number.isNaN(plainDate.getTime()) ? null : plainDate;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const sanitized = value.replace(/,/g, '').trim();
  if (!sanitized) {
    return null;
  }
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function decodeCsvBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('FHINCD') && utf8.includes('FSAGYOHOUR') && !utf8.includes('\uFFFD')) {
    return utf8;
  }
  return iconv.decode(buffer, 'cp932');
}

function toFingerprint(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export class ProductionActualHoursImportService {
  async importFromCsv(params: {
    buffer: Buffer;
    sourceFileKey: string;
    sourceScheduleId?: string;
    sourceMessageId?: string;
    csvDashboardId?: string;
  }): Promise<ProductionActualHoursImportResult> {
    const csvDashboardId = params.csvDashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
    const csvText = decodeCsvBuffer(params.buffer);
    const parsedRows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as ActualHoursCsvRow[];
    if (parsedRows.length === 0) {
      return { rowsProcessed: 0, rowsInserted: 0, rowsIgnored: 0 };
    }

    const headers = Object.keys(parsedRows[0] ?? {}).map((key) => normalizeHeader(key));
    for (const requiredHeader of REQUIRED_HEADERS) {
      if (!headers.includes(requiredHeader)) {
        throw new Error(`Required header is missing: ${requiredHeader}`);
      }
    }

    const createRows: Prisma.ProductionScheduleActualHoursRawCreateManyInput[] = [];
    let ignored = 0;

    for (const row of parsedRows) {
      const fhincd = row.FHINCD?.trim();
      const resourceCd = row.FSIGENCD?.trim();
      const workDate = parseDate(row.FSAGYOYMD ?? '');
      const lotQty = parseNumber(row.FSEZOSIJISU);
      const actualMinutes = parseNumber(row.FSAGYOHOUR);
      if (!fhincd || !resourceCd || !workDate || lotQty === null || actualMinutes === null || lotQty <= 0) {
        ignored += 1;
        continue;
      }

      const perPieceMinutes = actualMinutes / lotQty;
      if (!Number.isFinite(perPieceMinutes)) {
        ignored += 1;
        continue;
      }

      let isExcluded = false;
      let excludeReason: string | null = null;
      if (actualMinutes <= 0 || perPieceMinutes <= 0) {
        isExcluded = true;
        excludeReason = 'zero_actual_minutes';
      }

      const processOrder = parseIntNumber(row.FKOJUN);
      const fseiban = row.FSEIBAN?.trim() || null;
      const lotNo = row.FSEZONO?.trim() || null;
      const rowFingerprint = toFingerprint([
        params.sourceFileKey,
        fhincd,
        resourceCd,
        workDate.toISOString(),
        String(lotQty),
        String(actualMinutes),
        String(processOrder ?? ''),
        String(fseiban ?? ''),
        String(lotNo ?? ''),
      ]);

      createRows.push({
        csvDashboardId,
        sourceFileKey: params.sourceFileKey,
        sourceScheduleId: params.sourceScheduleId ?? null,
        sourceMessageId: params.sourceMessageId ?? null,
        rowFingerprint,
        workDate,
        fseiban,
        fhincd,
        lotNo,
        lotQty,
        resourceCd,
        processOrder,
        actualMinutes,
        perPieceMinutes,
        isExcluded,
        excludeReason,
      });
    }

    let inserted = 0;
    for (let i = 0; i < createRows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = createRows.slice(i, i + INSERT_CHUNK_SIZE);
      if (chunk.length === 0) {
        continue;
      }
      const result = await prisma.productionScheduleActualHoursRaw.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    return {
      rowsProcessed: parsedRows.length,
      rowsInserted: inserted,
      rowsIgnored: ignored,
    };
  }
}
