import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../production-schedule/constants.js';
import {
  type ParsedPurchaseOrderLookupCsvRow,
  parsePurchaseOrderLookupRow,
} from './purchase-order-lookup-sync.pipeline.js';

/** 1 文でまとめて upsert する行数（1 行 11 パラメータ。Postgres のバインド上限 65535 に十分収まる粒度） */
const UPSERT_CHUNK_SIZE = 500;

export type PurchaseOrderLookupSyncResult = {
  scanned: number;
  /** 後方互換のため維持。意味は `upserted` と同じ。 */
  inserted: number;
  upserted: number;
};

/**
 * FKOBAINO CsvDashboard の「今回 ingest した原本CSV」から、`PurchaseOrderLookupRow` を upsert する。
 * キーは `sourceCsvDashboardId + FKOBAINO + FSEIBAN + 照合キーFHINCD`（括弧除去+末尾数値枝番除去）。既存行は上書きし、CSVに無い過去行は残す。
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

    // 同一キーが CSV 内に複数あれば最後の行を採用する（1 文の ON CONFLICT は同じ行を二度更新できない）。
    const lastByKey = new Map<string, ParsedPurchaseOrderLookupCsvRow>();
    for (const p of parsed) {
      lastByKey.set(`${p.purchaseOrderNo}\u0000${p.seiban}\u0000${p.purchasePartCodeMatchKey}`, p);
    }
    const rows = [...lastByKey.values()];

    // upsert は冪等なので全体を 1 トランザクションにしない。数万行の CSV でも時間切れにならないよう、
    // チャンクごとに 1 文でまとめて書く。途中で失敗しても、同じ CSV を取り込み直せば揃う。
    // FKOBAIST 列が無いCSVで既存ステイタスを消さないよう、purchaseStatus は COALESCE で残す。
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
      await prisma.$executeRaw`
        INSERT INTO "PurchaseOrderLookupRow" (
          "id", "sourceCsvDashboardId", "purchaseOrderNo", "purchasePartCodeRaw", "purchasePartCodeNormalized",
          "purchasePartCodeMatchKey", "seiban", "purchasePartName", "acceptedQuantity", "purchaseStatus",
          "lineIndex", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(
          chunk.map(
            (p) => Prisma.sql`(
              ${randomUUID()}, ${sourceCsvDashboardId}, ${p.purchaseOrderNo}, ${p.purchasePartCodeRaw},
              ${p.purchasePartCodeNormalized}, ${p.purchasePartCodeMatchKey}, ${p.seiban}, ${p.purchasePartName},
              ${p.acceptedQuantity}, ${p.purchaseStatus}, ${p.lineIndex}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )`
          ),
          ','
        )}
        ON CONFLICT ("sourceCsvDashboardId", "purchaseOrderNo", "seiban", "purchasePartCodeMatchKey")
        DO UPDATE SET
          "purchasePartCodeRaw" = EXCLUDED."purchasePartCodeRaw",
          "purchasePartCodeNormalized" = EXCLUDED."purchasePartCodeNormalized",
          "purchasePartName" = EXCLUDED."purchasePartName",
          "acceptedQuantity" = EXCLUDED."acceptedQuantity",
          "purchaseStatus" = COALESCE(EXCLUDED."purchaseStatus", "PurchaseOrderLookupRow"."purchaseStatus"),
          "lineIndex" = EXCLUDED."lineIndex",
          "updatedAt" = CURRENT_TIMESTAMP
      `;
    }

    return { scanned: records.length, inserted: parsed.length, upserted: parsed.length };
  }
}
