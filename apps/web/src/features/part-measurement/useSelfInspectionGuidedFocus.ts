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
  outOfToleranceAcknowledgedByEntryIndex?: Record<number, Record<string, boolean>>;
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
  outOfToleranceAcknowledgedByEntryIndex,
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
  const guidedFocusPrimedKeyRef = useRef<string | null>(null);
  const pendingAutoAdvanceKeyRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);

  const buildPrimedKey = useCallback((sessionId: string, entryIndex: number) => `${sessionId}:${entryIndex}`, []);

  const activeDraft = session ? draftValuesByEntryIndex[selectedEntryIndex] : undefined;
  const activeOutOfToleranceAcknowledgedByPointId = useMemo(
    () => outOfToleranceAcknowledgedByEntryIndex?.[selectedEntryIndex] ?? {},
    [outOfToleranceAcknowledgedByEntryIndex, selectedEntryIndex]
  );
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
      const pointId = findFirstGuidedPointId(
        points,
        session.template.items,
        activeOutOfToleranceAcknowledgedByPointId
      );
      if (!pointId) {
        clearConsumeNextBlurGuideAdvance();
        const allComplete =
          points.length > 0 &&
          points.every((pt) => {
            const status = resolvePointInputStatus(pt);
            return status === 'ok' || (status === 'ng' && activeOutOfToleranceAcknowledgedByPointId[pt.id] === true);
          });
        setGuideMode('manual');
        setFocusRequest(null);
        setGuideHint(
          allComplete
            ? 'この入力件の測定点はすべて入力済みです。「入力を保存」してください。'
            : null
        );
        if (options?.force && session?.id) {
          guidedFocusPrimedKeyRef.current = buildPrimedKey(session.id, selectedEntryIndex);
        }
        return false;
      }
      clearConsumeNextBlurGuideAdvance();
      setGuideMode('guided');
      applyFocusTarget(createGuidedFocusTarget(pointId, nextRequestId()));
      if (options?.force && session?.id) {
        guidedFocusPrimedKeyRef.current = buildPrimedKey(session.id, selectedEntryIndex);
      }
      return true;
    },
    [
      activeDraft,
      activeOutOfToleranceAcknowledgedByPointId,
      applyFocusTarget,
      isDrawingCanvasReady,
      isSessionReadOnly,
      clearConsumeNextBlurGuideAdvance,
      buildPrimedKey,
      nextRequestId,
      selectedEntryIndex,
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
      requestId: nextRequestId(),
      outOfToleranceAcknowledgedByPointId: activeOutOfToleranceAcknowledgedByPointId
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
    activeOutOfToleranceAcknowledgedByPointId,
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

  /** ユーザーが入力件チップをタップしたとき（manual 維持・自動ガイドしない） */
  const handleUserEntrySelect = useCallback(
    (entryIndex: number) => {
      handleEntrySwitch();
      if (session?.id) {
        guidedFocusPrimedKeyRef.current = buildPrimedKey(session.id, entryIndex);
      }
      pendingAutoAdvanceKeyRef.current = null;
    },
    [buildPrimedKey, handleEntrySwitch, session?.id]
  );

  /** 保存成功後の自動遷移（次入力件で guided を再開） */
  const prepareAutoAdvanceToEntry = useCallback(
    (entryIndex: number) => {
      consumeNextBlurGuideAdvance();
      onSelectPointId(null);
      if (!session?.id) return;
      const key = buildPrimedKey(session.id, entryIndex);
      pendingAutoAdvanceKeyRef.current = key;
      if (guidedFocusPrimedKeyRef.current === key) {
        guidedFocusPrimedKeyRef.current = null;
      }
    },
    [buildPrimedKey, consumeNextBlurGuideAdvance, onSelectPointId, session?.id]
  );

  /** 入力件保存成功後: guided を止め、再開ボタンで当該件を再開する */
  const enterManualAfterPersist = useCallback(() => {
    clearConsumeNextBlurGuideAdvance();
    enterManual();
  }, [clearConsumeNextBlurGuideAdvance, enterManual]);

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
        nextFocusRequestId,
        outOfToleranceAcknowledgedByPointId: activeOutOfToleranceAcknowledgedByPointId
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
      activeOutOfToleranceAcknowledgedByPointId,
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
      guidedFocusPrimedKeyRef.current = null;
      pendingAutoAdvanceKeyRef.current = null;
      setGuideMode(isSessionReadOnly ? 'manual' : 'guided');
      setFocusRequest(null);
      setGuideHint(null);
    }
  }, [isSessionReadOnly, session?.id]);

  useEffect(() => {
    if (!isSessionReadOnly) return;
    guidedFocusPrimedKeyRef.current = session?.id ? `${session.id}:readonly` : 'readonly';
    enterManual();
  }, [enterManual, isSessionReadOnly, session?.id]);

  useEffect(() => {
    if (!session?.id || !isDraftReadyForGuidedFocus || !activeDraft) return;
    if (!isDrawingCanvasReady || isSessionReadOnly) return;

    const primedKey = buildPrimedKey(session.id, selectedEntryIndex);
    if (guidedFocusPrimedKeyRef.current === primedKey) return;

    const isAutoAdvance = pendingAutoAdvanceKeyRef.current === primedKey;
    if (isAutoAdvance) {
      const started = startGuidedForCurrentEntry({ force: true });
      if (started) {
        guidedFocusPrimedKeyRef.current = primedKey;
        pendingAutoAdvanceKeyRef.current = null;
      }
      return;
    }

    const hasPrimedForSession = guidedFocusPrimedKeyRef.current?.startsWith(`${session.id}:`);
    if (!hasPrimedForSession) {
      const started = startGuidedForCurrentEntry({ force: true });
      if (started) {
        guidedFocusPrimedKeyRef.current = primedKey;
      }
    }
  }, [
    activeDraft,
    buildPrimedKey,
    isDraftReadyForGuidedFocus,
    isDrawingCanvasReady,
    isSessionReadOnly,
    selectedEntryIndex,
    session?.id,
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
    handleUserEntrySelect,
    prepareAutoAdvanceToEntry,
    handleCommitValue,
    consumeNextBlurGuideAdvance,
    enterManualAfterPersist,
    activePoints
  };
}
