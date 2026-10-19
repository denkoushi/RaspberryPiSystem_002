import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { getAssemblyWorkSession, getBusinessHermesAssemblyGuide } from '../../../api/client';
import {
  currentAssemblyArea,
  currentAssemblyBolt,
  latestStatusByBolt,
  readAssemblyApiErrorMessage,
  resolveAssemblyCheckSummary,
  sessionCheckItemsToCanvas,
  templateToCanvasBolts,
  useAssemblyWrenchPreparation,
  useAssemblyWorkProcedureSequence,
  useTorqueRecordLiveRefresh
} from '../../../features/assembly';
import { useTorqueWrenchConnection } from '../../../features/torque-wrench-connection';

import type { BusinessHermesGuideResponse } from '../../../api/domains/assembly';
import type { AssemblyProcedureSequencePageDto, AssemblyWorkSessionDto } from '../../../features/assembly/types';
import type { UseTorqueWrenchConnectionResult } from '../../../features/torque-wrench-connection/useTorqueWrenchConnection';

export function useAssemblyWorkSessionState() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const incomingAccessGrant =
    (location.state as { assemblyOperatorAccessGrant?: { sessionId?: string } } | null)
      ?.assemblyOperatorAccessGrant?.sessionId === sessionId;
  const [session, setSession] = useState<AssemblyWorkSessionDto | null>(null);
  const [authorizedSessionId, setAuthorizedSessionId] = useState<string | null>(
    incomingAccessGrant ? sessionId ?? null : null
  );
  const [operatorGateBusy, setOperatorGateBusy] = useState(false);
  const [operatorGateError, setOperatorGateError] = useState<string | null>(null);
  const [currentSequencePage, setCurrentSequencePage] = useState<AssemblyProcedureSequencePageDto | null>(null);
  const [torqueValue, setTorqueValue] = useState('');
  const [torqueSource, setTorqueSource] = useState<'manual' | 'mock'>('manual');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hermesGuide, setHermesGuide] = useState<BusinessHermesGuideResponse | null>(null);
  const [hermesGuideBusy, setHermesGuideBusy] = useState(false);
  const hermesGuideControllerRef = useRef<AbortController | null>(null);
  const activeHermesRevisionRef = useRef<string | null>(null);
  const assemblyConnectionRef = useRef<Pick<UseTorqueWrenchConnectionResult, 'acquire' | 'clearError'> | null>(null);
  const operatorAuthorized = Boolean(
    session && (session.status !== 'in_progress' || authorizedSessionId === session.id)
  );
  const sessionActive = Boolean(operatorAuthorized && session?.status === 'in_progress');
  const traceabilityRequired = session?.template.traceabilityMode === 'REQUIRED';
  const refreshAssemblySession = useCallback(async () => {
    if (!sessionId) return;
    try {
      setSession(await getAssemblyWorkSession(sessionId));
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '作業データの更新に失敗しました。'));
    }
  }, [sessionId]);
  const {
    compatibleWrenches,
    selectedProfileId,
    setSelectedProfileId,
    selectedCompatibleWrench,
    confirmation,
    confirmationReused,
    confirmationLookupState,
    connectionRetryRequired,
    preparationBusy,
    boltConditionOnly,
    confirmPhysicalWrench,
    connectBoltConditionWrench,
    resetAfterRelease,
    resetAfterExpiry
  } = useAssemblyWrenchPreparation({
    sessionId: session?.id ?? null,
    currentTemplateBoltId: session?.currentBoltId ?? null,
    sessionActive,
    traceabilityRequired,
    connectionRef: assemblyConnectionRef,
    onConditionStale: () => { void refreshAssemblySession(); },
    onMessage: setMessage
  });
  const torqueConnection = useTorqueWrenchConnection({
    enabled: Boolean(sessionActive && traceabilityRequired),
    targetKind: 'assembly',
    sessionId: session?.id ?? null,
    currentTemplateBoltId: session?.currentBoltId ?? null,
    confirmationId: confirmation?.id ?? null,
    torqueWrenchProfileId: confirmation?.torqueWrenchProfileId ?? null
  });
  assemblyConnectionRef.current = torqueConnection;
  const {
    state: procedureSequenceState,
    retry: retryProcedureSequence
  } = useAssemblyWorkProcedureSequence({
    sessionId: session?.id ?? null,
    enabled: operatorAuthorized
  });

  useEffect(() => {
    if (!incomingAccessGrant) return;
    setAuthorizedSessionId(sessionId ?? null);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [incomingAccessGrant, location.pathname, location.search, navigate, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      setMessage('作業セッションが指定されていません。');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    void getAssemblyWorkSession(sessionId)
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMessage(readAssemblyApiErrorMessage(e, '作業データの取得に失敗しました。'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const statusByBolt = useMemo(() => (session ? latestStatusByBolt(session) : new Map()), [session]);
  const checkSummary = useMemo(() => (session ? resolveAssemblyCheckSummary(session) : null), [session]);
  const currentArea = session ? currentAssemblyArea(session) : null;
  const currentBolt = session ? currentAssemblyBolt(session) : null;
  const allBoltsComplete = session
    ? session.template.areas.every((area) => area.bolts.every((bolt) => statusByBolt.get(bolt.id) === 'ok'))
    : false;
  const checksComplete = checkSummary?.allRequiredCompleted ?? true;
  const canComplete = Boolean(session && allBoltsComplete && checksComplete && session.status === 'in_progress');
  const knownTorqueSourceEventKeys = useMemo(
    () => new Set(
      session?.torqueRecords
        .map((record) => record.sourceEventKey)
        .filter((eventKey): eventKey is string => Boolean(eventKey)) ?? []
    ),
    [session?.torqueRecords]
  );

  useTorqueRecordLiveRefresh({
    enabled: Boolean(sessionActive && session?.id && traceabilityRequired && confirmation),
    sessionId: session?.id ?? null,
    knownSourceEventKeys: knownTorqueSourceEventKeys,
    loadSession: getAssemblyWorkSession,
    onSessionLoaded: setSession
  });

  useEffect(() => {
    if (torqueConnection.status?.state === 'expired') resetAfterExpiry();
  }, [resetAfterExpiry, torqueConnection.status?.state]);

  const activePageRef = useMemo(() => {
    if (!currentSequencePage) return null;
    return {
      source: currentSequencePage.source,
      documentId: currentSequencePage.documentId,
      pageIndex: currentSequencePage.pageIndex
    };
  }, [currentSequencePage]);

  useEffect(() => {
    if (procedureSequenceState.status !== 'ready') {
      setCurrentSequencePage(null);
    }
  }, [procedureSequenceState.status, session?.id]);

  const hermesStateKey = useMemo(
    () => [
      `session=${session?.id ?? 'none'}`,
      `updatedAt=${session?.updatedAt ?? 'none'}`,
      `status=${session?.status ?? 'none'}`,
      `area=${session?.currentAreaId ?? 'none'}`,
      `bolt=${session?.currentBoltId ?? 'none'}`,
      `procedureSource=${currentSequencePage?.source ?? 'none'}`,
      `procedureDocument=${currentSequencePage?.documentId ?? 'none'}`,
      `procedurePage=${currentSequencePage?.pageIndex ?? 'none'}`,
      `operator=${session?.operatorEmployeeId ?? 'none'}`,
      `device=${session?.clientDeviceId ?? 'none'}`,
      `authorized=${authorizedSessionId === session?.id ? 'yes' : 'no'}`,
      `active=${sessionActive ? 'yes' : 'no'}`
    ].join('|'),
    [authorizedSessionId, currentSequencePage?.documentId, currentSequencePage?.pageIndex, currentSequencePage?.source, session?.clientDeviceId, session?.currentAreaId, session?.currentBoltId, session?.id, session?.operatorEmployeeId, session?.status, session?.updatedAt, sessionActive]
  );
  const hermesRevisionCounterRef = useRef({ stateKey: '', value: 0 });
  if (hermesRevisionCounterRef.current.stateKey !== hermesStateKey) {
    hermesRevisionCounterRef.current = {
      stateKey: hermesStateKey,
      value: hermesRevisionCounterRef.current.value + 1
    };
  }
  const hermesUiRevision = `${hermesRevisionCounterRef.current.value}:${hermesStateKey}`;
  const displayedHermesGuide = hermesGuide?.uiRevision === hermesUiRevision ? hermesGuide : null;

  useEffect(() => {
    activeHermesRevisionRef.current = hermesUiRevision;
    hermesGuideControllerRef.current?.abort();
    hermesGuideControllerRef.current = null;
    setHermesGuide(null);
    setHermesGuideBusy(false);
    return () => {
      hermesGuideControllerRef.current?.abort();
    };
  }, [hermesUiRevision]);

  const requestHermesGuide = useCallback(async () => {
    if (!session || !sessionActive || hermesGuideBusy || activeHermesRevisionRef.current !== hermesUiRevision) return;
    const revision = hermesUiRevision;
    const controller = new AbortController();
    hermesGuideControllerRef.current = controller;
    setHermesGuideBusy(true);
    try {
      const response = await getBusinessHermesAssemblyGuide(
        session.id,
        { uiRevision: revision, eventCode: 'USER_REQUEST' },
        controller.signal
      );
      if (
        !controller.signal.aborted &&
        activeHermesRevisionRef.current === revision &&
        response.uiRevision === revision
      ) {
        setHermesGuide(response);
      }
    } catch {
      if (!controller.signal.aborted && activeHermesRevisionRef.current === revision) {
        setHermesGuide({
          status: 'unavailable',
          uiRevision: revision,
          message: null,
          targetKey: null,
          evidence: []
        });
      }
    } finally {
      if (hermesGuideControllerRef.current === controller) {
        hermesGuideControllerRef.current = null;
        setHermesGuideBusy(false);
      }
    }
  }, [hermesGuideBusy, hermesUiRevision, session, sessionActive]);

  const visibleBoltMarkers = useMemo(() => {
    if (!session || !activePageRef) return [];
    return templateToCanvasBolts(session.template, statusByBolt, activePageRef);
  }, [activePageRef, session, statusByBolt]);

  const visibleCheckMarkers = useMemo(() => {
    if (!session || !activePageRef) return [];
    return sessionCheckItemsToCanvas(session.checkItems, activePageRef, session.template.procedureDocumentId);
  }, [activePageRef, session]);

  const completeDisabledReason = useMemo(() => {
    if (!session || session.status !== 'in_progress') return null;
    if (!allBoltsComplete) return '締付が未完了です。';
    if (!checksComplete && checkSummary) {
      return `必須チェック ${checkSummary.requiredCompleted}/${checkSummary.requiredTotal} です。`;
    }
    return null;
  }, [allBoltsComplete, checkSummary, checksComplete, session]);

  const handleCurrentPageChange = useCallback((page: AssemblyProcedureSequencePageDto | null) => {
    setCurrentSequencePage(page);
  }, []);

  return {
    navigate,
    session,
    setSession,
    setAuthorizedSessionId,
    operatorGateBusy,
    setOperatorGateBusy,
    operatorGateError,
    setOperatorGateError,
    torqueValue,
    setTorqueValue,
    torqueSource,
    setTorqueSource,
    loading,
    busy,
    setBusy,
    restartConfirmOpen,
    setRestartConfirmOpen,
    message,
    setMessage,
    hermesGuideBusy,
    operatorAuthorized,
    sessionActive,
    traceabilityRequired,
    compatibleWrenches,
    selectedProfileId,
    setSelectedProfileId,
    selectedCompatibleWrench,
    confirmation,
    confirmationReused,
    confirmationLookupState,
    connectionRetryRequired,
    preparationBusy,
    boltConditionOnly,
    confirmPhysicalWrench,
    connectBoltConditionWrench,
    resetAfterRelease,
    torqueConnection,
    procedureSequenceState,
    retryProcedureSequence,
    checkSummary,
    currentArea,
    currentBolt,
    allBoltsComplete,
    canComplete,
    displayedHermesGuide,
    requestHermesGuide,
    visibleBoltMarkers,
    visibleCheckMarkers,
    completeDisabledReason,
    handleCurrentPageChange
  };
}
