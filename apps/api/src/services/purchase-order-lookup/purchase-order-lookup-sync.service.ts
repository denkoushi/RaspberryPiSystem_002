import { readFile } from 'node:fs/promises';

import { parse } from 'csv-parse/sync';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../production-schedule/constants.js';
import {
  type ParsedPurchaseOrderLookupCsvRow,
  parsePurchaseOrderLookupRow,
} from './purchase-order-lookup-sync.pipeline.js';

const REPLACEMENT_TX_TIMEOUT_MS = 60_000;
const REPLACEMENT_TX_MAX_WAIT_MS = 15_000;

/** 1 トランザクション内の upsert バッチサイズ（行数が多いCSVでもタイムアウトしにくい粒度） */
const UPSERT_CHUNK_SIZE = 100;

export type PurchaseOrderLookupSyncResult = {
  scanned: number;
  /** 後方互換のため維持。意味は `upserted` と同じ。 */
  inserted: number;
  upserted: number;
};

/**
 * FKOBAINO CsvDashboard の「今回 ingest した原本CSV」から、`PurchaseOrderLookupRow` を upsert する。
 * キーは `sourceCsvDashboardId + FKOBAINO + FSEIBAN + 正規化FHINCD`。既存行は上書きし、CSVに無い過去行は残す。
 */
export class PurchaseOrderLookupSyncService {
  async syncFromFkobainoDashboard(params: { ingestRunId: string }): Promise<PurchaseOrderLookupSyncResult> {
    const sourceCsvDashboardId = PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID;
    const ingestRun = await prisma.csvDashboardIngestRun.findUnique({
      where: { id: params.ingestRunId },
      select: { csvDashboardId: true, csvFilePath: true },
    });
    if (!ingestRun || ingestRun.csvDashboardId !== sourceCsvDashboardId) {
      throw new ApiError(404, `FKOBAINO 取り込み実行が見つかりません: ${params.ingestRunId}`);
    }
    if (!ingestRun.csvFilePath) {
      throw new ApiError(400, `FKOBAINO 取り込み実行に CSV 原本がありません: ${params.ingestRunId}`);
    }

    const csvText = await readFile(ingestRun.csvFilePath, 'utf-8');
    const records = parse(csvText, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
    }) as Array<Record<string, unknown>>;

    const parsed: ParsedPurchaseOrderLookupCsvRow[] = [];
    for (let lineIndex = 0; lineIndex < records.length; lineIndex += 1) {
      const p = parsePurchaseOrderLookupRow(records[lineIndex] ?? {}, lineIndex);
      if (p != null) {
        parsed.push(p);
      }
    }

    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < parsed.length; i += UPSERT_CHUNK_SIZE) {
          const chunk = parsed.slice(i, i + UPSERT_CHUNK_SIZE);
          for (const p of chunk) {
            await tx.purchaseOrderLookupRow.upsert({
              where: {
                sourceCsvDashboardId_purchaseOrderNo_seiban_purchasePartCodeNormalized: {
                  sourceCsvDashboardId,
                  purchaseOrderNo: p.purchaseOrderNo,
                  seiban: p.seiban,
                  purchasePartCodeNormalized: p.purchasePartCodeNormalized,
                },
              },
              create: {
                sourceCsvDashboardId,
                purchaseOrderNo: p.purchaseOrderNo,
                purchasePartCodeRaw: p.purchasePartCodeRaw,
                purchasePartCodeNormalized: p.purchasePartCodeNormalized,
                seiban: p.seiban,
                purchasePartName: p.purchasePartName,
                acceptedQuantity: p.acceptedQuantity,
                lineIndex: p.lineIndex,
              },
              update: {
                purchasePartCodeRaw: p.purchasePartCodeRaw,
                purchasePartName: p.purchasePartName,
                acceptedQuantity: p.acceptedQuantity,
                lineIndex: p.lineIndex,
              },
            });
          }
        }
      },
      { timeout: REPLACEMENT_TX_TIMEOUT_MS, maxWait: REPLACEMENT_TX_MAX_WAIT_MS }
    );

    return { scanned: records.length, inserted: parsed.length, upserted: parsed.length };
  }
}
