import { resolveSeibanMachineDisplayNamesBatched } from './seiban-machine-display-names.service.js';

type ProductionScheduleLikeRow = {
  rowData: unknown;
};

export type RowWithResolvedMachineName<T> = T & {
  resolvedMachineName: string | null;
};

const readFseiban = (rowData: unknown): string => {
  if (!rowData || typeof rowData !== 'object') return '';
  const value = (rowData as Record<string, unknown>).FSEIBAN;
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * 生産日程一覧系レスポンスへ「表示用機種名」を付与する。
 * 解決順序は resolveSeibanMachineDisplayNamesBatched 側の既存仕様をそのまま使う。
 */
export async function enrichProductionScheduleRowsWithResolvedMachineName<T extends ProductionScheduleLikeRow>(
  rows: readonly T[]
): Promise<Array<RowWithResolvedMachineName<T>>> {
  const fseibans = rows
    .map((row) => readFseiban(row.rowData))
    .filter((fseiban) => fseiban.length > 0);

  const resolved = await resolveSeibanMachineDisplayNamesBatched(fseibans);

  return rows.map((row) => {
    const fseiban = readFseiban(row.rowData);
    const machineName = fseiban.length > 0 ? resolved.machineNames[fseiban] ?? null : null;
    return {
      ...row,
      resolvedMachineName: machineName,
    };
  });
}
