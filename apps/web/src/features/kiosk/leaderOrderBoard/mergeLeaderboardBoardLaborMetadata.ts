import type {
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleRow
} from '../../../api/client';

type LeaderboardLaborMetadata = {
  machineRequiredMinutes: number;
  laborRequiredMinutes: number;
};

function readLaborMetadata(row: ProductionScheduleRow): LeaderboardLaborMetadata | null {
  const { machineRequiredMinutes, laborRequiredMinutes } = row;
  if (
    typeof machineRequiredMinutes !== 'number' ||
    !Number.isFinite(machineRequiredMinutes) ||
    typeof laborRequiredMinutes !== 'number' ||
    !Number.isFinite(laborRequiredMinutes)
  ) {
    return null;
  }
  return {
    machineRequiredMinutes: Math.max(0, machineRequiredMinutes),
    laborRequiredMinutes: Math.max(0, laborRequiredMinutes)
  };
}

function patchRowsWithLaborMetadata(
  rows: readonly ProductionScheduleRow[],
  metadataById: ReadonlyMap<string, LeaderboardLaborMetadata>
): { rows: ProductionScheduleRow[]; changed: boolean } {
  let changed = false;
  const patchedRows = rows.map((row) => {
    const metadata = metadataById.get(row.id);
    if (!metadata) return row;
    if (
      row.machineRequiredMinutes === metadata.machineRequiredMinutes &&
      row.laborRequiredMinutes === metadata.laborRequiredMinutes
    ) {
      return row;
    }
    changed = true;
    return {
      ...row,
      machineRequiredMinutes: metadata.machineRequiredMinutes,
      laborRequiredMinutes: metadata.laborRequiredMinutes
    };
  });
  return { rows: patchedRows, changed };
}

export function mergeLeaderboardBoardLaborMetadataForDisplay(
  displayBoard: ProductionScheduleLeaderboardBoardResponse | undefined,
  freshBoard: ProductionScheduleLeaderboardBoardResponse | undefined
): ProductionScheduleLeaderboardBoardResponse | undefined {
  if (!displayBoard || !freshBoard || displayBoard === freshBoard) return displayBoard;

  const metadataById = new Map<string, LeaderboardLaborMetadata>();
  for (const row of freshBoard.rows) {
    const metadata = readLaborMetadata(row);
    if (metadata) metadataById.set(row.id, metadata);
  }
  if (metadataById.size === 0) return displayBoard;

  const patchedRows = patchRowsWithLaborMetadata(displayBoard.rows, metadataById);
  const patchedDeltaRows =
    displayBoard.deltaRows != null
      ? patchRowsWithLaborMetadata(displayBoard.deltaRows, metadataById)
      : undefined;

  if (!patchedRows.changed && patchedDeltaRows?.changed !== true) {
    return displayBoard;
  }

  return {
    ...displayBoard,
    rows: patchedRows.rows,
    ...(patchedDeltaRows != null ? { deltaRows: patchedDeltaRows.rows } : {})
  };
}
