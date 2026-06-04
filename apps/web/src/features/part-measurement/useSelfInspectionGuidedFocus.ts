import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applySelfInspectionGuidedCommit,
  buildEntryDrawingPoints,
  canStartSelfInspectionGuidedFocus,
  createGuidedFocusTarget,
  findFirstGuidedPointId,
  findNextPointIdInMarkerOrder,
  resolvePointInputStatus,
  resolveResumeGuidedFocusTarget,
  type SelfInspectionGuideMode,
  type SelfInspectionGuidedFocusRequest,
  shouldAdvanceGuideOnCommit,
  type SelfInspectionValueCommitPayload
} from './selfInspectionGuidedFocus';

import type { InspectionDrawingPoint } from './inspection-drawing/types';
import type { SelfInspectionSessionDetailDto } from './types';

type Args = {
  session: SelfInspectionSessionDetailDto | undefined;
  selectedEntryIndex: number;
  selectedPointId: string | null;
  draftValuesByEntryIndex: Record<number, Record<string, string>>;
  isSessionReadOnly: boolean;
  isDrawingCanvasReady: boolean;
  /** ページ側で session 用 baseline draft の準備が完了したときだけ true */
  isDraftReadyForGuidedFocus: boolean;
  onDraftChange: (entryIndex: number, draft: Record<string, string>) => void;
  onSelectPointId: (pointId: string | null) => void;
  onZoomLevel: (zoom: number) => void;
  /** 図面キャンバスに渡している現在倍率（手動「次の測定点」のセンタリング用） */
  canvasZoom: number;
};

