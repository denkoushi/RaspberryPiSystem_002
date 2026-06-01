import { LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION } from './leaderboardBoardCacheConstants';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';
import type {
  AccumulatedLeaderboardDecorations,
  LeaderboardRowDecoration
} from '../mergeLeaderboardBoardWithDecorations';

const DEFAULT_LEADERBOARD_ROW_DECORATION: LeaderboardRowDecoration = {
  resolvedMachineName: null,
  customerName: null,
  hasSelfInspectionDrawing: false,
  selfInspectionStatus: null,
  selfInspectionEntryPath: null
};

function normalizeLeaderboardRowDecoration(
  raw: Partial<LeaderboardRowDecoration> | undefined
): LeaderboardRowDecoration {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_LEADERBOARD_ROW_DECORATION };
  }
  return {
    resolvedMachineName: raw.resolvedMachineName ?? null,
    customerName: raw.customerName ?? null,
    hasSelfInspectionDrawing: raw.hasSelfInspectionDrawing === true,
    selfInspectionStatus: raw.selfInspectionStatus ?? null,
    selfInspectionEntryPath: raw.selfInspectionEntryPath ?? null
  };
}

export type PersistedLeaderboardBoardCacheRecord = {
  schemaVersion: typeof LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION;
  cacheKey: string;
  siteKey: string;
  paramsKey: string;
  savedAt: number;
  rowIdsFingerprint: string;
  board: ProductionScheduleLeaderboardBoardResponse;
  decorations: {
    rowDecorationsById: Record<
      string,
      {
        resolvedMachineName: string | null;
        customerName: string | null;
        hasSelfInspectionDrawing: boolean;
        selfInspectionStatus: 'not_started' | 'in_progress' | 'completed' | null;
        selfInspectionEntryPath: string | null;
      }
    >;
    leaderboardFooterChipsByPartKey: Record<string, unknown>;
  };
};

export function fingerprintLeaderboardBoardRowIds(
  board: ProductionScheduleLeaderboardBoardResponse
): string {
  return board.rows.map((r) => r.id).join('\u0001');
}

/** continue 完走済みか（保存・hydrate 対象） */
export function isCompleteLeaderboardBoardSnapshot(
  board: ProductionScheduleLeaderboardBoardResponse
): boolean {
  if (board.resources.length === 0) return board.rows.length === board.total;
  const allDone = board.resources.every((r) => !r.hasMore);
  if (!allDone) return false;
  return board.rows.length === board.total;
}

export function serializeAccumulatedDecorations(
  decorations: AccumulatedLeaderboardDecorations
): PersistedLeaderboardBoardCacheRecord['decorations'] {
  const rowDecorationsById: PersistedLeaderboardBoardCacheRecord['decorations']['rowDecorationsById'] =
    {};
  decorations.rowDecorationsById.forEach((value, id) => {
    rowDecorationsById[id] = value;
  });
  return {
    rowDecorationsById,
    leaderboardFooterChipsByPartKey: { ...decorations.leaderboardFooterChipsByPartKey }
  };
}

export function deserializeAccumulatedDecorations(
  persisted: PersistedLeaderboardBoardCacheRecord['decorations']
): AccumulatedLeaderboardDecorations {
  const rowDecorationsById = new Map<string, LeaderboardRowDecoration>();
  for (const [id, raw] of Object.entries(persisted.rowDecorationsById ?? {})) {
    rowDecorationsById.set(id, normalizeLeaderboardRowDecoration(raw));
  }
  return {
    rowDecorationsById,
    leaderboardFooterChipsByPartKey: persisted.leaderboardFooterChipsByPartKey as AccumulatedLeaderboardDecorations['leaderboardFooterChipsByPartKey']
  };
}

export function buildLeaderboardBoardCacheRecord(input: {
  cacheKey: string;
  siteKey: string;
  paramsKey: string;
  board: ProductionScheduleLeaderboardBoardResponse;
  decorations: AccumulatedLeaderboardDecorations;
  savedAt?: number;
}): PersistedLeaderboardBoardCacheRecord | null {
  if (!isCompleteLeaderboardBoardSnapshot(input.board)) return null;
  return {
    schemaVersion: LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION,
    cacheKey: input.cacheKey,
    siteKey: input.siteKey,
    paramsKey: input.paramsKey,
    savedAt: input.savedAt ?? Date.now(),
    rowIdsFingerprint: fingerprintLeaderboardBoardRowIds(input.board),
    board: input.board,
    decorations: serializeAccumulatedDecorations(input.decorations)
  };
}

export function parseLeaderboardBoardCacheRecord(
  raw: unknown
): PersistedLeaderboardBoardCacheRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Partial<PersistedLeaderboardBoardCacheRecord>;
  if (rec.schemaVersion !== LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION) return null;
  if (typeof rec.cacheKey !== 'string' || rec.cacheKey.trim().length === 0) return null;
  if (typeof rec.paramsKey !== 'string') return null;
  if (typeof rec.savedAt !== 'number' || !Number.isFinite(rec.savedAt)) return null;
  if (!rec.board || typeof rec.board !== 'object') return null;
  if (!rec.decorations || typeof rec.decorations !== 'object') return null;
  const board = rec.board as ProductionScheduleLeaderboardBoardResponse;
  if (!isCompleteLeaderboardBoardSnapshot(board)) return null;
  if (rec.rowIdsFingerprint !== fingerprintLeaderboardBoardRowIds(board)) return null;
  return rec as PersistedLeaderboardBoardCacheRecord;
}

export function isLeaderboardBoardCacheWithinMaxAge(
  savedAt: number,
  nowMs: number,
  maxAgeMs: number
): boolean {
  return nowMs - savedAt <= maxAgeMs;
}
