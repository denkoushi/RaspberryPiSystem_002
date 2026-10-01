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
  shouldReplacePurchaseOrderLookupRow,
} from './purchase-order-lookup-sync.pipeline.js';

/** 1 文でまとめて upsert する行数（1 行 12 パラメータ。Postgres のバインド上限 65535 に十分収まる粒度） */
const UPSERT_CHUNK_SIZE = 500;

export type PurchaseOrderLookupSyncResult = {
  scanned: number;
  /** 後方互換のため維持。意味は `upserted` と同じ。 */
  inserted: number;
  upserted: number;
  /** DB の行の方が更新日時（`FUPDTEDT`）が新しく、書き込まなかった行数。 */
  skippedStale: number;
};

/**
 * FKOBAINO CsvDashboard の「今回 ingest した原本CSV」から、`PurchaseOrderLookupRow` を upsert する。
 * キーは `sourceCsvDashboardId + FKOBAINO + FSEIBAN + 照合キーFHINCD`（括弧除去+末尾数値枝番除去）。CSVに無い過去行は残す。
 * 新旧は取込順ではなく `FUPDTEDT` で決める。DB の行より古い行、および更新日時の無い行は、更新日時のある既存行を上書きしない。
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

    // 同一キーが CSV 内に複数あれば更新日時が最新の行（同時刻・不明なら最後の行）を採用する
    // （1 文の ON CONFLICT は同じ行を二度更新できない）。
    const latestByKey = new Map<string, ParsedPurchaseOrderLookupCsvRow>();
    for (const p of parsed) {
      const key = `${p.purchaseOrderNo}\u0000${p.seiban}\u0000${p.purchasePartCodeMatchKey}`;
      const current = latestByKey.get(key);
      if (current == null || shouldReplacePurchaseOrderLookupRow(current, p)) {
        latestByKey.set(key, p);
      }
    }
    const rows = [...latestByKey.values()];

    // upsert は冪等なので全体を 1 トランザクションにしない。数万行の CSV でも時間切れにならないよう、
    // チャンクごとに 1 文でまとめて書く。途中で失敗しても、同じ CSV を取り込み直せば揃う。
    // FKOBAIST 列が無いCSVで既存ステイタスを消さないよう、purchaseStatus は COALESCE で残す。
    // sourceUpdatedAt は接続のタイムゾーンに依存しないよう、UTC の ISO 文字列から変換して書く。
    let written = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
      written += await prisma.$executeRaw`
        INSERT INTO "PurchaseOrderLookupRow" (
          "id", "sourceCsvDashboardId", "purchaseOrderNo", "purchasePartCodeRaw", "purchasePartCodeNormalized",
          "purchasePartCodeMatchKey", "seiban", "purchasePartName", "acceptedQuantity", "purchaseStatus",
          "sourceUpdatedAt", "lineIndex", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(
          chunk.map(
            (p) => Prisma.sql`(
              ${randomUUID()}, ${sourceCsvDashboardId}, ${p.purchaseOrderNo}, ${p.purchasePartCodeRaw},
              ${p.purchasePartCodeNormalized}, ${p.purchasePartCodeMatchKey}, ${p.seiban}, ${p.purchasePartName},
              ${p.acceptedQuantity}, ${p.purchaseStatus},
              ${p.sourceUpdatedAt?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC',
              ${p.lineIndex}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
          "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
          "lineIndex" = EXCLUDED."lineIndex",
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "PurchaseOrderLookupRow"."sourceUpdatedAt" IS NULL
          OR EXCLUDED."sourceUpdatedAt" >= "PurchaseOrderLookupRow"."sourceUpdatedAt"
      `;
    }

    return {
      scanned: records.length,
      inserted: parsed.length,
      upserted: parsed.length,
      skippedStale: rows.length - written,
    };
  }
}