export function useSelfInspectionGuidedFocus({
  session,
  selectedEntryIndex,
  selectedPointId,
  draftValuesByEntryIndex,
  isSessionReadOnly,
  isDrawingCanvasReady,
  isDraftReadyForGuidedFocus,
  onDraftChange,
  onSelectPointId,
  onZoomLevel,
  canvasZoom
}: Args) {
  const [guideMode, setGuideMode] = useState<SelfInspectionGuideMode>('guided');
  const [focusRequest, setFocusRequest] = useState<SelfInspectionGuidedFocusRequest | null>(null);
  const [guideHint, setGuideHint] = useState<string | null>(null);
  const requestIdRef = useRef(1);
  /** 次の blur 1 回だけガイド自動進行を抑止（消費型・タイマー非依存） */
  const consumeNextBlurGuideAdvanceRef = useRef(false);
  const guidedFocusPrimedSessionIdRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);

  const activeDraft = session ? draftValuesByEntryIndex[selectedEntryIndex] : undefined;
  const activePoints = useMemo((): InspectionDrawingPoint[] => {
    if (!session || !activeDraft) return [];
    return buildEntryDrawingPoints(session, activeDraft);
  }, [activeDraft, session]);

  const guideActionsEnabled = useMemo(
    () =>
      Boolean(session && activeDraft) &&
      canStartSelfInspectionGuidedFocus({
        isSessionReadOnly,
        isDrawingCanvasReady,
        points: activePoints
      }),
    [activeDraft, activePoints, isDrawingCanvasReady, isSessionReadOnly, session]
  );

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  const consumeNextBlurGuideAdvance = useCallback(() => {
    consumeNextBlurGuideAdvanceRef.current = true;
  }, []);

  const clearConsumeNextBlurGuideAdvance = useCallback(() => {
    consumeNextBlurGuideAdvanceRef.current = false;
  }, []);

  const applyFocusTarget = useCallback(
    (target: { pointId: string; zoom: number; focusRequest: SelfInspectionGuidedFocusRequest }) => {
      onZoomLevel(target.zoom);
      setFocusRequest(target.focusRequest);
      onSelectPointId(target.pointId);
      setGuideHint(null);
    },
    [onSelectPointId, onZoomLevel]
  );

  const enterManual = useCallback(() => {
    setGuideMode('manual');
    setFocusRequest(null);
    setGuideHint(null);
  }, []);

  const startGuidedForCurrentEntry = useCallback(
    (options?: { force?: boolean }) => {
      if (!session || !activeDraft) return false;
      const points = buildEntryDrawingPoints(session, activeDraft);
      if (
        !canStartSelfInspectionGuidedFocus({
          isSessionReadOnly,
          isDrawingCanvasReady,
          points
        })
      ) {
        return false;
      }
      const pointId = findFirstGuidedPointId(points, session.template.items);
      if (!pointId) {
        clearConsumeNextBlurGuideAdvance();
        const allComplete =
          points.length > 0 && points.every((pt) => resolvePointInputStatus(pt) === 'ok');
        setGuideMode('manual');
        setFocusRequest(null);
        setGuideHint(
          allComplete
            ? 'この入力件の測定点はすべて入力済みです。「入力を保存」してください。'
            : null
        );
        if (options?.force && session?.id) {
          guidedFocusPrimedSessionIdRef.current = session.id;
        }
        return false;
      }
      clearConsumeNextBlurGuideAdvance();
      setGuideMode('guided');
      applyFocusTarget(createGuidedFocusTarget(pointId, nextRequestId()));
      if (options?.force && session?.id) {
        guidedFocusPrimedSessionIdRef.current = session.id;
      }
      return true;
    },
    [
      activeDraft,
      applyFocusTarget,
      isDrawingCanvasReady,
      isSessionReadOnly,
      clearConsumeNextBlurGuideAdvance,
      nextRequestId,
      session
    ]
  );

  const resumeGuided = useCallback(() => {
    clearConsumeNextBlurGuideAdvance();
    if (!session || !activeDraft) return;
    const points = buildEntryDrawingPoints(session, activeDraft);
    if (
      !canStartSelfInspectionGuidedFocus({
        isSessionReadOnly,
        isDrawingCanvasReady,
        points
      })
    ) {
      return;
    }
    const target = resolveResumeGuidedFocusTarget({
      session,
      draft: activeDraft,
      requestId: nextRequestId()
    });
    if (!target) {
      setGuideMode('manual');
      setGuideHint('この入力件の測定点はすべて入力済みです。「入力を保存」してください。');
      setFocusRequest(null);
      return;
    }
    setGuideMode('guided');
    applyFocusTarget(target);
  }, [
    activeDraft,
    applyFocusTarget,
    clearConsumeNextBlurGuideAdvance,
    isDrawingCanvasReady,
    isSessionReadOnly,
    nextRequestId,
    session
  ]);

  const goToNextPointManual = useCallback(() => {
    if (!session || !activeDraft) return;
    const points = buildEntryDrawingPoints(session, activeDraft);
    const currentId = selectedPointId ?? focusRequest?.pointId ?? null;
    const nextId = findNextPointIdInMarkerOrder(points, session.template.items, currentId);
    if (!nextId) return;
    consumeNextBlurGuideAdvance();
    enterManual();
    applyFocusTarget(createGuidedFocusTarget(nextId, nextRequestId(), canvasZoom));
  }, [
    activeDraft,
    applyFocusTarget,
    consumeNextBlurGuideAdvance,
    canvasZoom,
    enterManual,
    focusRequest?.pointId,
    nextRequestId,
    selectedPointId,
    session
  ]);

  const handleFitToView = useCallback(() => {
    enterManual();
  }, [enterManual]);

  const handleManualZoom = useCallback(() => {
    enterManual();
  }, [enterManual]);

  const handleUserScroll = useCallback(() => {
    enterManual();
  }, [enterManual]);

  const handleSelectPointManual = useCallback(
    (pointId: string) => {
      consumeNextBlurGuideAdvance();
      enterManual();
      onSelectPointId(pointId);
    },
    [consumeNextBlurGuideAdvance, enterManual, onSelectPointId]
  );

  const handleEntrySwitch = useCallback(() => {
    consumeNextBlurGuideAdvance();
    enterManual();
    onSelectPointId(null);
  }, [consumeNextBlurGuideAdvance, enterManual, onSelectPointId]);

  const handleCommitValue = useCallback(
    (commit: SelfInspectionValueCommitPayload) => {
      if (!session || !activeDraft) return;
      if (commit.entryIndex !== selectedEntryIndex) return;
      if (
        (commit.source === 'blur' || commit.source === 'blur_without_guide') &&
        consumeNextBlurGuideAdvanceRef.current
      ) {
        consumeNextBlurGuideAdvanceRef.current = false;
        if (commit.source === 'blur') {
          onDraftChange(commit.entryIndex, {
            ...activeDraft,
            [commit.pointId]: commit.value
          });
          return;
        }
      }

      const nextFocusRequestId = nextRequestId();
      const result = applySelfInspectionGuidedCommit({
        session,
        entryIndex: commit.entryIndex,
        currentDraft: activeDraft,
        commit,
        nextFocusRequestId
      });

      onDraftChange(commit.entryIndex, result.draft);

      if (guideMode !== 'guided' || !shouldAdvanceGuideOnCommit(commit.source)) {
        if (result.kind === 'stay' && result.inputStatus === 'ng') {
          setGuideHint('公差外のため次の測定点へ進めません。');
        }
        onSelectPointId(commit.pointId);
        return;
      }

      if (result.kind === 'stay') {
        onSelectPointId(result.pointId);
        if (result.inputStatus === 'ng') {
          setGuideHint('公差外のため次の測定点へ進めません。');
        } else if (result.inputStatus === 'tolerance_error') {
          setGuideHint('基準・公差が未設定のため確定できません。');
        } else if (result.inputStatus === 'invalid') {
          setGuideHint('測定値を確認してください。');
        }
        return;
      }

      if (!result.next) {
        setGuideMode('manual');
        setFocusRequest(null);
        setGuideHint('すべての測定点を入力しました。「入力を保存」してください。');
        onSelectPointId(commit.pointId);
        return;
      }

      applyFocusTarget(result.next);
    },
    [
      activeDraft,
      applyFocusTarget,
      guideMode,
      nextRequestId,
      onDraftChange,
      onSelectPointId,
      selectedEntryIndex,
      session
    ]
  );

  useEffect(() => {
    if (!session?.id) return;
    if (lastSessionIdRef.current !== session.id) {
      lastSessionIdRef.current = session.id;
      guidedFocusPrimedSessionIdRef.current = null;
      setGuideMode(isSessionReadOnly ? 'manual' : 'guided');
      setFocusRequest(null);
      setGuideHint(null);
    }
  }, [isSessionReadOnly, session?.id]);

  useEffect(() => {
    if (!isSessionReadOnly) return;
    guidedFocusPrimedSessionIdRef.current = session?.id ?? 'readonly';
    enterManual();
  }, [enterManual, isSessionReadOnly, session?.id]);

  useEffect(() => {
    if (!session?.id || !isDraftReadyForGuidedFocus || !activeDraft) return;
    if (guidedFocusPrimedSessionIdRef.current === session.id) return;
    if (!isDrawingCanvasReady || isSessionReadOnly) return;
    const started = startGuidedForCurrentEntry({ force: true });
    if (started) {
      guidedFocusPrimedSessionIdRef.current = session.id;
    }
  }, [
    activeDraft,
    isDraftReadyForGuidedFocus,
    isDrawingCanvasReady,
    isSessionReadOnly,
    session?.id,
    selectedEntryIndex,
    startGuidedForCurrentEntry
  ]);

  return {
    guideMode,
    focusRequest,
    guideHint,
    guideActionsEnabled,
    resumeGuided,
    goToNextPointManual,
    handleFitToView,
    handleManualZoom,
    handleUserScroll,
    handleSelectPointManual,
    handleEntrySwitch,
    handleCommitValue,
    consumeNextBlurGuideAdvance,
    activePoints
  };
}
