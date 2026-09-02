import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getWorkInstructionPartCandidates } from '../../api/client';
import { useWorkInstructionGroup, useWorkInstructionGroups } from '../../api/hooks';
import {
  dedupeAndSortWorkInstructionTargets,
  normalizeWorkInstructionPartNumber
} from '../../lib/workInstructionRules';

export type WorkInstructionPartScanResult =
  | { ok: true; partNumber: string }
  | { ok: false };

const PART_CANDIDATE_PAGE_SIZE = 20;

export type WorkInstructionCandidateDialogState = {
  isOpen: boolean;
  matchedPrefix: string | null;
  candidates: Awaited<ReturnType<typeof getWorkInstructionPartCandidates>>['candidates'];
  offset: number;
  hasMore: boolean;
  isLoading: boolean;
  errorMessage: string | null;
};

const emptyCandidateDialogState: WorkInstructionCandidateDialogState = {
  isOpen: false,
  matchedPrefix: null,
  candidates: [],
  offset: 0,
  hasMore: false,
  isLoading: false,
  errorMessage: null
};

/**
 * 自主検査画面固有の要領書検索・選択状態を所有する。
 * HIDイベントやtoolbar表示はページに残し、API queryとviewer状態をここへ閉じ込める。
 */
export function useSelfInspectionWorkInstructions() {
  const [partNumber, setPartNumber] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [originalPartNumber, setOriginalPartNumber] = useState('');
  const [prefixLength, setPrefixLength] = useState(0);
  const [autoFallbackPending, setAutoFallbackPending] = useState(false);
  const [candidateDialog, setCandidateDialog] = useState<WorkInstructionCandidateDialogState>(emptyCandidateDialogState);
  const candidateRequestRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const groupsQuery = useWorkInstructionGroups(partNumber);
  const groupQuery = useWorkInstructionGroup(partNumber, selectedTarget ?? '');
  const targets = useMemo(
    () =>
      dedupeAndSortWorkInstructionTargets(
        (groupsQuery.data ?? []).map((group) => group.shootingTarget)
      ),
    [groupsQuery.data]
  );
  const exactGroupCount = groupsQuery.data?.length ?? 0;

  const originalCharacters = useMemo(() => Array.from(originalPartNumber), [originalPartNumber]);

  const cancelCandidateRequest = useCallback(() => {
    candidateRequestRef.current.generation += 1;
    candidateRequestRef.current.controller?.abort();
    candidateRequestRef.current.controller = null;
  }, []);

  useEffect(() => () => cancelCandidateRequest(), [cancelCandidateRequest]);

  const openCandidates = useCallback(async (prefix: string, fallback: boolean, offset = 0) => {
    cancelCandidateRequest();
    const generation = candidateRequestRef.current.generation;
    const controller = new AbortController();
    candidateRequestRef.current.controller = controller;
    setCandidateDialog((current) => ({
      ...current,
      isOpen: true,
      candidates: [],
      matchedPrefix: fallback ? null : prefix,
      offset,
      hasMore: false,
      isLoading: true,
      errorMessage: null
    }));
    try {
      const page = await getWorkInstructionPartCandidates(
        { prefix, fallback, limit: PART_CANDIDATE_PAGE_SIZE, offset },
        controller.signal
      );
      if (generation !== candidateRequestRef.current.generation) return;
      if (fallback && page.matchedPrefix) setPrefixLength(Array.from(page.matchedPrefix).length);
      setCandidateDialog({
        isOpen: true,
        matchedPrefix: page.matchedPrefix,
        candidates: page.candidates,
        offset: page.offset,
        hasMore: page.hasMore,
        isLoading: false,
        errorMessage: null
      });
    } catch (error) {
      if (controller.signal.aborted || generation !== candidateRequestRef.current.generation) return;
      setCandidateDialog({
        isOpen: true,
        matchedPrefix: fallback ? null : prefix,
        candidates: [],
        offset,
        hasMore: false,
        isLoading: false,
        errorMessage: '部品番号候補の検索に失敗しました。'
      });
    } finally {
      if (generation === candidateRequestRef.current.generation) {
        candidateRequestRef.current.controller = null;
        setAutoFallbackPending(false);
      }
    }
  }, [cancelCandidateRequest]);

  const beginPartScan = useCallback(() => {
    cancelCandidateRequest();
    setPartNumber('');
    setSelectedTarget(null);
    setOriginalPartNumber('');
    setPrefixLength(0);
    setAutoFallbackPending(false);
    setCandidateDialog(emptyCandidateDialogState);
  }, [cancelCandidateRequest]);

  const acceptPartScan = useCallback((rawText: string, options?: { autoFallback?: boolean }): WorkInstructionPartScanResult => {
    const normalized = normalizeWorkInstructionPartNumber(rawText);
    cancelCandidateRequest();
    setSelectedTarget(null);
    if (!normalized) {
      setPartNumber('');
      setOriginalPartNumber('');
      setPrefixLength(0);
      setAutoFallbackPending(false);
      return { ok: false };
    }
    setCandidateDialog(emptyCandidateDialogState);
    setOriginalPartNumber(normalized);
    setPrefixLength(Array.from(normalized).length);
    setAutoFallbackPending(options?.autoFallback !== false);
    setPartNumber(normalized);
    return { ok: true, partNumber: normalized };
  }, [cancelCandidateRequest]);

  useEffect(() => {
    if (!autoFallbackPending || !groupsQuery.isSuccess || groupsQuery.isFetching) return;
    if (exactGroupCount > 0) {
      setAutoFallbackPending(false);
      return;
    }
    const fallbackCharacters = originalCharacters.slice(0, -1);
    if (fallbackCharacters.length < 2) {
      setAutoFallbackPending(false);
      setCandidateDialog({ ...emptyCandidateDialogState, isOpen: true });
      return;
    }
    void openCandidates(fallbackCharacters.join(''), true, 0);
  }, [autoFallbackPending, exactGroupCount, groupsQuery.isFetching, groupsQuery.isSuccess, openCandidates, originalCharacters]);

  const movePrefix = useCallback((delta: -1 | 1) => {
    const nextLength = Math.min(originalCharacters.length, Math.max(2, prefixLength + delta));
    if (!originalPartNumber || nextLength === prefixLength) return;
    setPrefixLength(nextLength);
    void openCandidates(originalCharacters.slice(0, nextLength).join(''), false, 0);
  }, [openCandidates, originalCharacters, originalPartNumber, prefixLength]);

  const selectCandidate = useCallback((candidatePartNumber: string) => {
    cancelCandidateRequest();
    setSelectedTarget(null);
    setAutoFallbackPending(false);
    setPartNumber(candidatePartNumber);
    setCandidateDialog(emptyCandidateDialogState);
  }, [cancelCandidateRequest]);

  const changeCandidatePage = useCallback((nextOffset: number) => {
    if (!candidateDialog.matchedPrefix || candidateDialog.isLoading || nextOffset < 0) return;
    void openCandidates(candidateDialog.matchedPrefix, false, nextOffset);
  }, [candidateDialog.isLoading, candidateDialog.matchedPrefix, openCandidates]);

  const closeCandidateDialog = useCallback(() => {
    cancelCandidateRequest();
    setAutoFallbackPending(false);
    setCandidateDialog((current) => ({ ...current, isOpen: false, isLoading: false }));
  }, [cancelCandidateRequest]);

  const clear = useCallback(() => {
    cancelCandidateRequest();
    setPartNumber('');
    setSelectedTarget(null);
    setOriginalPartNumber('');
    setPrefixLength(0);
    setAutoFallbackPending(false);
    setCandidateDialog(emptyCandidateDialogState);
  }, [cancelCandidateRequest]);

  const closeViewer = useCallback(() => {
    setSelectedTarget(null);
  }, []);

  return {
    partNumber,
    selectedTarget,
    targets,
    groupsQuery,
    groupQuery,
    beginPartScan,
    acceptPartScan,
    openTarget: setSelectedTarget,
    closeViewer,
    clear,
    candidateDialog,
    autoFallbackPending,
    canShortenPartNumber: originalCharacters.length > 0 && prefixLength > 2,
    canRestorePartNumber: originalCharacters.length > 0 && prefixLength < originalCharacters.length,
    shortenPartNumber: () => movePrefix(-1),
    restorePartNumber: () => movePrefix(1),
    selectCandidate,
    changeCandidatePage,
    closeCandidateDialog,
    candidatePageSize: PART_CANDIDATE_PAGE_SIZE
  };
}
