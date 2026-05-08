import type { Prisma } from '@prisma/client';

/**
 * PostgreSQL prepared statement はバインド変数に上限がある（典型値 32767）。
 * `where: { csvDashboardId, dataHash: { in: [...] } }` は 1 + N 個のバインドとなる。
 */
export const POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS = 32767;

/** DEDUP 取り込み時の既存行取得で、1クエリあたりに載せる dataHash 件数の既定値（余裕を持たせる） */
export const CSV_DASHBOARD_DATA_HASH_FINDMANY_DEFAULT_CHUNK_SIZE = 10_000;

const EXISTING_ROW_SELECT = {
  id: true,
  dataHash: true,
  occurredAt: true,
  rowData: true,
} as const;

export type CsvDashboardExistingRowByHash = Prisma.CsvDashboardRowGetPayload<{
  select: typeof EXISTING_ROW_SELECT;
}>;

export type CsvDashboardRowFindManyByHashClient = {
  findMany(args: {
    where: { csvDashboardId: string; dataHash: { in: string[] } };
    select: typeof EXISTING_ROW_SELECT;
  }): Promise<CsvDashboardExistingRowByHash[]>;
};

/**
 * 1回の findMany で安全に扱える dataHash の最大件数（csvDashboardId 分のバインドを除く）
 */
export function maxDataHashesPerFindManyQuery(): number {
  return POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS - 1;
}

/**
 * 大量の dataHash をチャンク分割して findMany し、結果を結合する。
 * - 入力の重複ハッシュは除去する
 * - chunkSize は上限を超えないようクランプする
 */
export async function findCsvDashboardRowsByDataHashes(params: {
  client: CsvDashboardRowFindManyByHashClient;
  csvDashboardId: string;
  dataHashes: string[];
  chunkSize?: number;
}): Promise<CsvDashboardExistingRowByHash[]> {
  const cap = maxDataHashesPerFindManyQuery();
  const requested = params.chunkSize ?? CSV_DASHBOARD_DATA_HASH_FINDMANY_DEFAULT_CHUNK_SIZE;
  const chunkSize = Math.min(Math.max(1, requested), cap);

  const unique = [...new Set(params.dataHashes.filter((h) => h.length > 0))];
  if (unique.length === 0) {
    return [];
  }

  const merged: CsvDashboardExistingRowByHash[] = [];
  // 逐次実行: 接続プール逼迫やDB負荷スパイクを避け、取り込み処理の予測可能性を優先する
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const rows = await params.client.findMany({
      where: {
        csvDashboardId: params.csvDashboardId,
        dataHash: { in: slice },
      },
      select: EXISTING_ROW_SELECT,
    });
    merged.push(...rows);
  }

  return merged;
}
