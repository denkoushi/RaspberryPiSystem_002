import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type CleanupBatchOptions = {
  deleteBatchSize?: number;
  keyChunkSize?: number;
};

type WinnerOrderSpec = {
  expression: Prisma.Sql;
  direction: 'ASC' | 'DESC';
};

type CleanupDuplicateLosersParams = {
  csvDashboardId: string;
  keyColumns: string[];
  keys: Array<Record<string, string>>;
  winnerOrder: WinnerOrderSpec[];
} & CleanupBatchOptions;

type CleanupDuplicateLosersGloballyParams = {
  csvDashboardId: string;
  keyColumns: string[];
  winnerOrder: WinnerOrderSpec[];
  deleteBatchSize?: number;
  maxBatches?: number;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const toSafeColumnIdentifier = (column: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error(`Invalid rowData key column: ${column}`);
  }
  return column;
};

const toSqlDirection = (direction: WinnerOrderSpec['direction']): Prisma.Sql => {
  return direction === 'ASC' ? Prisma.raw('ASC') : Prisma.raw('DESC');
};

/**
 * CSVダッシュボード共通の重複 loser 削除サービス。
 * - キー列は呼び出し側から注入（dashboard別の重複定義を許容）
 * - winner順序は呼び出し側から注入（既存ProductionSchedule互換を維持）
 */
export class CsvDashboardDedupCleanupService {
  async deleteDuplicateLosersForKeys(params: CleanupDuplicateLosersParams): Promise<{ deletedCount: number }> {
    const keyColumns = params.keyColumns.filter((v) => v.trim().length > 0);
    const normalizedKeys = this.normalizeKeys(params.keys, keyColumns);
    if (keyColumns.length === 0 || normalizedKeys.length === 0) {
      return { deletedCount: 0 };
    }

    const winnerOrder = params.winnerOrder.length > 0 ? params.winnerOrder : this.defaultWinnerOrder();
    const deleteBatchSize = Math.max(100, Math.min(params.deleteBatchSize ?? 5000, 50000));
    const keyChunkSize = Math.max(50, Math.min(params.keyChunkSize ?? 300, 2000));

    let deletedCount = 0;
    const keyChunks = chunk(normalizedKeys, keyChunkSize);
    const rankedPartitionSql = this.buildPartitionBySql(keyColumns);
    const keyJoinSql = this.buildJoinSql(keyColumns);
    const winnerOrderSql = this.buildWinnerOrderSql(winnerOrder);

    for (const keyChunk of keyChunks) {
      for (;;) {
        const valuesSql = Prisma.join(
          keyChunk.map((key) => Prisma.sql`(${Prisma.join(keyColumns.map((column) => key[column]))})`),
          ', '
        );

        const keyColumnsSql = Prisma.join(keyColumns.map((column) => Prisma.raw(`"${column}"`)), ', ');
        const affected = await prisma.$executeRaw<number>(Prisma.sql`
          WITH keys(${keyColumnsSql}) AS (
            VALUES ${valuesSql}
          ),
          ranked AS (
            SELECT
              r."id" AS "id",
              ROW_NUMBER() OVER (
                PARTITION BY r."csvDashboardId", ${rankedPartitionSql}
                ORDER BY ${winnerOrderSql}
              ) AS rn
            FROM "CsvDashboardRow" AS r
            INNER JOIN keys AS k
              ON ${keyJoinSql}
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

  async deleteDuplicateLosersGlobally(params: CleanupDuplicateLosersGloballyParams): Promise<{ deletedCount: number }> {
    const keyColumns = params.keyColumns.filter((v) => v.trim().length > 0);
    if (keyColumns.length === 0) {
      return { deletedCount: 0 };
    }
    const winnerOrder = params.winnerOrder.length > 0 ? params.winnerOrder : this.defaultWinnerOrder();
    const deleteBatchSize = Math.max(100, Math.min(params.deleteBatchSize ?? 5000, 50000));
    const maxBatches = Math.max(1, Math.min(params.maxBatches ?? 1000, 100000));

    const rankedPartitionSql = this.buildPartitionBySql(keyColumns);
    const winnerOrderSql = this.buildWinnerOrderSql(winnerOrder);

    let deletedCount = 0;
    for (let i = 0; i < maxBatches; i++) {
      const affected = await prisma.$executeRaw<number>(Prisma.sql`
        WITH ranked AS (
          SELECT
            r."id" AS "id",
            ROW_NUMBER() OVER (
              PARTITION BY r."csvDashboardId", ${rankedPartitionSql}
              ORDER BY ${winnerOrderSql}
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

  private normalizeKeys(keys: Array<Record<string, string>>, keyColumns: string[]): Array<Record<string, string>> {
    const deduped = new Map<string, Record<string, string>>();
    for (const key of keys) {
      const normalized: Record<string, string> = {};
      for (const column of keyColumns) {
        normalized[column] = (key[column] ?? '').trim();
      }
      const signature = keyColumns.map((column) => normalized[column]).join('\t');
      if (!deduped.has(signature)) {
        deduped.set(signature, normalized);
      }
    }
    return Array.from(deduped.values());
  }

  private buildPartitionBySql(keyColumns: string[]): Prisma.Sql {
    return Prisma.join(
      keyColumns.map((column) => {
        const safeColumn = toSafeColumnIdentifier(column);
        return Prisma.raw(`COALESCE(r."rowData"->>'${safeColumn}', '')`);
      }),
      ', '
    );
  }

  private buildJoinSql(keyColumns: string[]): Prisma.Sql {
    return Prisma.join(
      keyColumns.map((column) => {
        const safeColumn = toSafeColumnIdentifier(column);
        return Prisma.raw(`COALESCE(r."rowData"->>'${safeColumn}', '') = COALESCE(k."${safeColumn}", '')`);
      }),
      ' AND '
    );
  }

  private buildWinnerOrderSql(winnerOrder: WinnerOrderSpec[]): Prisma.Sql {
    return Prisma.join(
      winnerOrder.map((order) => Prisma.sql`${order.expression} ${toSqlDirection(order.direction)}`),
      ', '
    );
  }

  private defaultWinnerOrder(): WinnerOrderSpec[] {
    return [
      { expression: Prisma.sql`r."createdAt"`, direction: 'DESC' },
      { expression: Prisma.sql`r."id"`, direction: 'DESC' },
    ];
  }
}

