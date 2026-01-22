import { parse } from 'csv-parse/sync';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import type { ColumnDefinition } from '../csv-dashboard/csv-dashboard.types.js';

type ColumnMapping = Array<{ csvIndex: number; internalName: string; columnDef: ColumnDefinition }>;

export class MeasuringInstrumentLoanEventService {
  private static readonly TARGET_INTERNAL_NAMES = new Set(['managementNumber', 'day', 'shiyou_henkyaku']);

  async projectEventsFromCsv(params: {
    dashboardId: string;
    csvContent: string;
    messageId?: string;
    messageSubject?: string;
  }): Promise<number> {
    const { dashboardId, csvContent, messageId, messageSubject } = params;
    const dashboard = await prisma.csvDashboard.findUnique({ where: { id: dashboardId } });
    if (!dashboard) {
      logger?.warn({ dashboardId }, '[MeasuringInstrumentLoanEventService] Dashboard not found, skipping');
      return 0;
    }

    const columnDefinitions = dashboard.columnDefinitions as unknown as ColumnDefinition[];
    const rows = this.parseCsv(csvContent);
    const columnMapping = this.createColumnMapping(rows[0] || [], columnDefinitions);
    const mappedInternalNames = new Set(columnMapping.map((map) => map.internalName));
    for (const targetName of MeasuringInstrumentLoanEventService.TARGET_INTERNAL_NAMES) {
      if (!mappedInternalNames.has(targetName)) {
        throw new Error(`Required column not found: ${targetName}`);
      }
    }

    const dataToInsert: Prisma.MeasuringInstrumentLoanEventCreateManyInput[] = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const normalized = this.normalizeRow(row, columnMapping);
      const managementNumber = String(normalized.managementNumber ?? '').trim();
      const action = String(normalized.shiyou_henkyaku ?? '').trim();
      const dayRaw = String(normalized.day ?? '').trim();

      if (!managementNumber || !action || !dayRaw) {
        continue;
      }

      if (action !== '持ち出し' && action !== '返却') {
        continue;
      }

      const eventAt = new Date(dayRaw);
      if (Number.isNaN(eventAt.getTime())) {
        continue;
      }

      dataToInsert.push({
        managementNumber,
        eventAt,
        action,
        raw: normalized as Prisma.InputJsonValue,
        sourceMessageId: messageId ?? null,
        sourceMessageSubject: messageSubject ?? null,
        sourceCsvDashboardId: dashboardId ?? null,
      });
    }

    if (dataToInsert.length === 0) {
      return 0;
    }

    const result = await prisma.measuringInstrumentLoanEvent.createMany({
      data: dataToInsert,
      skipDuplicates: true,
    });

    return result.count;
  }

  async getTodayBorrowedRowsJst(): Promise<Array<Record<string, unknown>>> {
    const nowUtc = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const nowJst = new Date(nowUtc.getTime() + jstOffset);
    const startOfTodayJst = new Date(nowJst);
    startOfTodayJst.setHours(0, 0, 0, 0);
    const startDateUtc = new Date(startOfTodayJst.getTime() - jstOffset);
    const endOfTodayJst = new Date(nowJst);
    endOfTodayJst.setHours(23, 59, 59, 999);
    const endDateUtc = new Date(endOfTodayJst.getTime() - jstOffset);

    const borrowEvents = await prisma.measuringInstrumentLoanEvent.findMany({
      where: {
        action: '持ち出し',
        eventAt: {
          gte: startDateUtc,
          lte: endDateUtc,
        },
      },
      orderBy: { eventAt: 'desc' },
    });

    if (borrowEvents.length === 0) {
      return [];
    }

    const managementNumbers = Array.from(new Set(borrowEvents.map((event) => event.managementNumber)));
    const returnEvents = await prisma.measuringInstrumentLoanEvent.findMany({
      where: {
        action: '返却',
        managementNumber: { in: managementNumbers },
        eventAt: { lte: nowUtc },
      },
      select: { managementNumber: true, eventAt: true },
    });

    const latestReturnMap = new Map<string, Date>();
    for (const event of returnEvents) {
      const current = latestReturnMap.get(event.managementNumber);
      if (!current || event.eventAt > current) {
        latestReturnMap.set(event.managementNumber, event.eventAt);
      }
    }

    return borrowEvents
      .filter((borrow) => {
        const latestReturn = latestReturnMap.get(borrow.managementNumber);
        if (!latestReturn) {
          return true;
        }
        return latestReturn < borrow.eventAt;
      })
      .map((borrow) => borrow.raw as Record<string, unknown>);
  }

  private parseCsv(csvContent: string): string[][] {
    const records = parse(csvContent, {
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];
    return records;
  }

  private createColumnMapping(csvHeaders: string[], columnDefinitions: ColumnDefinition[]): ColumnMapping {
    const mapping: ColumnMapping = [];
    const normalizeHeader = (value: string) => {
      const trimmed = value.replace(/^\uFEFF/, '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      return trimmed.replace(/^"+|"+$/g, '').toLowerCase();
    };

    for (const colDef of columnDefinitions) {
      const csvIndex = csvHeaders.findIndex((header) =>
        colDef.csvHeaderCandidates.some((candidate) => normalizeHeader(header) === normalizeHeader(candidate))
      );
      if (csvIndex === -1) {
        if (colDef.required !== false) {
          throw new Error(`Required column not found: ${colDef.internalName}`);
        }
        continue;
      }
      mapping.push({ csvIndex, internalName: colDef.internalName, columnDef: colDef });
    }

    return mapping;
  }

  private normalizeRow(row: string[], mapping: ColumnMapping): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const map of mapping) {
      normalized[map.internalName] = row[map.csvIndex] ?? '';
    }
    return normalized;
  }
}
