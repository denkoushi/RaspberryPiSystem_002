
import { areRequiredSelfInspectionSlotsFilled } from './selfInspectionEntrySlots';

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
              createdByEmployeeId: savedEntry.createdByEmployeeId,
              createdByEmployeeNameSnapshot: savedEntry.createdByEmployeeNameSnapshot,
              measuringInstrumentId: savedEntry.measuringInstrumentId,
              measuringInstrumentManagementNumberSnapshot:
                savedEntry.measuringInstrumentManagementNumberSnapshot,
              measuringInstrumentNameSnapshot: savedEntry.measuringInstrumentNameSnapshot,
              measuringInstrumentTagUidSnapshot: savedEntry.measuringInstrumentTagUidSnapshot,
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
              measuringInstrumentId: savedEntry.measuringInstrumentId,
              measuringInstrumentManagementNumberSnapshot:
                savedEntry.measuringInstrumentManagementNumberSnapshot,
              measuringInstrumentNameSnapshot: savedEntry.measuringInstrumentNameSnapshot,
              measuringInstrumentTagUidSnapshot: savedEntry.measuringInstrumentTagUidSnapshot,
              createdAt: savedEntry.createdAt,
          updatedAt: savedEntry.updatedAt,
          values: []
        }
      ].sort((left, right) => left.entryIndex - right.entryIndex);

  const completedEntryCount = entries.length;
  const previousFocusedPendingCount =
    previous.focusedEntry?.entryIndex === entryIndex
      ? previous.focusedEntry.values.filter((value) => value.reviewStatus === 'PENDING').length
      : 0;
  const savedPendingCount = savedEntry.values.filter((value) => value.reviewStatus === 'PENDING').length;
  const pendingReviewCount = Math.max(
    0,
    (previous.pendingReviewCount ?? 0) - previousFocusedPendingCount + savedPendingCount
  );

  const focusedEntry = queryEntryIndex === entryIndex ? savedEntry : (previous.focusedEntry ?? null);
  const nextSessionForStatus = {
    ...previous,
    entries,
    completedEntryCount,
    pendingReviewCount,
    focusedEntry
  };
  const status = previous.completedAt
    ? 'completed'
    : completedEntryCount <= 0
      ? 'not_started'
      : pendingReviewCount > 0 && areRequiredSelfInspectionSlotsFilled(nextSessionForStatus)
        ? 'review_pending'
      : 'in_progress';

  return {
    ...previous,
    entries,
    completedEntryCount,
    pendingReviewCount,
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
