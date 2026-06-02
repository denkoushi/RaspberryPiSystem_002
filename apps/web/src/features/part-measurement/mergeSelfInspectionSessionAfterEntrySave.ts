import type { SelfInspectionLotEntryDto, SelfInspectionSessionDetailDto } from './types';
import type { QueryClient } from '@tanstack/react-query';

/** 保存後に同一セッションの全 entryIndex キャッシュへ件数メタを同期する */
export function applySelfInspectionEntrySaveToSessionCache(
  previous: SelfInspectionSessionDetailDto | undefined,
  savedEntry: SelfInspectionLotEntryDto,
  queryEntryIndex: number | null | undefined
): SelfInspectionSessionDetailDto | undefined {
  if (!previous) {
    return previous;
  }

  const entryIndex = savedEntry.entryIndex;
  const hasIndex = previous.entries.some((row) => row.entryIndex === entryIndex);
  const entries = hasIndex
    ? previous.entries.map((row) =>
        row.entryIndex === entryIndex
          ? {
              ...row,
              id: savedEntry.id,
              updatedAt: savedEntry.updatedAt,
              values: []
            }
          : row
      )
    : [
        ...previous.entries,
        {
          id: savedEntry.id,
          entryIndex: savedEntry.entryIndex,
          entrySlotKind: savedEntry.entrySlotKind,
          entrySlotLabel: savedEntry.entrySlotLabel,
          createdByEmployeeId: savedEntry.createdByEmployeeId,
          createdByEmployeeNameSnapshot: savedEntry.createdByEmployeeNameSnapshot,
          createdAt: savedEntry.createdAt,
          updatedAt: savedEntry.updatedAt,
          values: []
        }
      ].sort((left, right) => left.entryIndex - right.entryIndex);

  const completedEntryCount = entries.length;
  const status = previous.completedAt
    ? 'completed'
    : completedEntryCount <= 0
      ? 'not_started'
      : 'in_progress';

  const focusedEntry = queryEntryIndex === entryIndex ? savedEntry : (previous.focusedEntry ?? null);

  return {
    ...previous,
    entries,
    completedEntryCount,
    status,
    focusedEntry
  };
}

export function patchSelfInspectionSessionCachesAfterEntrySave(
  queryClient: QueryClient,
  sessionId: string,
  savedEntry: SelfInspectionLotEntryDto
): void {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: ['self-inspection-session', sessionId]
  });

  for (const query of queries) {
    const keyEntryIndex = query.queryKey[2];
    const queryEntryIndex =
      typeof keyEntryIndex === 'number' && Number.isFinite(keyEntryIndex) ? keyEntryIndex : null;
    queryClient.setQueryData<SelfInspectionSessionDetailDto>(query.queryKey, (previous) =>
      applySelfInspectionEntrySaveToSessionCache(previous, savedEntry, queryEntryIndex)
    );
  }

  if (queries.length === 0) {
    queryClient.setQueryData<SelfInspectionSessionDetailDto>(
      ['self-inspection-session', sessionId, savedEntry.entryIndex],
      (previous) => applySelfInspectionEntrySaveToSessionCache(previous, savedEntry, savedEntry.entryIndex)
    );
  }
}
