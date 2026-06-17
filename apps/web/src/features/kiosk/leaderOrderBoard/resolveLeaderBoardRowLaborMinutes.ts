import { parseLeaderBoardRequiredMinutes } from './parseLeaderBoardRequiredMinutes';

import type { ProductionScheduleRow } from '../../../api/client';

export type LeaderBoardRowLaborFields = {
  machineRequiredMinutes: number;
  laborRequiredMinutes: number;
};

export function resolveLeaderBoardRowLaborFields(row: ProductionScheduleRow): LeaderBoardRowLaborFields {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const machine =
    typeof row.machineRequiredMinutes === 'number' && Number.isFinite(row.machineRequiredMinutes)
      ? Math.max(0, row.machineRequiredMinutes)
      : parseLeaderBoardRequiredMinutes(data.FSIGENSHOYORYO);
  const labor =
    typeof row.laborRequiredMinutes === 'number' && Number.isFinite(row.laborRequiredMinutes)
      ? Math.max(0, row.laborRequiredMinutes)
      : 0;
  return { machineRequiredMinutes: machine, laborRequiredMinutes: labor };
}

export function computeLeaderBoardDisplayRequiredMinutes(
  machineRequiredMinutes: number,
  laborRequiredMinutes: number,
  includeLabor: boolean
): number {
  const machine = Math.max(0, machineRequiredMinutes);
  const labor = Math.max(0, laborRequiredMinutes);
  return includeLabor ? machine + labor : machine;
}
