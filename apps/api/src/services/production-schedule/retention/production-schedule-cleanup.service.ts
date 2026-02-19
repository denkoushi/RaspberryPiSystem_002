import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from '../row-resolver/constants.js';
import {
  computeBasisDateUtc,
  computeOneYearAgoThresholdUtc,
} from './production-schedule-basis-date.js';

export type ProductionScheduleLogicalKey = {
  FSEIBAN: string;
  FHINCD: string;
  FSIGENCD: string;
  FKOJUN: string;
};

// NOTE: winner判定SQLの並び順は `buildMaxProductNoWinnerCondition()` に合わせる。

const coerceKeyPart = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
};

const extractLogicalKey = (rowData: unknown): ProductionScheduleLogicalKey => {
  const record = rowData as Record<string, unknown> | null | undefined;
  return {
    FSEIBAN: coerceKeyPart(record?.FSEIBAN),
    FHINCD: coerceKeyPart(record?.FHINCD),
    FSIGENCD: coerceKeyPart(record?.FSIGENCD),
    FKOJUN: coerceKeyPart(record?.FKOJUN),
  };
};

const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

export class ProductionScheduleCleanupService {
  /**
   * 取り込み行を「1年超過は保存しない」方針でフィルタする。
   * - production schedule限定で使う想定
   */
  filterIncomingRowsByOneYear<T extends { data: unknown; occurredAt: Date }>(params: {
    rows: T[];
    nowUtc?: Date;
  }): { kept: T[]; droppedCount: number; thresholdUtc: Date } {
    const nowUtc = params.nowUtc ?? new Date();
    const thresholdUtc = computeOneYearAgoThresholdUtc(nowUtc);

    const kept: T[] = [];
    let droppedCount = 0;
    for (const row of params.rows) {
      const basisDateUtc = computeBasisDateUtc({ rowData: row.data, occurredAtUtc: row.occurredAt });
      if (basisDateUtc.getTime() < thresholdUtc.getTime()) {
        droppedCount++;
        continue;
      }
      kept.push(row);
    }

    return { kept, droppedCount, thresholdUtc };
  }

