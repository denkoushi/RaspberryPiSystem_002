import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  useCompleteSelfInspectionSession,
  useCreateSelfInspectionEntry,
  useCreateSelfInspectionInspectorEntry,
  useResetSelfInspectionSession,
  useResolveSelfInspectionSession,
  useSelfInspectionInspectorMeasurementSession,
  useSelfInspectionRegistrationPolicy,
  useSelfInspectionSession,
  useSaveSelfInspectionInspectorJudgements,
  useUpdateSelfInspectionEntry,
  useUpdateSelfInspectionInspectorEntry,
  useUpsertSelfInspectionDraftEntry
} from '../../api/hooks';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  InspectionDrawingCanvas,
  InspectionDrawingPointSummaryList,
  InspectionDrawingValuePanel,
  inspectionDrawingCanvasColumnClassName,
  resolveMeasurementPointInputStatus,
  templateItemToDrawingPoint,
  useInspectionDrawingZoom
} from '../../features/part-measurement/inspection-drawing';
import { applySelfInspectionEntrySaveToSessionCache } from '../../features/part-measurement/mergeSelfInspectionSessionAfterEntrySave';
import { resolveNextRequiredSelfInspectionEntryIndex } from '../../features/part-measurement/resolveNextRequiredSelfInspectionEntryIndex';
import {
  buildSelfInspectionEntryDraft,
  selfInspectionEntryPageCountForSession,
  selfInspectionEntryPageForEntryIndex,
  selfInspectionEntrySlotsForPage
} from '../../features/part-measurement/selfInspectionEntryDraft';
import { selfInspectionModeDisplayLabel } from '../../features/part-measurement/selfInspectionEntrySlots';
import { SelfInspectionKioskButton } from '../../features/part-measurement/SelfInspectionKioskButton';
import { SelfInspectionNfcRegistrationPanel } from '../../features/part-measurement/SelfInspectionNfcRegistrationPanel';
import { kioskSelfInspectionSessionPath } from '../../features/part-measurement/selfInspectionRoutes';
import {
  hasDirtySelfInspectionDrafts,
  resolveSelfInspectionCompleteActionState,
  resolveSelfInspectionResumeGuideActionState,
  resolveSelfInspectionSaveActionState,
  selfInspectionActionReasonMessage
} from '../../features/part-measurement/selfInspectionSessionActionState';
import {
  buildSelfInspectionDraftBoundKey,
  canRebindSelfInspectionEntryDraft,
  createSelfInspectionEntryDraftBinding,
  resolveSelfInspectionDraftBoundKeySyncWithoutRebind
} from '../../features/part-measurement/selfInspectionSessionDraftBinding';
import {
  resolveSelfInspectionDrawingPanelPhase,
  selfInspectionDrawingZoomEnabled
} from '../../features/part-measurement/selfInspectionSessionDrawingPanelState';
import { resolveSelfInspectionRequiredEntryCount } from '../../features/part-measurement/selfInspectionSessionEntryCount';
import { SelfInspectionSessionHeader } from '../../features/part-measurement/SelfInspectionSessionHeader';
import { shouldAutosaveSelfInspectionDraftEntry } from '../../features/part-measurement/shouldAutosaveSelfInspectionDraftEntry';
import { usePartMeasurementDrawingBlobUrl, resolveKioskDrawingDisplayWidth } from '../../features/part-measurement/usePartMeasurementDrawingBlobUrl';
import { useSelfInspectionGuidedFocus } from '../../features/part-measurement/useSelfInspectionGuidedFocus';
import { useSelfInspectionNfcRegistration } from '../../features/part-measurement/useSelfInspectionNfcRegistration';
import { useSelfInspectionWorkbenchCameraExperiment } from '../../features/part-measurement/useSelfInspectionWorkbenchCameraExperiment';
import { useNfcStream } from '../../hooks/useNfcStream';

import type { SelfInspectionValueCommitPayload } from '../../features/part-measurement/selfInspectionGuidedFocus';
import type { SelfInspectionLotEntryDto } from '../../features/part-measurement/types';

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

type ValuePanelCommit = {
  pointId: string;
  value: string;
  source: 'dropdown' | 'hundredths_button' | 'enter' | 'blur' | 'blur_without_guide';
};

type PendingOutOfToleranceCommit = ValuePanelCommit & {
  entryIndex: number;
};

type Props = {
  mode?: 'operator' | 'inspector';
};

