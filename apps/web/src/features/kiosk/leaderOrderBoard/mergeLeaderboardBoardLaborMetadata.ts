import type {
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleRow
} from '../../../api/client';

export type LeaderboardLaborMetadata = {
  machineRequiredMinutes: number;
  laborRequiredMinutes: number;
};

export function readLeaderboardLaborMetadata(row: ProductionScheduleRow): LeaderboardLaborMetadata | null {
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

export function collectLeaderboardBoardLaborMetadata(
  board: ProductionScheduleLeaderboardBoardResponse | undefined,
  metadataById: Map<string, LeaderboardLaborMetadata>
): boolean {
  if (!board) return false;

  let changed = false;
  const rows = board.deltaRows != null ? [...board.rows, ...board.deltaRows] : board.rows;
  for (const row of rows) {
    const metadata = readLeaderboardLaborMetadata(row);
    if (!metadata) continue;

    const previous = metadataById.get(row.id);
    if (
      previous != null &&
      previous.machineRequiredMinutes === metadata.machineRequiredMinutes &&
      previous.laborRequiredMinutes === metadata.laborRequiredMinutes
    ) {
      continue;
    }

    metadataById.set(row.id, metadata);
    changed = true;
  }

  return changed;
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
  freshBoard: ProductionScheduleLeaderboardBoardResponse | undefined,
  retainedMetadataById?: ReadonlyMap<string, LeaderboardLaborMetadata>
): ProductionScheduleLeaderboardBoardResponse | undefined {
  if (!displayBoard) return displayBoard;

  const metadataById = new Map<string, LeaderboardLaborMetadata>(retainedMetadataById);
  if (freshBoard) {
    collectLeaderboardBoardLaborMetadata(freshBoard, metadataById);
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