  /**
   * 1年超過行をDBから削除する（カスケード削除前提）。
   * - basisDate = max(rowData.updatedAt, occurredAt) が threshold 未満の行が対象
   * - まず occurredAt で候補を絞ってから、TS側で updatedAt をパースして最終判定する
   */
  async deleteExpiredRowsOneYear(params: {
    csvDashboardId: string;
    nowUtc?: Date;
    batchSize?: number;
  }): Promise<{ deletedCount: number; thresholdUtc: Date }> {
    const batchSize = Math.max(50, Math.min(params.batchSize ?? 500, 5000));
    const thresholdUtc = computeOneYearAgoThresholdUtc(params.nowUtc ?? new Date());

    let deletedCount = 0;
    let lastId: string | undefined;

    for (;;) {
      const candidates = await prisma.csvDashboardRow.findMany({
        where: {
          csvDashboardId: params.csvDashboardId,
          occurredAt: { lt: thresholdUtc },
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        select: {
          id: true,
          occurredAt: true,
          rowData: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (candidates.length === 0) {
        break;
      }

      lastId = candidates[candidates.length - 1]?.id;

      const idsToDelete: string[] = [];
      for (const row of candidates) {
        const basisDateUtc = computeBasisDateUtc({ rowData: row.rowData, occurredAtUtc: row.occurredAt });
        if (basisDateUtc.getTime() < thresholdUtc.getTime()) {
          idsToDelete.push(row.id);
        }
      }

      if (idsToDelete.length > 0) {
        const result = await prisma.csvDashboardRow.deleteMany({
          where: { id: { in: idsToDelete } },
        });
        deletedCount += result.count;
      }

      // 次のバッチへ
      if (candidates.length < batchSize) {
        break;
      }
    }

    return { deletedCount, thresholdUtc };
  }

  /**
   * 今回の取り込みで観測された論理キー範囲に限定して「重複 loser」を削除する。
   * - winner 判定は `buildMaxProductNoWinnerCondition()` と同じ並び（ProductNo desc, createdAt desc, id desc）
   */
  async deleteDuplicateLosersForKeys(params: {
    csvDashboardId: string;
    logicalKeys: ProductionScheduleLogicalKey[];
    deleteBatchSize?: number;
    keyChunkSize?: number;
  }): Promise<{ deletedCount: number }> {
    const deleteBatchSize = Math.max(100, Math.min(params.deleteBatchSize ?? 5000, 50000));
    const keyChunkSize = Math.max(50, Math.min(params.keyChunkSize ?? 300, 2000));

    const chunks = chunk(params.logicalKeys, keyChunkSize).filter((c) => c.length > 0);
    if (chunks.length === 0) {
      return { deletedCount: 0 };
    }

    let deletedCount = 0;

    for (const keyChunk of chunks) {
      // deleteManyだとwinner判定が書けないため、raw SQLで削除する
      for (;;) {
        const valuesSql = Prisma.join(
          keyChunk.map((k) => Prisma.sql`(${k.FSEIBAN}, ${k.FHINCD}, ${k.FSIGENCD}, ${k.FKOJUN})`),
          ', '
        );

        const affected = await prisma.$executeRaw<number>(Prisma.sql`
          WITH keys("FSEIBAN","FHINCD","FSIGENCD","FKOJUN") AS (
            VALUES ${valuesSql}
          ),
          ranked AS (
            SELECT
              r."id" AS "id",
              ROW_NUMBER() OVER (
                PARTITION BY
                  r."csvDashboardId",
                  COALESCE(r."rowData"->>'FSEIBAN', ''),
                  COALESCE(r."rowData"->>'FHINCD', ''),
                  COALESCE(r."rowData"->>'FSIGENCD', ''),
                  COALESCE(r."rowData"->>'FKOJUN', '')
                ORDER BY
                  CASE
                    WHEN (r."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (r."rowData"->>'ProductNo')::bigint
                    ELSE -1
                  END DESC,
                  r."createdAt" DESC,
                  r."id" DESC
              ) AS rn
            FROM "CsvDashboardRow" AS r
            INNER JOIN keys AS k
              ON COALESCE(r."rowData"->>'FSEIBAN', '') = COALESCE(k."FSEIBAN", '')
             AND COALESCE(r."rowData"->>'FHINCD', '') = COALESCE(k."FHINCD", '')
             AND COALESCE(r."rowData"->>'FSIGENCD', '') = COALESCE(k."FSIGENCD", '')
             AND COALESCE(r."rowData"->>'FKOJUN', '') = COALESCE(k."FKOJUN", '')
            WHERE r."csvDashboardId" = ${params.csvDashboardId}
          ),
          to_delete AS (
            SELECT "id" FROM ranked WHERE rn > 1 LIMIT ${deleteBatchSize}
          )
          DELETE FROM "CsvDashboardRow"
          WHERE "id" IN (SELECT "id" FROM to_delete);
        `);

        const affectedCount = typeof affected === 'number' ? affected : 0;
        deletedCount += affectedCount;
        if (affectedCount === 0) {
          break;
        }
      }
    }

    return { deletedCount };
  }

  /**
   * 生産スケジュール全体に対して重複 loser を削除する（日次ジョブ用）。
   */
  async deleteDuplicateLosersGlobal(params: {
    csvDashboardId: string;
    deleteBatchSize?: number;
  }): Promise<{ deletedCount: number }> {
    const deleteBatchSize = Math.max(100, Math.min(params.deleteBatchSize ?? 5000, 50000));
    let deletedCount = 0;

    for (;;) {
      const affected = await prisma.$executeRaw<number>(Prisma.sql`
        WITH ranked AS (
          SELECT
            r."id" AS "id",
            ROW_NUMBER() OVER (
              PARTITION BY
                r."csvDashboardId",
                COALESCE(r."rowData"->>'FSEIBAN', ''),
                COALESCE(r."rowData"->>'FHINCD', ''),
                COALESCE(r."rowData"->>'FSIGENCD', ''),
                COALESCE(r."rowData"->>'FKOJUN', '')
              ORDER BY
                CASE
                  WHEN (r."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (r."rowData"->>'ProductNo')::bigint
                  ELSE -1
                END DESC,
                r."createdAt" DESC,
                r."id" DESC
            ) AS rn
          FROM "CsvDashboardRow" AS r
          WHERE r."csvDashboardId" = ${params.csvDashboardId}
        ),
        to_delete AS (
          SELECT "id" FROM ranked WHERE rn > 1 LIMIT ${deleteBatchSize}
        )
        DELETE FROM "CsvDashboardRow"
        WHERE "id" IN (SELECT "id" FROM to_delete);
      `);

      const affectedCount = typeof affected === 'number' ? affected : 0;
      deletedCount += affectedCount;
      if (affectedCount === 0) {
        break;
      }
    }

    return { deletedCount };
  }

  /**
   * 取り込みで使いやすい logicalKey 抽出ヘルパー。
   */
  static extractLogicalKeysFromRows(params: {
    rows: Array<{ data: unknown }>;
    maxKeys?: number;
  }): ProductionScheduleLogicalKey[] {
    const maxKeys = Math.max(1, Math.min(params.maxKeys ?? 5000, 50000));
    const seen = new Set<string>();
    const result: ProductionScheduleLogicalKey[] = [];

    for (const row of params.rows) {
      const key = extractLogicalKey(row.data);
      const signature = PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.map((c) =>
        (key as Record<string, string>)[c] ?? ''
      ).join('\t');
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      result.push(key);
      if (result.length >= maxKeys) {
        break;
      }
    }

    return result;
  }

  /**
   * スケジューラ等から呼ぶための集約実行（ログ付与）。
   */
  async runDailyCleanup(params: { csvDashboardId: string; nowUtc?: Date }): Promise<{
    deletedExpiredRowsOneYear: number;
    deletedDuplicateLosers: number;
    thresholdUtc: Date;
  }> {
    const nowUtc = params.nowUtc ?? new Date();
    const { deletedCount: deletedExpiredRowsOneYear, thresholdUtc } = await this.deleteExpiredRowsOneYear({
      csvDashboardId: params.csvDashboardId,
      nowUtc,
    });
    const { deletedCount: deletedDuplicateLosers } = await this.deleteDuplicateLosersGlobal({
      csvDashboardId: params.csvDashboardId,
    });

    logger?.info(
      { csvDashboardId: params.csvDashboardId, deletedExpiredRowsOneYear, deletedDuplicateLosers, thresholdUtc },
      '[ProductionScheduleCleanupService] Daily cleanup completed'
    );

    return { deletedExpiredRowsOneYear, deletedDuplicateLosers, thresholdUtc };
  }
}