export function KioskSelfInspectionSessionPage({ mode = 'operator' }: Props) {
  const isInspectorMode = mode === 'inspector';
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
  const requestedEntryIndex = useMemo(() => {
    const raw = searchParams.get('entryIndex');
    const parsed = raw != null ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }, [searchParams]);
  const resolveMutation = useResolveSelfInspectionSession();
  const createEntryMutation = useCreateSelfInspectionEntry();
  const updateEntryMutation = useUpdateSelfInspectionEntry();
  const { mutateAsync: upsertDraftEntry } = useUpsertSelfInspectionDraftEntry();
  const createInspectorEntryMutation = useCreateSelfInspectionInspectorEntry();
  const updateInspectorEntryMutation = useUpdateSelfInspectionInspectorEntry();
  const saveInspectorJudgementsMutation = useSaveSelfInspectionInspectorJudgements();
  const completeSessionMutation = useCompleteSelfInspectionSession();
  const resetSessionMutation = useResetSelfInspectionSession();
  const [resetPhase, setResetPhase] = useState<null | 'destructive' | 'completed'>(null);
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(sessionId ?? null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(requestedEntryIndex);
  const [entryIndexPage, setEntryIndexPage] = useState(0);
  const [draftValuesByEntryIndex, setDraftValuesByEntryIndex] = useState<Record<number, Record<string, string>>>({});
  const [savedDraftByEntryIndex, setSavedDraftByEntryIndex] = useState<Record<number, Record<string, string>>>({});
  const [outOfToleranceAcknowledgedByEntryIndex, setOutOfToleranceAcknowledgedByEntryIndex] = useState<
    Record<number, Record<string, boolean>>
  >({});
  const [inspectorJudgementsByEntryIndex, setInspectorJudgementsByEntryIndex] = useState<
    Record<number, Record<string, 'FINAL_OK' | 'FINAL_NG'>>
  >({});
  const [pendingOutOfToleranceCommit, setPendingOutOfToleranceCommit] =
    useState<PendingOutOfToleranceCommit | null>(null);
  /** entry 単位で baseline draft が束ねられたキー */
  const [draftBoundKey, setDraftBoundKey] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionEmployeeGateUnlocked, setSessionEmployeeGateUnlocked] = useState(false);
  const [draftAutosaveStatus, setDraftAutosaveStatus] = useState<'idle' | 'pending' | 'saved' | 'unsynced'>(
    'idle'
  );
  const [draftAutosaveAtLabel, setDraftAutosaveAtLabel] = useState<string | null>(null);
  const resolveAttemptedRef = useRef(false);
  const persistInFlightRef = useRef(false);
  const lastAutosavedDraftKeyRef = useRef<string | null>(null);
  const seededEmployeeTagRef = useRef<string | null>(null);
  const isActiveRoute = useMatch(
    isInspectorMode
      ? '/kiosk/part-measurement/self-inspection/sessions/:sessionId/inspector'
      : '/kiosk/part-measurement/self-inspection/sessions/:sessionId'
  );
  const nfcEvent = useNfcStream(Boolean(isActiveRoute));

  useEffect(() => {
    if (sessionId) {
      setResolvedSessionId(sessionId);
    }
  }, [sessionId]);

  const operatorSessionQuery = useSelfInspectionSession(resolvedSessionId, {
    enabled: Boolean(resolvedSessionId) && !isInspectorMode,
    entryIndex: selectedEntryIndex
  });
  const inspectorSessionQuery = useSelfInspectionInspectorMeasurementSession(resolvedSessionId, {
    enabled: Boolean(resolvedSessionId) && isInspectorMode,
    entryIndex: selectedEntryIndex
  });
  const sessionQuery = isInspectorMode ? inspectorSessionQuery : operatorSessionQuery;
  const registrationPolicyQuery = useSelfInspectionRegistrationPolicy();
  const requireMeasuringInstrumentTag =
    registrationPolicyQuery.data?.requireMeasuringInstrumentTag ?? false;
  const session = sessionQuery.data;
  const isSessionPlaceholderData = sessionQuery.isPlaceholderData;
  const isEntryFocusFetching = sessionQuery.isFetching && isSessionPlaceholderData;
  const latestSessionRef = useRef(session);
  latestSessionRef.current = session;
  const requiredEntryCount = session ? resolveSelfInspectionRequiredEntryCount(session) : 0;
  const isSessionIdentityReady = Boolean(session && resolvedSessionId && session.id === resolvedSessionId);
  const isSessionReadOnly = Boolean(session?.completedAt || session?.entryCountBlockedReason);
  const handleInstrumentTagResolvedForPreUseInspection = useCallback(
    (instrument: { tagUid: string }) => {
      if (!session || isSessionReadOnly) return false;
      const params = new URLSearchParams({
        tagUid: instrument.tagUid,
        selfInspectionSessionId: session.id,
        selfInspectionEntryIndex: String(selectedEntryIndex),
        selfInspectionMode: isInspectorMode ? 'inspector' : 'operator'
      });
      navigate(`/kiosk/instruments/borrow?${params.toString()}`);
      return true;
    },
    [isInspectorMode, isSessionReadOnly, navigate, selectedEntryIndex, session]
  );
  const { registration, registrationPayload, registrationDirty, hasUnsavedRegistrationDrafts, seedEmployeeToEmptyEntries } =
    useSelfInspectionNfcRegistration({
    session,
    selectedEntryIndex,
    nfcEvent,
    enabled: Boolean(isActiveRoute && session && !isSessionReadOnly),
    requireMeasuringInstrumentTag,
    onInstrumentTagResolved: handleInstrumentTagResolvedForPreUseInspection
  });

  const sessionEmployeeGateReady = useMemo(() => {
    if (isInspectorMode || isSessionReadOnly) return true;
    if (sessionEmployeeGateUnlocked) return true;
    if (registration.employeeTagUid) return true;
    return Boolean(session?.entries.some((entry) => Boolean(entry.createdByEmployeeId)));
  }, [
    isInspectorMode,
    isSessionReadOnly,
    registration.employeeTagUid,
    session?.entries,
    sessionEmployeeGateUnlocked
  ]);

  useEffect(() => {
    setSessionEmployeeGateUnlocked(false);
    seededEmployeeTagRef.current = null;
    lastAutosavedDraftKeyRef.current = null;
    setDraftAutosaveStatus('idle');
    setDraftAutosaveAtLabel(null);
  }, [session?.id]);

  useEffect(() => {
    if (!session || isInspectorMode || !registration.employeeTagUid) return;
    setSessionEmployeeGateUnlocked(true);
    if (seededEmployeeTagRef.current === registration.employeeTagUid) return;
    seededEmployeeTagRef.current = registration.employeeTagUid;
    const entryIndices = Array.from(
      new Set([
        ...session.entries.map((entry) => entry.entryIndex),
        selectedEntryIndex,
        ...Object.keys(draftValuesByEntryIndex).map((key) => Number(key))
      ])
    ).filter((entryIndex) => Number.isFinite(entryIndex) && entryIndex >= 0);
    seedEmployeeToEmptyEntries(entryIndices, {
      employeeTagUid: registration.employeeTagUid,
      employeeDisplayName: registration.employeeDisplayName
    });
  }, [
    draftValuesByEntryIndex,
    isInspectorMode,
    registration.employeeDisplayName,
    registration.employeeTagUid,
    seedEmployeeToEmptyEntries,
    selectedEntryIndex,
    session
  ]);

  useEffect(() => {
    if (
      !session ||
      !isSessionIdentityReady ||
      isInspectorMode ||
      isSessionReadOnly ||
      !sessionEmployeeGateReady ||
      persistInFlightRef.current
    ) {
      return;
    }
    const draft = draftValuesByEntryIndex[selectedEntryIndex];
    if (!draft) return;

    const acknowledgedByPointId = outOfToleranceAcknowledgedByEntryIndex[selectedEntryIndex] ?? {};
    const valuesPayload = session.template.items.map((item) => ({
      templateItemId: item.id,
      value: draft[item.id] ?? '',
      outOfToleranceAcknowledged:
        acknowledgedByPointId[item.id] === true ? true : undefined
    }));
    const hasAnyValue = valuesPayload.some((row) => String(row.value ?? '').trim().length > 0);
    const existing = session.entries.find((entry) => entry.entryIndex === selectedEntryIndex);
    const focusedForSelected =
      session.focusedEntry?.entryIndex === selectedEntryIndex ? session.focusedEntry : null;
    const persistenceStatus = focusedForSelected?.persistenceStatus ?? existing?.persistenceStatus;
    if (!shouldAutosaveSelfInspectionDraftEntry(persistenceStatus)) {
      return;
    }
    if (!hasAnyValue && !existing && !registration.employeeTagUid) {
      return;
    }

    const draftKey = `${session.id}:${selectedEntryIndex}:${JSON.stringify(valuesPayload)}:${registration.employeeTagUid ?? ''}:${registration.measuringInstrumentTagUid ?? ''}`;
    if (lastAutosavedDraftKeyRef.current === draftKey) return;

    setDraftAutosaveStatus('pending');
    const timer = window.setTimeout(() => {
      if (persistInFlightRef.current) return;
      void upsertDraftEntry({
          sessionId: session.id,
          body: {
            entryIndex: selectedEntryIndex,
            employeeTagUid: registration.employeeTagUid,
            measuringInstrumentTagUid: registration.measuringInstrumentTagUid,
            ifUnmodifiedSince: existing?.updatedAt,
            values: valuesPayload
          }
        })
        .then(() => {
          lastAutosavedDraftKeyRef.current = draftKey;
          const now = new Date();
          setDraftAutosaveAtLabel(
            `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
          );
          setDraftAutosaveStatus('saved');
        })
        .catch(() => {
          setDraftAutosaveStatus('unsynced');
        });
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    draftValuesByEntryIndex,
    isInspectorMode,
    isSessionIdentityReady,
    isSessionReadOnly,
    registration.employeeTagUid,
    registration.measuringInstrumentTagUid,
    selectedEntryIndex,
    session,
    sessionEmployeeGateReady,
    outOfToleranceAcknowledgedByEntryIndex,
    upsertDraftEntry
  ]);

  const { workbenchCameraEnabled, toggleWorkbenchCamera } = useSelfInspectionWorkbenchCameraExperiment({
    onLog: (cameraMetrics) => {
      console.debug('[self-inspection workbench camera experiment]', cameraMetrics);
    }
  });
  const { zoom, zoomIn, zoomOut, fitToView, fitGeneration, setZoomLevel } = useInspectionDrawingZoom();
  const drawingPath = session?.template.visualTemplate?.drawingImageRelativePath ?? null;
  const { blobUrl: drawingBlobUrl, error: drawingLoadError } = usePartMeasurementDrawingBlobUrl(drawingPath, {
    displayWidth: resolveKioskDrawingDisplayWidth()
  });
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
    setEntryIndexPage(selfInspectionEntryPageForEntryIndex(currentSession, requestedEntryIndex));
    setSelectedEntryIndex(requestedEntryIndex);
    setSelectedPointId(null);
    setDraftBoundKey(null);
    const binding = createSelfInspectionEntryDraftBinding(currentSession, requestedEntryIndex);
    setDraftValuesByEntryIndex({ [requestedEntryIndex]: binding.draft });
    setSavedDraftByEntryIndex({ [requestedEntryIndex]: binding.saved });
    setOutOfToleranceAcknowledgedByEntryIndex({});
    setPendingOutOfToleranceCommit(null);
    setDraftBoundKey(binding.boundKey);
  }, [requestedEntryIndex, session?.id]);

  const focusedEntry = session?.focusedEntry;

  useEffect(() => {
    if (!focusedEntry) return;
    const acknowledgedByPointId = Object.fromEntries(
      focusedEntry.values
        .filter(
          (value) =>
            value.reviewStatus !== 'NOT_REQUIRED' || value.outOfToleranceAcknowledgedAt != null
        )
        .map((value) => [value.templateItemId, true])
    );
    if (Object.keys(acknowledgedByPointId).length === 0) return;
    setOutOfToleranceAcknowledgedByEntryIndex((prev) => ({
      ...prev,
      [focusedEntry.entryIndex]: {
        ...(prev[focusedEntry.entryIndex] ?? {}),
        ...acknowledgedByPointId
      }
    }));
  }, [focusedEntry]);

  useEffect(() => {
    if (!session?.id) return;
    if (
      canRebindSelfInspectionEntryDraft({
        session,
        entryIndex: selectedEntryIndex,
        isPlaceholderData: isSessionPlaceholderData,
        draftValuesByEntryIndex,
        savedDraftByEntryIndex
      })
    ) {
      const binding = createSelfInspectionEntryDraftBinding(session, selectedEntryIndex);
      if (draftBoundKey === binding.boundKey) return;
      setDraftValuesByEntryIndex((prev) => ({
        ...prev,
        [selectedEntryIndex]: binding.draft
      }));
      setSavedDraftByEntryIndex((prev) => ({
        ...prev,
        [selectedEntryIndex]: binding.saved
      }));
      setDraftBoundKey(binding.boundKey);
      return;
    }

    const boundKeySync = resolveSelfInspectionDraftBoundKeySyncWithoutRebind({
      session,
      entryIndex: selectedEntryIndex,
      isPlaceholderData: isSessionPlaceholderData,
      draftBoundKey,
      draftValuesByEntryIndex,
      savedDraftByEntryIndex
    });
    if (boundKeySync) {
      setDraftBoundKey(boundKeySync);
    }
  }, [draftBoundKey, draftValuesByEntryIndex, isSessionPlaceholderData, savedDraftByEntryIndex, selectedEntryIndex, session]);

  const currentDraftBoundKey = session
    ? buildSelfInspectionDraftBoundKey(session, selectedEntryIndex)
    : null;
  const isDraftReadyForGuidedFocus =
    Boolean(session?.id) &&
    draftBoundKey === currentDraftBoundKey &&
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
    handleUserEntrySelect,
    prepareAutoAdvanceToEntry,
    handleCommitValue,
    consumeNextBlurGuideAdvance,
    enterManualAfterPersist
  } = useSelfInspectionGuidedFocus({
    session,
    selectedEntryIndex,
    selectedPointId,
    draftValuesByEntryIndex,
    outOfToleranceAcknowledgedByEntryIndex,
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
    if (isInspectorMode || resolvedSessionId || !startState || resolveAttemptedRef.current) {
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
  }, [isInspectorMode, navigate, resolvedSessionId, startState, startStateKey, resolveMutation]);

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
  const selectedSavedEntry = useMemo(
    () => session?.entries.find((entry) => entry.entryIndex === selectedEntryIndex) ?? null,
    [selectedEntryIndex, session?.entries]
  );
  const selectedInspectorEntry =
    isInspectorMode && session?.focusedEntry?.entryIndex === selectedEntryIndex
      ? session.focusedEntry
      : null;
  const pendingInspectorJudgementValues = useMemo(
    () =>
      selectedInspectorEntry?.values.filter(
        (value) => value.operatorReviewStatus === 'PENDING'
      ) ?? [],
    [selectedInspectorEntry]
  );
  const selectedInspectorJudgements = inspectorJudgementsByEntryIndex[selectedEntryIndex] ?? {};
  const canSaveInspectorJudgements =
    pendingInspectorJudgementValues.length > 0 &&
    pendingInspectorJudgementValues.every((value) => {
      const status = selectedInspectorJudgements[value.templateItemId] ?? value.judgementStatus;
      return status === 'FINAL_OK' || status === 'FINAL_NG';
    });

  const isSavingEntry =
    createEntryMutation.isPending ||
    updateEntryMutation.isPending ||
    createInspectorEntryMutation.isPending ||
    updateInspectorEntryMutation.isPending ||
    saveInspectorJudgementsMutation.isPending;
  const isCompletingSession = completeSessionMutation.isPending;
  const isResettingSession = resetSessionMutation.isPending;
  const resetDisabled =
    !isSessionIdentityReady || isSavingEntry || isCompletingSession || isResettingSession;

  const sessionActionContext = useMemo(() => {
    if (!session) return null;
    return {
      session,
      selectedEntryIndex,
      draftValuesByEntryIndex,
      savedDraftByEntryIndex,
      isSessionReadOnly,
      isSavingEntry,
      isCompletingSession,
      isDrawingCanvasReady,
      guideMode,
      guideActionsEnabled,
      entryRegistrationReady: registration.isReady && registration.status !== 'duplicate',
      entryRegistrationDirty: registrationDirty,
      requireMeasuringInstrumentTag,
      sessionEmployeeGateReady,
      outOfToleranceAcknowledgedByEntryIndex
    };
  }, [
    draftValuesByEntryIndex,
    guideActionsEnabled,
    guideMode,
    isCompletingSession,
    isDrawingCanvasReady,
    isSavingEntry,
    isSessionReadOnly,
    registration.isReady,
    registration.status,
    registrationDirty,
    requireMeasuringInstrumentTag,
    savedDraftByEntryIndex,
    selectedEntryIndex,
    sessionEmployeeGateReady,
    outOfToleranceAcknowledgedByEntryIndex,
    session
  ]);

  const saveActionState = useMemo(
    () =>
      sessionActionContext && isSessionIdentityReady
        ? resolveSelfInspectionSaveActionState(sessionActionContext)
        : { enabled: false, reason: 'read_only' as const },
    [isSessionIdentityReady, sessionActionContext]
  );

  const completeActionState = useMemo(
    () => {
      if (isInspectorMode) {
        const measurementsComplete = session?.inspectorMeasurementState === 'complete';
        const judgementsComplete = (session?.pendingReviewCount ?? 0) === 0;
        return {
          enabled: Boolean(session && measurementsComplete && judgementsComplete),
          reason: !measurementsComplete
            ? ('incomplete_values' as const)
            : !judgementsComplete
              ? ('pending_review' as const)
              : null
        };
      }
      if (!sessionActionContext || !isSessionIdentityReady) {
        return { enabled: false, reason: 'read_only' as const };
      }
      const state = resolveSelfInspectionCompleteActionState(sessionActionContext);
      if (
        session?.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT' &&
        state.reason === 'record_approval_required'
      ) {
        return { enabled: true, reason: null };
      }
      return state;
    },
    [isInspectorMode, isSessionIdentityReady, session, sessionActionContext]
  );
  const completeActionHint = isInspectorMode
    ? completeActionState.enabled
      ? null
      : completeActionState.reason === 'pending_review'
        ? '測定者側でNGだった全測定点に最終OK／NGを入力してください。'
        : '検査員の必要件数をすべて保存すると最終判定を確定できます。'
    : selfInspectionActionReasonMessage(completeActionState.reason);

  const resumeGuideActionState = useMemo(
    () =>
      sessionActionContext && isSessionIdentityReady
        ? resolveSelfInspectionResumeGuideActionState(sessionActionContext)
        : { enabled: false, reason: 'read_only' as const },
    [isSessionIdentityReady, sessionActionContext]
  );

  const hasUnsavedDraftChangesForReset = useMemo(() => {
    if (!session) return false;
    return (
      hasDirtySelfInspectionDrafts(session, draftValuesByEntryIndex, savedDraftByEntryIndex) ||
      hasUnsavedRegistrationDrafts
    );
  }, [draftValuesByEntryIndex, hasUnsavedRegistrationDrafts, savedDraftByEntryIndex, session]);

  const isSessionInputLocked =
    isSessionReadOnly || isCompletingSession || isEntryFocusFetching || !sessionEmployeeGateReady;

  const resetDestructiveDescriptionText = hasUnsavedDraftChangesForReset
    ? '入力値と参照図面を初期化し、最新の有効検査図面でやり直します。未保存の入力またはNFC読み取りがあります。リセットすると破棄されます。'
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

  const persistEntry = async (
    entryIndex: number,
    draft: Record<string, string>
  ): Promise<SelfInspectionLotEntryDto | null> => {
    if (!session || !isSessionIdentityReady || persistInFlightRef.current) {
      return null;
    }
    const saveState = resolveSelfInspectionSaveActionState({
      session,
      selectedEntryIndex: entryIndex,
      draftValuesByEntryIndex: { ...draftValuesByEntryIndex, [entryIndex]: draft },
      savedDraftByEntryIndex,
      isSessionReadOnly,
      isSavingEntry,
      isCompletingSession,
      isDrawingCanvasReady,
      guideMode,
      guideActionsEnabled,
      entryRegistrationReady: registration.isReady && registration.status !== 'duplicate',
      entryRegistrationDirty: registrationDirty,
      requireMeasuringInstrumentTag,
      sessionEmployeeGateReady,
      outOfToleranceAcknowledgedByEntryIndex
    });
    if (!saveState.enabled) {
      const message = selfInspectionActionReasonMessage(saveState.reason);
      if (message) setActionError(message);
      return null;
    }
    if (!registrationPayload) {
      setActionError(
        selfInspectionActionReasonMessage(
          requireMeasuringInstrumentTag ? 'missing_registration' : 'missing_employee_registration'
        )
      );
      return null;
    }
    persistInFlightRef.current = true;
    setActionError(null);
    const acknowledgedByPointId = outOfToleranceAcknowledgedByEntryIndex[entryIndex] ?? {};
    const payload = {
      ...registrationPayload,
      values: session.template.items.map((item) => ({
        templateItemId: item.id,
        value: draft[item.id] ?? '',
        outOfToleranceAcknowledged: acknowledgedByPointId[item.id] === true ? true : undefined
      }))
    };
    try {
      const existing = session.entries.find((entry) => entry.entryIndex === entryIndex);
      const savedEntry = isInspectorMode
        ? existing
          ? await updateInspectorEntryMutation.mutateAsync({
              sessionId: session.id,
              entryId: existing.id,
              body: {
                entryIndex,
                ...payload,
                ifUnmodifiedSince: existing.updatedAt
              }
            })
          : await createInspectorEntryMutation.mutateAsync({
              sessionId: session.id,
              body: {
                entryIndex,
                ...payload
              }
            })
        : existing
          ? await updateEntryMutation.mutateAsync({
              sessionId: session.id,
              entryId: existing.id,
              body: {
                ...payload,
                ifUnmodifiedSince: existing.updatedAt
              }
            })
          : await createEntryMutation.mutateAsync({
              sessionId: session.id,
              body: {
                entryIndex,
                ...payload
              }
            });
      setSavedDraftByEntryIndex((prev) => ({
        ...prev,
        [entryIndex]: { ...draft }
      }));
      setOutOfToleranceAcknowledgedByEntryIndex((prev) => ({
        ...prev,
        [entryIndex]: Object.fromEntries(
          savedEntry.values
            .filter((value) => value.reviewStatus !== 'NOT_REQUIRED')
            .map((value) => [value.templateItemId, true])
        )
      }));
      return savedEntry;
    } catch (error: unknown) {
      setActionError(readApiErrorMessage(error, '入力の保存に失敗しました。'));
      return null;
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const persistCurrentEntry = async () => {
    if (!saveActionState.enabled || !activeDraft) return;
    const draft = draftValuesByEntryIndex[activeDraft.entryIndex];
    if (!draft) return;
    const savedEntry = await persistEntry(activeDraft.entryIndex, draft);
    if (!savedEntry) return;

    const baseSession = latestSessionRef.current ?? session;
    const sessionSnapshot = baseSession
      ? applySelfInspectionEntrySaveToSessionCache(baseSession, savedEntry, activeDraft.entryIndex)
      : undefined;
    if (!sessionSnapshot) {
      enterManualAfterPersist();
      return;
    }

    const nextEntryIndex = resolveNextRequiredSelfInspectionEntryIndex(
      sessionSnapshot,
      activeDraft.entryIndex
    );
    if (nextEntryIndex == null) {
      enterManualAfterPersist();
      return;
    }

    prepareAutoAdvanceToEntry(nextEntryIndex);
    setSelectedEntryIndex(nextEntryIndex);
    setEntryIndexPage(selfInspectionEntryPageForEntryIndex(sessionSnapshot, nextEntryIndex));
    setActionError(null);
  };

  const completeSession = async () => {
    if (!completeActionState.enabled || !session || !isSessionIdentityReady) {
      return;
    }
    if (isInspectorMode) {
      setActionError(null);
      try {
        await completeSessionMutation.mutateAsync(session.id);
        navigate('/kiosk/part-measurement/self-inspection');
      } catch (error: unknown) {
        setActionError(readApiErrorMessage(error, '最終判定の確定に失敗しました。'));
      }
      return;
    }
    if (
      session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT' &&
      session.recordApprovalRequiredAt &&
      !session.recordApproval
    ) {
      navigate('/kiosk/part-measurement/self-inspection');
      return;
    }
    setActionError(null);
    try {
      await completeSessionMutation.mutateAsync(session.id);
    } catch (error: unknown) {
      setActionError(readApiErrorMessage(error, '完了処理に失敗しました。'));
    }
  };

  const saveInspectorJudgements = async () => {
    if (!session || !selectedInspectorEntry || !canSaveInspectorJudgements) return;
    setActionError(null);
    try {
      await saveInspectorJudgementsMutation.mutateAsync({
        sessionId: session.id,
        entryId: selectedInspectorEntry.id,
        body: {
          judgements: pendingInspectorJudgementValues.map((value) => ({
            templateItemId: value.templateItemId,
            judgementStatus:
              selectedInspectorJudgements[value.templateItemId] ?? value.judgementStatus!
          }))
        }
      });
    } catch (error: unknown) {
      setActionError(readApiErrorMessage(error, '最終判定の保存に失敗しました。'));
    }
  };

  const onValuePanelCommit = useCallback(
    (panelCommit: ValuePanelCommit) => {
      if (!session || isCompletingSession) return;
      const item = session.template.items.find((templateItem) => templateItem.id === panelCommit.pointId);
      if (!item) return;
      const committedPoint = templateItemToDrawingPoint(item, panelCommit.value);
      const status = resolveMeasurementPointInputStatus(committedPoint);
      const acknowledged =
        outOfToleranceAcknowledgedByEntryIndex[selectedEntryIndex]?.[panelCommit.pointId] === true;
      if (status === 'ng' && !acknowledged) {
        setPendingOutOfToleranceCommit({ ...panelCommit, entryIndex: selectedEntryIndex });
        setActionError(null);
        return;
      }
      const commit: SelfInspectionValueCommitPayload = {
        pointId: panelCommit.pointId,
        entryIndex: selectedEntryIndex,
        value: panelCommit.value,
        source: panelCommit.source,
        outOfToleranceConfirmed: acknowledged
      };
      handleCommitValue(commit);
    },
    [
      handleCommitValue,
      isCompletingSession,
      outOfToleranceAcknowledgedByEntryIndex,
      selectedEntryIndex,
      session
    ]
  );

  const confirmOutOfToleranceCommit = () => {
    if (!pendingOutOfToleranceCommit) return;
    const commit = pendingOutOfToleranceCommit;
    setPendingOutOfToleranceCommit(null);
    setOutOfToleranceAcknowledgedByEntryIndex((prev) => ({
      ...prev,
      [commit.entryIndex]: {
        ...(prev[commit.entryIndex] ?? {}),
        [commit.pointId]: true
      }
    }));
    handleCommitValue({
      pointId: commit.pointId,
      entryIndex: commit.entryIndex,
      value: commit.value,
      source: commit.source,
      outOfToleranceConfirmed: true
    });
  };

  const cancelOutOfToleranceCommit = () => {
    setPendingOutOfToleranceCommit(null);
  };

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

  if (sessionQuery.isLoading && !session) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-900 text-white">読込中…</div>;
  }

  if (!session || !isSessionIdentityReady) {
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
        ) + (isInspectorMode ? ' / 検査員再測定' : '')}
        requiredEntryCount={requiredEntryCount}
        entryCountBlockedReason={session.entryCountBlockedReason ?? null}
        guideMode={guideMode}
        guideActionsEnabled={guideActionsEnabled}
        canResumeGuide={resumeGuideActionState.enabled}
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
        onReset={isInspectorMode ? undefined : () => setResetPhase('destructive')}
        resetDisabled={resetDisabled}
        workbenchCameraEnabled={workbenchCameraEnabled}
        onToggleWorkbenchCamera={toggleWorkbenchCamera}
      />

      <ConfirmDialog
        isOpen={resetPhase === 'destructive'}
        title="自主検査を初期化しますか？"
        description={resetDestructiveDescriptionText}
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
      <ConfirmDialog
        isOpen={pendingOutOfToleranceCommit !== null}
        title="公差外の測定値です"
        description={
          pendingOutOfToleranceCommit
            ? `測定値 ${pendingOutOfToleranceCommit.value} は合格範囲外です。再入力するか、公差外のまま次へ進みます。`
            : undefined
        }
        cancelLabel="再入力"
        confirmLabel="公差外のまま進む"
        tone="danger"
        onCancel={cancelOutOfToleranceCommit}
        onConfirm={confirmOutOfToleranceCommit}
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
            'relative rounded border border-white/15 bg-slate-950/50 p-1'
          )}
        >
          {isDrawingCanvasReady && drawingBlobUrl ? (
            <InspectionDrawingCanvas
              imageUrl={drawingBlobUrl}
              points={activeDraft?.points ?? []}
              mode="test"
              selectedPointId={selectedPoint?.id ?? null}
              onSelectPoint={sessionEmployeeGateReady ? handleSelectPointManual : () => undefined}
              zoom={zoom}
              fitGeneration={fitGeneration}
              focusRequest={sessionEmployeeGateReady ? focusRequest : undefined}
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
          {!sessionEmployeeGateReady ? (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/75 p-4"
              data-self-inspection-employee-gate
            >
              <div className="max-w-md rounded-xl border border-cyan-300/40 bg-slate-900/95 px-5 py-4 text-center shadow-lg">
                <h3 className="text-lg font-bold text-cyan-100">氏名NFCタグをスキャン</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/75">
                  スキャンするまで測定値を選べません。作業者タグをリーダーにかざしてください。
                </p>
                <div className="mt-3 inline-flex items-center justify-center rounded-full border border-cyan-300/50 px-4 py-1 text-xs font-semibold tracking-widest text-cyan-200">
                  NFC
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-2 xl:w-[360px] xl:shrink-0">
          <SelfInspectionNfcRegistrationPanel
            registration={registration}
            requireMeasuringInstrumentTag={requireMeasuringInstrumentTag}
            instrumentUsages={selectedSavedEntry?.instrumentUsages ?? []}
          />

          <div className="shrink-0 rounded border border-white/15 bg-slate-800/70 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white/80">
                入力件（{selectedSlotLabel} / {requiredEntryCount}）
              </p>
              {entryPageCount > 1 ? (
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <SelfInspectionKioskButton
                    type="button"
                    size="compact"
                    disabled={entryIndexPage <= 0}
                    onClick={() => setEntryIndexPage((page) => Math.max(0, page - 1))}
                  >
                    前へ
                  </SelfInspectionKioskButton>
                  <span>
                    {entryIndexPage + 1} / {entryPageCount}
                  </span>
                  <SelfInspectionKioskButton
                    type="button"
                    size="compact"
                    disabled={entryIndexPage >= entryPageCount - 1}
                    onClick={() => setEntryIndexPage((page) => Math.min(entryPageCount - 1, page + 1))}
                  >
                    次へ
                  </SelfInspectionKioskButton>
                </div>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-2" data-self-inspection-entry-slots>
              {visibleEntrySlots.map((slot) => {
                const isSelected = slot.entryIndex === selectedEntryIndex;
                return (
                  <SelfInspectionKioskButton
                    key={`${slot.entrySlotKind}-${slot.entryIndex}`}
                    type="button"
                    size="default"
                    pressed={isSelected}
                    disabled={!sessionEmployeeGateReady}
                    aria-label={isSelected ? `${slot.entrySlotLabel}（選択中）` : slot.entrySlotLabel}
                    onPointerDownCapture={consumeNextBlurGuideAdvance}
                    onPointerDown={consumeNextBlurGuideAdvance}
                    onClick={() => {
                      if (!sessionEmployeeGateReady) return;
                      handleUserEntrySelect(slot.entryIndex);
                      setSelectedEntryIndex(slot.entryIndex);
                      setEntryIndexPage(selfInspectionEntryPageForEntryIndex(session, slot.entryIndex));
                      setActionError(null);
                    }}
                  >
                    {slot.entrySlotLabel}
                  </SelfInspectionKioskButton>
                );
              })}
            </div>
            {!isInspectorMode && sessionEmployeeGateReady ? (
              <div className="mt-2">
                {draftAutosaveStatus === 'saved' && draftAutosaveAtLabel ? (
                  <span className="inline-flex rounded-full border border-lime-300/40 bg-lime-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-lime-100">
                    下書き 自動保存済 {draftAutosaveAtLabel}
                  </span>
                ) : draftAutosaveStatus === 'unsynced' || draftAutosaveStatus === 'pending' ? (
                  <span className="inline-flex rounded-full border border-amber-300/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-100">
                    {draftAutosaveStatus === 'pending' ? '下書き 保存中…' : '下書き 未同期'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="shrink-0">
            <InspectionDrawingValuePanel
              point={selectedPoint}
              valueInputMode="self_inspection_options"
              valueCommitScopeKey={
                session ? `${session.id}:${selectedEntryIndex}` : undefined
              }
              readOnly={isSessionInputLocked}
              onValueChange={(value) => {
                if (!selectedPoint || isSessionInputLocked || !session) return;
                const savedValue =
                  session.focusedEntry?.entryIndex === selectedEntryIndex
                    ? session.focusedEntry.values.find((row) => row.templateItemId === selectedPoint.id)?.value
                    : undefined;
                if (savedValue !== value) {
                  setOutOfToleranceAcknowledgedByEntryIndex((prev) => {
                    const current = prev[selectedEntryIndex] ?? {};
                    if (current[selectedPoint.id] !== true) return prev;
                    const nextForEntry = { ...current };
                    delete nextForEntry[selectedPoint.id];
                    return {
                      ...prev,
                      [selectedEntryIndex]: nextForEntry
                    };
                  });
                }
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
              onCommitValue={isSessionInputLocked ? undefined : onValuePanelCommit}
            />
          </div>

          <div className="flex shrink-0 flex-col gap-2 rounded border border-white/15 bg-slate-800/70 p-2">
            {actionError ? (
              <p className="rounded border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
                {actionError}
              </p>
            ) : null}
            {isInspectorMode && pendingInspectorJudgementValues.length > 0 ? (
              <div className="rounded border border-amber-300/40 bg-amber-500/10 p-2">
                <p className="text-sm font-semibold text-amber-100">測定者NGの最終判定</p>
                <div className="mt-2 space-y-2">
                  {pendingInspectorJudgementValues.map((value) => {
                    const item = session.template.items.find((row) => row.id === value.templateItemId);
                    const selectedStatus =
                      selectedInspectorJudgements[value.templateItemId] ?? value.judgementStatus;
                    return (
                      <div key={value.templateItemId} className="rounded border border-white/15 bg-slate-950/40 p-2">
                        <p className="text-xs text-white/75">
                          {item?.measurementLabel ?? item?.measurementPoint ?? value.templateItemId}
                          {' / 測定者: '}{value.operatorValueSnapshot ?? '-'}
                          {' / 検査員: '}{value.value ?? '-'}
                        </p>
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          {(['FINAL_OK', 'FINAL_NG'] as const).map((status) => (
                            <SelfInspectionKioskButton
                              key={status}
                              type="button"
                              size="actionCompact"
                              pressed={selectedStatus === status}
                              disabled={isSavingEntry}
                              onClick={() => {
                                setInspectorJudgementsByEntryIndex((previous) => ({
                                  ...previous,
                                  [selectedEntryIndex]: {
                                    ...(previous[selectedEntryIndex] ?? {}),
                                    [value.templateItemId]: status
                                  }
                                }));
                              }}
                            >
                              {status === 'FINAL_OK' ? '最終OK' : '最終NG'}
                            </SelfInspectionKioskButton>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <SelfInspectionKioskButton
                  type="button"
                  size="actionCompact"
                  disabled={!canSaveInspectorJudgements || isSavingEntry}
                  highlighted={canSaveInspectorJudgements && !isSavingEntry}
                  onClick={() => void saveInspectorJudgements()}
                >
                  最終判定を保存
                </SelfInspectionKioskButton>
              </div>
            ) : null}
            <div
              className="grid grid-cols-2 gap-1 rounded-md bg-slate-900/50 p-1"
              data-self-inspection-session-actions
            >
              <SelfInspectionKioskButton
                type="button"
                size="actionCompact"
                disabled={!saveActionState.enabled}
                highlighted={saveActionState.enabled}
                onPointerDownCapture={consumeNextBlurGuideAdvance}
                onClick={() => void persistCurrentEntry()}
              >
                入力を保存
              </SelfInspectionKioskButton>
              <SelfInspectionKioskButton
                type="button"
                size="actionCompact"
                disabled={!completeActionState.enabled}
                highlighted={completeActionState.enabled}
                title={completeActionHint ?? undefined}
                onPointerDownCapture={consumeNextBlurGuideAdvance}
                onClick={() => void completeSession()}
              >
                {isInspectorMode
                  ? '最終判定を確定して完了'
                  : session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT' &&
                      session.recordApprovalRequiredAt &&
                      !session.recordApproval
                    ? '測定を終了'
                    : '自主検査を完了'}
              </SelfInspectionKioskButton>
            </div>
            {!actionError && (completeActionState.reason === 'record_approval_required' || isInspectorMode) && completeActionHint ? (
              <p className="rounded border border-sky-400/30 bg-sky-500/15 px-3 py-2 text-sm text-sky-100">
                {completeActionHint}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-800/70 p-2">
            <InspectionDrawingPointSummaryList
              points={activeDraft?.points ?? []}
              selectedPointId={selectedPoint?.id ?? null}
              disabled={isSessionInputLocked}
              showMeasurementStatus
              layout="twoColumn"
              onSelectPointerDownCapture={consumeNextBlurGuideAdvance}
              onSelectPoint={(pointId) => {
                handleSelectPointManual(pointId);
                setActionError(null);
              }}
              variant="sidebar"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
