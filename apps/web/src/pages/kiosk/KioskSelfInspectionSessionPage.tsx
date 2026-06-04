import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  useCompleteSelfInspectionSession,
  useCreateSelfInspectionEntry,
  useResetSelfInspectionSession,
  useResolveSelfInspectionSession,
  useSelfInspectionSession,
  useUpdateSelfInspectionEntry
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  InspectionDrawingCanvas,
  InspectionDrawingValuePanel,
  inspectionDrawingCanvasColumnClassName,
  templateItemToDrawingPoint,
  useInspectionDrawingZoom
} from '../../features/part-measurement/inspection-drawing';
import {
  buildSelfInspectionEntryDraft,
  listDirtySelfInspectionEntryIndices,
  selfInspectionEntryDraftHasNg,
  selfInspectionEntryPageCountForSession,
  selfInspectionEntryPageForEntryIndex,
  selfInspectionEntrySlotsForPage
} from '../../features/part-measurement/selfInspectionEntryDraft';
import { selfInspectionModeDisplayLabel } from '../../features/part-measurement/selfInspectionEntrySlots';
import { kioskSelfInspectionSessionPath } from '../../features/part-measurement/selfInspectionRoutes';
import {
  resolveSelfInspectionDrawingPanelPhase,
  selfInspectionDrawingZoomEnabled
} from '../../features/part-measurement/selfInspectionSessionDrawingPanelState';
import { resolveSelfInspectionRequiredEntryCount } from '../../features/part-measurement/selfInspectionSessionEntryCount';
import { SelfInspectionSessionHeader } from '../../features/part-measurement/SelfInspectionSessionHeader';
import { usePartMeasurementDrawingBlobUrl } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';
import { useSelfInspectionGuidedFocus } from '../../features/part-measurement/useSelfInspectionGuidedFocus';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { SelfInspectionValueCommitPayload } from '../../features/part-measurement/selfInspectionGuidedFocus';

function readApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

type StartState = {
  id: string;
  templateId: string;
  productNo: string;
  fseiban: string;
  resourceCd: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  processGroup: 'cutting' | 'grinding';
};

export function KioskSelfInspectionSessionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { sessionId } = useParams();
  const startState = useMemo(() => {
    const locationState = (location.state ?? null) as StartState | null;
    if (locationState) return locationState;
    const templateId = searchParams.get('templateId')?.trim() ?? '';
    const productNo = searchParams.get('productNo')?.trim() ?? '';
    const processGroup = searchParams.get('processGroup') === 'grinding' ? 'grinding' : 'cutting';
    const resourceCd = searchParams.get('resourceCd')?.trim() ?? '';
    const fhincd = searchParams.get('fhincd')?.trim() ?? '';
    const fhinmei = searchParams.get('fhinmei')?.trim() ?? '';
    const scheduleRowId = searchParams.get('scheduleRowId')?.trim() ?? '';
    const fseiban = searchParams.get('fseiban')?.trim() ?? '';
    const machineName = searchParams.get('machineName')?.trim() ?? '';
    if (!templateId || !productNo || !resourceCd || !fhincd || !fhinmei || !scheduleRowId || !fseiban) return null;
    return {
      id: scheduleRowId,
      templateId,
      productNo,
      fseiban,
      resourceCd,
      fhincd,
      fhinmei,
      machineName: machineName || null,
      processGroup
    } satisfies StartState;
  }, [location.state, searchParams]);
  const resolveMutation = useResolveSelfInspectionSession();
  const createEntryMutation = useCreateSelfInspectionEntry();
  const updateEntryMutation = useUpdateSelfInspectionEntry();
  const completeSessionMutation = useCompleteSelfInspectionSession();
  const resetSessionMutation = useResetSelfInspectionSession();
  const [resetPhase, setResetPhase] = useState<null | 'destructive' | 'completed'>(null);
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(sessionId ?? null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0);
  const [entryIndexPage, setEntryIndexPage] = useState(0);
  const [draftValuesByEntryIndex, setDraftValuesByEntryIndex] = useState<Record<number, Record<string, string>>>({});
  const [savedDraftByEntryIndex, setSavedDraftByEntryIndex] = useState<Record<number, Record<string, string>>>({});
  /** 現在 session の baseline draft が載ったあとだけガイド初回開始を許可する */
  const [draftBoundSessionId, setDraftBoundSessionId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const resolveAttemptedRef = useRef(false);
  const persistInFlightRef = useRef(false);
  const employeeTagUidRef = useRef<string | null>(null);
  const isActiveRoute = useMatch('/kiosk/part-measurement/self-inspection/sessions/:sessionId');
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));
  useEffect(() => {
    if (!nfcEvent?.uid) return;
    employeeTagUidRef.current = nfcEvent.uid;
  }, [nfcEvent]);

  useEffect(() => {
    if (sessionId) {
      setResolvedSessionId(sessionId);
    }
  }, [sessionId]);

  const sessionQuery = useSelfInspectionSession(resolvedSessionId, {
    enabled: Boolean(resolvedSessionId),
    entryIndex: selectedEntryIndex
  });
  const session = sessionQuery.data;
  const latestSessionRef = useRef(session);
  latestSessionRef.current = session;
  const requiredEntryCount = session ? resolveSelfInspectionRequiredEntryCount(session) : 0;
  const isSessionReadOnly = Boolean(session?.completedAt || session?.entryCountBlockedReason);
  const { zoom, zoomIn, zoomOut, fitToView, fitGeneration, setZoomLevel } = useInspectionDrawingZoom();
  const drawingPath = session?.template.visualTemplate?.drawingImageRelativePath ?? null;
  const { blobUrl: drawingBlobUrl, error: drawingLoadError } = usePartMeasurementDrawingBlobUrl(drawingPath);
  const drawingPanelPhase = resolveSelfInspectionDrawingPanelPhase({
    drawingPath,
    blobUrl: drawingBlobUrl,
    loadError: drawingLoadError
  });
  const isDrawingCanvasReady = drawingPanelPhase === 'canvas';

  const handleDraftChange = useCallback((entryIndex: number, draft: Record<string, string>) => {
    setDraftValuesByEntryIndex((prev) => ({
      ...prev,
      [entryIndex]: draft
    }));
  }, []);

  useEffect(() => {
    const currentSession = latestSessionRef.current;
    if (!session?.id || !currentSession) return;
    setEntryIndexPage(0);
    setSelectedEntryIndex(0);
    setSelectedPointId(null);
    setDraftBoundSessionId(null);
    const baseline = buildSelfInspectionEntryDraft(currentSession, 0);
    setDraftValuesByEntryIndex({ 0: baseline });
    setSavedDraftByEntryIndex({ 0: baseline });
    setDraftBoundSessionId(currentSession.id);
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    if (selectedEntryIndex === 0 && draftBoundSessionId === session.id) return;
    const baseline = buildSelfInspectionEntryDraft(session, selectedEntryIndex);
    setDraftValuesByEntryIndex((prev) => {
      if (prev[selectedEntryIndex]) return prev;
      return {
        ...prev,
        [selectedEntryIndex]: baseline
      };
    });
    setSavedDraftByEntryIndex((prev) => {
      if (prev[selectedEntryIndex]) return prev;
      return {
        ...prev,
        [selectedEntryIndex]: baseline
      };
    });
  }, [draftBoundSessionId, session, selectedEntryIndex]);

  const isDraftReadyForGuidedFocus =
    Boolean(session?.id) &&
    draftBoundSessionId === session?.id &&
    draftValuesByEntryIndex[selectedEntryIndex] !== undefined;

  const {
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
    enterManualAfterPersist
  } = useSelfInspectionGuidedFocus({
    session,
    selectedEntryIndex,
    selectedPointId,
    draftValuesByEntryIndex,
    isSessionReadOnly,
    isDrawingCanvasReady,
    isDraftReadyForGuidedFocus,
    onDraftChange: handleDraftChange,
    onSelectPointId: setSelectedPointId,
    onZoomLevel: setZoomLevel,
    canvasZoom: zoom
  });

  const startStateKey = startState
    ? `${startState.templateId}:${startState.productNo}:${startState.resourceCd}:${startState.id}`
    : null;

  useEffect(() => {
    resolveAttemptedRef.current = false;
    setResolveError(null);
  }, [startStateKey]);

  useEffect(() => {
    if (resolvedSessionId || !startState || resolveAttemptedRef.current) {
      return;
    }
    resolveAttemptedRef.current = true;
    void resolveMutation
      .mutateAsync({
        templateId: startState.templateId,
        productNo: startState.productNo,
        processGroup: startState.processGroup,
        resourceCd: startState.resourceCd,
        scheduleRowId: startState.id,
        fseiban: startState.fseiban,
        fhincd: startState.fhincd,
        fhinmei: startState.fhinmei,
        machineName: startState.machineName
      })
      .then((nextSession) => {
        setResolveError(null);
        navigate(kioskSelfInspectionSessionPath(nextSession.id), { replace: true });
      })
      .catch((error: unknown) => {
        const message =
          typeof error === 'object' &&
          error !== null &&
          'response' in error &&
          typeof (error as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
            ? ((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? null)
            : null;
        setResolveError(message ?? '自主検査セッションの開始に失敗しました。');
      });
  }, [navigate, resolvedSessionId, startState, startStateKey, resolveMutation]);

  const entryPageCount = session ? selfInspectionEntryPageCountForSession(session) : 1;
  const visibleEntrySlots = useMemo(
    () => (session ? selfInspectionEntrySlotsForPage(session, entryIndexPage) : []),
    [session, entryIndexPage]
  );
  const selectedSlotLabel = useMemo(() => {
    if (!session) return '';
    const slot = visibleEntrySlots.find((s) => s.entryIndex === selectedEntryIndex);
    return slot?.entrySlotLabel ?? String(selectedEntryIndex + 1);
  }, [selectedEntryIndex, session, visibleEntrySlots]);

  const activeDraft = useMemo(() => {
    if (!session) return null;
    const values = draftValuesByEntryIndex[selectedEntryIndex] ?? {};
    return {
      entryIndex: selectedEntryIndex,
      points: session.template.items.map((item) => templateItemToDrawingPoint(item, values[item.id] ?? ''))
    };
  }, [draftValuesByEntryIndex, selectedEntryIndex, session]);

  const selectedPoint = activeDraft?.points.find((point) => point.id === selectedPointId) ?? activeDraft?.points[0] ?? null;

  const activeEntryHasNg = useMemo(() => {
    if (!activeDraft || !session) return false;
    const draft = draftValuesByEntryIndex[selectedEntryIndex];
    return draft ? selfInspectionEntryDraftHasNg(session, draft) : false;
  }, [activeDraft, draftValuesByEntryIndex, selectedEntryIndex, session]);

  const dirtyEntryIndices = useMemo(() => {
    if (!session) return [];
    return listDirtySelfInspectionEntryIndices(session, draftValuesByEntryIndex, savedDraftByEntryIndex);
  }, [draftValuesByEntryIndex, savedDraftByEntryIndex, session]);

  const hasUnsavedDraftChanges = dirtyEntryIndices.length > 0;

  const isSavingEntry = createEntryMutation.isPending || updateEntryMutation.isPending;
  const isCompletingSession = completeSessionMutation.isPending;
  const isResettingSession = resetSessionMutation.isPending;
  const resetDisabled = isSavingEntry || isCompletingSession || isResettingSession;

  const resetDestructiveDescription = hasUnsavedDraftChanges
    ? '入力値と参照図面を初期化し、最新の有効検査図面でやり直します。未保存の入力があります。リセットすると破棄されます。'
    : '入力値と参照図面を初期化し、最新の有効検査図面でやり直します。';

  const runSessionReset = async (confirmCompletedSessionReset: boolean) => {
    if (!session || !resolvedSessionId) return;
    setResetPhase(null);
    setActionError(null);
    try {
      const result = await resetSessionMutation.mutateAsync({
        sessionId: resolvedSessionId,
        body: {
          confirmDestructiveReset: true,
          confirmCompletedSessionReset,
          requestId: crypto.randomUUID()
        }
      });
      navigate(kioskSelfInspectionSessionPath(result.newSession.id), { replace: true });
    } catch (error: unknown) {
      setActionError(readApiErrorMessage(error, '初期化に失敗しました。'));
    }
  };

  const persistEntry = async (entryIndex: number, draft: Record<string, string>) => {
    if (!session || isSessionReadOnly || persistInFlightRef.current || isSavingEntry) {
      return false;
    }
    if (selfInspectionEntryDraftHasNg(session, draft)) {
      setActionError('公差外の測定値があるため保存できません。');
      return false;
    }
    persistInFlightRef.current = true;
    setActionError(null);
    const payload = {
      employeeTagUid: employeeTagUidRef.current,
      values: session.template.items.map((item) => ({
        templateItemId: item.id,
        value: draft[item.id] ?? ''
      }))
    };
    try {
      const existing = session.entries.find((entry) => entry.entryIndex === entryIndex);
      if (existing) {
        await updateEntryMutation.mutateAsync({
          sessionId: session.id,
          entryId: existing.id,
          body: {
            ...payload,
            ifUnmodifiedSince: existing.updatedAt
          }
        });
      } else {
        await createEntryMutation.mutateAsync({
          sessionId: session.id,
          body: {
            entryIndex,
            ...payload
          }
        });
      }
      setSavedDraftByEntryIndex((prev) => ({
        ...prev,
        [entryIndex]: { ...draft }
      }));
      return true;
    } catch (error: unknown) {
      setActionError(readApiErrorMessage(error, '入力の保存に失敗しました。'));
      return false;
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const persistCurrentEntry = async () => {
    if (!activeDraft) return;
    const draft = draftValuesByEntryIndex[activeDraft.entryIndex];
    if (!draft) return;
    const saved = await persistEntry(activeDraft.entryIndex, draft);
    if (saved) {
      enterManualAfterPersist();
    }
  };

  const completeSession = async () => {
    if (!session || isSessionReadOnly || isCompletingSession || hasUnsavedDraftChanges) {
      return;
    }
    setActionError(null);
    try {
      await completeSessionMutation.mutateAsync(session.id);
    } catch (error: unknown) {
      setActionError(readApiErrorMessage(error, '完了処理に失敗しました。'));
    }
  };

  const onValuePanelCommit = useCallback(
    (panelCommit: {
      pointId: string;
      value: string;
      source: 'dropdown' | 'enter' | 'blur' | 'blur_without_guide';
    }) => {
      if (!session) return;
      const commit: SelfInspectionValueCommitPayload = {
        pointId: panelCommit.pointId,
        entryIndex: selectedEntryIndex,
        value: panelCommit.value,
        source: panelCommit.source
      };
      handleCommitValue(commit);
    },
    [handleCommitValue, selectedEntryIndex, session]
  );

  if (!resolvedSessionId && resolveMutation.isPending) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 text-white">セッション作成中…</div>;
  }

  if (!resolvedSessionId && !startState) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 p-4 text-center text-amber-200">
        自主検査の開始情報が不足しています。一覧または順位ボードから開き直してください。
      </div>
    );
  }

  if (!resolvedSessionId && resolveError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 p-4 text-center text-amber-200">
        {resolveError}
      </div>
    );
  }

  if (sessionQuery.isLoading || !session) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 text-white">読込中…</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 bg-slate-900 p-1 text-white">
      <SelfInspectionSessionHeader
        productNo={session.productNo}
        fhincd={session.fhincd}
        resourceCd={session.resourceCd}
        fhinmei={session.fhinmei}
        modeLabel={selfInspectionModeDisplayLabel(
          session.selfInspectionMode,
          session.selfInspectionFixedCount ?? session.selfInspectionSampleSize
        )}
        requiredEntryCount={requiredEntryCount}
        entryCountBlockedReason={session.entryCountBlockedReason ?? null}
        guideMode={guideMode}
        guideActionsEnabled={guideActionsEnabled}
        zoomEnabled={selfInspectionDrawingZoomEnabled(drawingBlobUrl)}
        onZoomIn={() => {
          handleManualZoom();
          zoomIn();
        }}
        onZoomOut={() => {
          handleManualZoom();
          zoomOut();
        }}
        onFitToView={() => {
          handleFitToView();
          fitToView();
        }}
        onResumeGuide={resumeGuided}
        onPrepareNextPoint={consumeNextBlurGuideAdvance}
        onNextPoint={goToNextPointManual}
        onBackToList={() => navigate('/kiosk/part-measurement/self-inspection')}
        onReset={() => setResetPhase('destructive')}
        resetDisabled={resetDisabled}
      />

      <ConfirmDialog
        isOpen={resetPhase === 'destructive'}
        title="自主検査を初期化しますか？"
        description={resetDestructiveDescription}
        confirmLabel="初期化する"
        tone="danger"
        onCancel={() => setResetPhase(null)}
        onConfirm={() => {
          if (session.completedAt) {
            setResetPhase('completed');
            return;
          }
          void runSessionReset(false);
        }}
      />
      <ConfirmDialog
        isOpen={resetPhase === 'completed'}
        title="完了済みの実績を削除します"
        description="完了済みを含む本番の入力実績がすべて削除され、最新図面の新しいセッションで再開します。この操作は取り消せません。"
        confirmLabel="削除して再開"
        tone="danger"
        onCancel={() => setResetPhase(null)}
        onConfirm={() => void runSessionReset(true)}
      />

      {guideHint ? (
        <p className="shrink-0 rounded border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100">
          {guideHint}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-1 xl:flex-row">
        <div
          className={clsx(
            inspectionDrawingCanvasColumnClassName,
            'rounded border border-white/15 bg-slate-950/50 p-1'
          )}
        >
          {isDrawingCanvasReady && drawingBlobUrl ? (
            <InspectionDrawingCanvas
              imageUrl={drawingBlobUrl}
              points={activeDraft?.points ?? []}
              mode="test"
              selectedPointId={selectedPoint?.id ?? null}
              onSelectPoint={handleSelectPointManual}
              zoom={zoom}
              fitGeneration={fitGeneration}
              focusRequest={focusRequest}
              onUserScroll={handleUserScroll}
            />
          ) : drawingPanelPhase === 'loading' ? (
            <div className="flex flex-1 items-center justify-center text-white/60">図面を読み込み中…</div>
          ) : drawingPanelPhase === 'error' ? (
            <div className="flex flex-1 items-center justify-center text-amber-200">
              {drawingLoadError ?? '図面の読み込みに失敗しました'}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-white/60">図面がありません。</div>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-2 xl:w-[360px] xl:shrink-0">
          <div className="rounded border border-white/15 bg-slate-800/70 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white/80">
                入力件（{selectedSlotLabel} / {requiredEntryCount}）
              </p>
              {entryPageCount > 1 ? (
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <Button
                    type="button"
                    variant="ghostOnDark"
                    className="min-h-8 px-2 py-1 text-xs"
                    disabled={entryIndexPage <= 0}
                    onClick={() => setEntryIndexPage((page) => Math.max(0, page - 1))}
                  >
                    前へ
                  </Button>
                  <span>
                    {entryIndexPage + 1} / {entryPageCount}
                  </span>
                  <Button
                    type="button"
                    variant="ghostOnDark"
                    className="min-h-8 px-2 py-1 text-xs"
                    disabled={entryIndexPage >= entryPageCount - 1}
                    onClick={() => setEntryIndexPage((page) => Math.min(entryPageCount - 1, page + 1))}
                  >
                    次へ
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-2" data-self-inspection-entry-slots>
              {visibleEntrySlots.map((slot) => (
                <button
                  key={`${slot.entrySlotKind}-${slot.entryIndex}`}
                  type="button"
                  className={`rounded px-3 py-2 text-sm font-semibold ${
                    slot.entryIndex === selectedEntryIndex ? 'bg-cyan-500 text-slate-950' : 'bg-white/10 text-white'
                  }`}
                  onPointerDownCapture={consumeNextBlurGuideAdvance}
                  onPointerDown={consumeNextBlurGuideAdvance}
                  onClick={() => {
                    handleEntrySwitch();
                    setSelectedEntryIndex(slot.entryIndex);
                    if (session) {
                      setEntryIndexPage(selfInspectionEntryPageForEntryIndex(session, slot.entryIndex));
                    }
                    setActionError(null);
                  }}
                >
                  {slot.entrySlotLabel}
                </button>
              ))}
            </div>
          </div>

          <InspectionDrawingValuePanel
            point={selectedPoint}
            valueInputMode="self_inspection_options"
            valueCommitScopeKey={
              session ? `${session.id}:${selectedEntryIndex}` : undefined
            }
            readOnly={isSessionReadOnly}
            onValueChange={(value) => {
              if (!selectedPoint || isSessionReadOnly || !session) return;
              setDraftValuesByEntryIndex((prev) => {
                const current =
                  prev[selectedEntryIndex] ?? buildSelfInspectionEntryDraft(session, selectedEntryIndex);
                return {
                  ...prev,
                  [selectedEntryIndex]: {
                    ...current,
                    [selectedPoint.id]: value
                  }
                };
              });
            }}
            onCommitValue={isSessionReadOnly ? undefined : onValuePanelCommit}
          />

          <div className="flex flex-col gap-2 rounded border border-white/15 bg-slate-800/70 p-2">
            {actionError ? (
              <p className="rounded border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
                {actionError}
              </p>
            ) : null}
            <div
              className="flex flex-wrap gap-2"
              data-self-inspection-session-actions
            >
              <Button
                type="button"
                disabled={isSessionReadOnly || isSavingEntry || activeEntryHasNg}
                onPointerDownCapture={consumeNextBlurGuideAdvance}
                onClick={() => void persistCurrentEntry()}
              >
                入力を保存
              </Button>
              <Button
                type="button"
                variant="ghostOnDark"
                disabled={
                  isSessionReadOnly ||
                  isCompletingSession ||
                  isSavingEntry ||
                  activeEntryHasNg ||
                  hasUnsavedDraftChanges ||
                  session.completedEntryCount < requiredEntryCount
                }
                onPointerDownCapture={consumeNextBlurGuideAdvance}
                onClick={() => void completeSession()}
              >
                完了
              </Button>
            </div>
            {activeEntryHasNg ? (
              <p className="text-xs text-amber-200">公差外の測定値があるため保存・完了できません。</p>
            ) : null}
            {hasUnsavedDraftChanges ? (
              <p className="text-xs text-amber-200">
                未保存の入力があります。「入力を保存」してから完了してください。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

