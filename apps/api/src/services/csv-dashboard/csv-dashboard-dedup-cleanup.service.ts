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
  /**
   * 指定時は削除候補を dataHash がこの中にある行へ絞る（[csvDashboardId, dataHash] index を使う）。
   * 同じキー値の行は同じ dataHash を持つので、キー一致の判定はそのまま残しつつ
   * ダッシュボード全行の JSON 列走査を避けられる。
   */
  dataHashes?: string[];
} & CleanupBatchOptions;

type CleanupDuplicateLosersGloballyParams = {
  csvDashboardId: string;
  keyColumns: string[];
  winnerOrder: WinnerOrderSpec[];
  deleteBatchSize?: number;
  scanLimit?: number;
  maxScans?: number;
  deadline?: Date;
  maxDeletedCount?: number;
  pauseRatio?: number;
  minPauseMs?: number;
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
  constructor(private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  async deleteDuplicateLosersForKeys(params: CleanupDuplicateLosersParams): Promise<{ deletedCount: number }> {
    const keyColumns = params.keyColumns.filter((v) => v.trim().length > 0);
    const normalizedKeys = this.normalizeKeys(params.keys, keyColumns);
    if (keyColumns.length === 0 || normalizedKeys.length === 0) {
      return { deletedCount: 0 };
    }

    const dataHashes =
      params.dataHashes === undefined
        ? undefined
        : [...new Set(params.dataHashes.filter((hash) => hash.length > 0))];
    if (dataHashes !== undefined && dataHashes.length === 0) {
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
    const dataHashScopeSql =
      dataHashes === undefined ? Prisma.empty : Prisma.sql`AND r."dataHash" = ANY(${dataHashes}::text[])`;

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
              ${dataHashScopeSql}
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

  async deleteDuplicateLosersGlobally(params: CleanupDuplicateLosersGloballyParams): Promise<{
    deletedCount: number;
    stoppedReason: 'completed' | 'deadline' | 'statement_timeout' | 'max_scans' | 'max_deleted';
    scans: number;
  }> {
    let deletedCount = 0;
    let scans = 0;
    const deadlineMs = params.deadline?.getTime();
    const deadlineReached = () => deadlineMs !== undefined && Date.now() >= deadlineMs;
    const maxDeletedCount = Math.max(0, Math.floor(params.maxDeletedCount ?? Infinity));
    const pause = async (elapsedMs: number) => {
      const pauseMs = Math.min(30000, Math.max(params.minPauseMs ?? 0, elapsedMs * (params.pauseRatio ?? 0)));
      const remainingMs = deadlineMs === undefined ? Infinity : Math.max(0, deadlineMs - Date.now());
      if (pauseMs > 0 && remainingMs > 0) await this.sleep(Math.min(pauseMs, remainingMs));
      return deadlineReached();
    };
    const keyColumns = params.keyColumns.filter((v) => v.trim().length > 0);
    if (keyColumns.length === 0) {
      return { deletedCount, stoppedReason: 'completed', scans };
    }
    const winnerOrder = params.winnerOrder.length > 0 ? params.winnerOrder : this.defaultWinnerOrder();
    const deleteBatchSize = Math.max(100, Math.min(params.deleteBatchSize ?? 5000, 50000));
    const scanLimit = Math.max(1000, Math.min(params.scanLimit ?? 200000, 500000));
    const maxScans = Math.max(1, Math.min(params.maxScans ?? 50, 100000));
    const rankedPartitionSql = this.buildPartitionBySql(keyColumns);
    const winnerOrderSql = this.buildWinnerOrderSql(winnerOrder);

    while (scans < maxScans) {
      if (deadlineReached()) {
        return { deletedCount, stoppedReason: 'deadline', scans };
      }
      if (deletedCount >= maxDeletedCount) {
        return { deletedCount, stoppedReason: 'max_deleted', scans };
      }
      const statementTimeoutMs = Math.max(1000, deadlineMs === undefined ? 30 * 60 * 1000 : deadlineMs - Date.now());
      const scanStartedAt = Date.now();
      let losers: Array<{ id: string }>;
      try {
        losers = await prisma.$transaction(async (tx) => {
          // Recheck after acquiring a connection; pool waiting also consumes the deadline.
          if (deadlineReached()) return [];
          const remainingMs = Math.max(1000, deadlineMs === undefined ? statementTimeoutMs : deadlineMs - Date.now());
          // SET does not accept bind parameters; this literal is computed only from milliseconds.
          await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = ${Prisma.raw(String(remainingMs))}`);
          scans++;
          return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            WITH ranked AS (
              SELECT
                r."id" AS "id",
                ROW_NUMBER() OVER (
                  PARTITION BY r."csvDashboardId", ${rankedPartitionSql}
                  ORDER BY ${winnerOrderSql}
                ) AS rn
              FROM "CsvDashboardRow" AS r
              WHERE r."csvDashboardId" = ${params.csvDashboardId}
            )
            SELECT "id" FROM ranked WHERE rn > 1 LIMIT ${scanLimit}
          `);
        }, { timeout: statementTimeoutMs + 5000 });
      } catch (error) {
        const details = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
        if (/57014|statement timeout/i.test(`${details?.code} ${details?.message} ${details?.meta?.code} ${details?.meta?.message}`)) {
          return { deletedCount, stoppedReason: 'statement_timeout', scans };
        }
        throw error;
      }
      if (deadlineReached()) {
        return { deletedCount, stoppedReason: 'deadline', scans };
      }
      if (losers.length === 0) {
        return { deletedCount, stoppedReason: 'completed', scans };
      }
      if (await pause(Date.now() - scanStartedAt)) {
        return { deletedCount, stoppedReason: 'deadline', scans };
      }
      const chunks = chunk(losers.map((row) => row.id), deleteBatchSize);
      for (const [index, candidates] of chunks.entries()) {
        if (deadlineReached()) {
          return { deletedCount, stoppedReason: 'deadline', scans };
        }
        const ids = candidates.slice(0, maxDeletedCount - deletedCount);
        const chunkStartedAt = Date.now();
        const affected = await prisma.$executeRaw<number>(Prisma.sql`
          DELETE FROM "CsvDashboardRow" WHERE "id" = ANY(${ids}::text[])
        `);
        deletedCount += typeof affected === 'number' ? affected : 0;
        if (deletedCount >= maxDeletedCount) {
          return { deletedCount, stoppedReason: 'max_deleted', scans };
        }
        if ((index < chunks.length - 1 || scans < maxScans) && await pause(Date.now() - chunkStartedAt)) {
          return { deletedCount, stoppedReason: 'deadline', scans };
        }
      }
    }
    return { deletedCount, stoppedReason: 'max_scans', scans };
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

