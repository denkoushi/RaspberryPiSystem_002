import { isAxiosError } from 'axios';
import { useCallback } from 'react';

import { normalizeDueDateInput } from '../productionSchedule/dueManagement';

import type { DuePickerState, FeedbackKind, PendingDueScopeUpdate } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';
import type { useKioskGrindingPlanningBoardDueDetail, useKioskGrindingPlanningBoardProgressive, useUpdateKioskGrindingPlanningBoardDueScope } from '../../../api/hooks';
import type { GrindingPlanningBoardDueScope } from '@raspi-system/shared-types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type Options = {
  dueDetailIdentityRef: MutableRefObject<string | null>;
  setDueDetailTargetFseiban: Dispatch<SetStateAction<string | null>>;
  setDueDetailFseiban: Dispatch<SetStateAction<string | null>>;
  setDuePickerState: Dispatch<SetStateAction<DuePickerState | null>>;
  setDueConflict: Dispatch<SetStateAction<boolean>>;
  setDueError: Dispatch<SetStateAction<string | null>>;
  dueDetailQuery: ReturnType<typeof useKioskGrindingPlanningBoardDueDetail>;
  dueDetailFseiban: string | null;
  allocation: PlanningBoardAllocation;
  dueConflict: boolean;
  hasPendingSeiban: ReturnType<typeof usePlanningBoardWriteQueue>['hasPendingSeiban'];
  pendingDueScope: PendingDueScopeUpdate | null;
  notify: (message: string, kind: FeedbackKind) => void;
  boardQuery: ReturnType<typeof useKioskGrindingPlanningBoardProgressive>;
  setRankConflict: Dispatch<SetStateAction<boolean>>;
  acceptRefreshedState: () => void;
  duePickerState: DuePickerState | null;
  writeBlocked: boolean;
  enqueueWrite: ReturnType<typeof usePlanningBoardWriteQueue>['enqueue'];
  updateDueScope: ReturnType<typeof useUpdateKioskGrindingPlanningBoardDueScope>;
  setPendingDueScope: Dispatch<SetStateAction<PendingDueScopeUpdate | null>>;
};

export function usePlanningBoardDueActions({
  dueDetailIdentityRef, setDueDetailTargetFseiban, setDueDetailFseiban, setDuePickerState,
  setDueConflict, setDueError, dueDetailQuery, dueDetailFseiban, allocation, dueConflict,
  hasPendingSeiban, pendingDueScope, notify, boardQuery, setRankConflict, acceptRefreshedState,
  duePickerState, writeBlocked, enqueueWrite, updateDueScope, setPendingDueScope
}: Options) {
  const openDueDetail = useCallback((fseiban: string) => {
    dueDetailIdentityRef.current = fseiban;
    setDueDetailTargetFseiban(fseiban);
    setDueDetailFseiban(fseiban);
    setDuePickerState(null);
    setDueConflict(false);
    setDueError(null);
  // Preserve the original dependencies; the page supplies stable React setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeDueDetail = useCallback(() => {
    dueDetailIdentityRef.current = null;
    setDuePickerState(null);
    setDueDetailFseiban(null);
    setDueConflict(false);
    setDueError(null);
  // Preserve the original dependencies; the page supplies stable React setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDuePicker = useCallback((scope: GrindingPlanningBoardDueScope, currentDueDate: string | null) => {
    const detail = dueDetailQuery.data;
    if (!dueDetailFseiban || !detail || allocation === 'original' || dueConflict || hasPendingSeiban(dueDetailFseiban) || pendingDueScope?.fseiban === dueDetailFseiban) return;
    setDueError(null);
    setDueConflict(false);
    setDuePickerState({
      fseiban: dueDetailFseiban,
      value: normalizeDueDateInput(currentDueDate),
      scope,
      snapshot: {
        sourceGenerationToken: detail.sourceGenerationToken,
        scopeRevision: detail.scopeRevision
      }
    });
  // Preserve the original dependencies; the page supplies stable React setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocation, dueConflict, dueDetailFseiban, dueDetailQuery.data, pendingDueScope, hasPendingSeiban]);

  const refreshDueDetail = useCallback(async () => {
    setDueError('最新状態を取得しています…');
    notify('最新状態を取得しています…', 'processing');
    try {
      const [detailResult, boardResult] = await Promise.all([dueDetailQuery.refetch(), boardQuery.refetch()]);
      if (detailResult.isError || boardResult.isError) {
        setDueError('最新状態を取得できませんでした。再試行してください。');
        return;
      }
      setDueConflict(false);
      setRankConflict(false);
      acceptRefreshedState();
      setDueError(null);
      notify('最新状態を取得しました。対象を選び直して再適用してください。', 'success');
    } catch {
      setDueError('最新状態を取得できませんでした。再試行してください。');
      notify('最新状態を取得できませんでした。再試行してください。', 'error');
    }
  // Preserve the original dependencies; the page supplies stable React setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardQuery, dueDetailQuery, notify, acceptRefreshedState]);

  const commitDueDate = useCallback((nextDueDate: string) => {
    const current = duePickerState;
    if (!current || allocation === 'original' || writeBlocked || hasPendingSeiban(current.fseiban)) return;
    const pendingUpdate: PendingDueScopeUpdate = { fseiban: current.fseiban, scope: current.scope, dueDate: nextDueDate,
      baseScopeRevision: current.snapshot.scopeRevision, responseScopeRevision: null };
    const accepted = enqueueWrite({ label: `${current.fseiban}の納期`, itemIds: [], seibans: [current.fseiban], wholeSeiban: true,
      apply: (display) => display,
      save: async () => {
        const result = await updateDueScope.mutateAsync({ fseiban: current.fseiban,
          payload: { ...current.snapshot, scope: current.scope, dueDate: nextDueDate } });
        setPendingDueScope((pending) => pending?.fseiban === current.fseiban
          ? { ...pending, responseScopeRevision: result.scopeRevision } : pending);
        // Scope writes invalidate item revisions without returning them. Read them before this seiban becomes editable again.
        const [detail, board] = await Promise.all([dueDetailQuery.refetch(), boardQuery.refetch()]);
        if (detail.isError || board.isError) throw new Error('納期保存後の最新状態を取得できませんでした。');
        return {};
      },
      onSaved: () => {
        setPendingDueScope((pending) => pending?.fseiban === current.fseiban ? null : pending);
        if (dueDetailIdentityRef.current === current.fseiban) { setDueConflict(false); setDueError(null); }
      },
      onFailed: (error) => {
        setPendingDueScope((pending) => pending?.fseiban === current.fseiban ? null : pending);
        if (dueDetailIdentityRef.current !== current.fseiban) return;
        const conflict = isAxiosError(error) && error.response?.status === 409;
        setDueConflict(conflict);
        setDueError(conflict ? '表示中の納期が更新されています。最新状態を取得してから再適用してください。' : '納期を保存できませんでした。最新状態を取得して確認してください。');
      }
    });
    if (accepted) { setPendingDueScope(pendingUpdate); setDuePickerState(null); }
  // Preserve the original dependencies; the page supplies stable React setters and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocation, boardQuery, dueDetailQuery, duePickerState, enqueueWrite, updateDueScope, writeBlocked, hasPendingSeiban]);

  return { openDueDetail, closeDueDetail, openDuePicker, refreshDueDetail, commitDueDate };
}
