import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  cancelTorqueTrainingSession,
  getTorqueTrainingSession,
  listTorqueTrainingPrograms,
  resolveTorqueTrainingOperator,
  startTorqueTrainingSession,
  type TorqueTrainingAttemptApi,
  type TorqueTrainingOperatorContextApi,
  type TorqueTrainingProgramApi,
  type TorqueTrainingSessionApi
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Button } from '../../components/ui/Button';
import {
  AssemblySessionStatusNotice,
  requiresFreshAssemblyWrenchConfirmation,
  useTorqueRecordLiveRefresh
} from '../../features/assembly';
import { TorqueTrainingAdminDialog } from '../../features/assembly/torque-training/TorqueTrainingAdminDialog';
import { TorqueTrainingAttemptSlots, type TorqueTrainingSlotItem } from '../../features/assembly/torque-training/TorqueTrainingAttemptSlots';
import { TorqueTrainingEyeOffIcon, TorqueTrainingNfcIcon, TorqueTrainingWrenchIcon } from '../../features/assembly/torque-training/TorqueTrainingIcons';
import {
  formatSignedTrainingPercent,
  formatTrainingPercent,
  summarizeTrainingSessionAttempts,
  trainingTendency
} from '../../features/assembly/torque-training/torqueTrainingKpiPresentation';
import { TorqueTrainingPersonalRecord } from '../../features/assembly/torque-training/TorqueTrainingPersonalRecord';
import { TorqueTrainingProgramMatrix } from '../../features/assembly/torque-training/TorqueTrainingProgramMatrix';
import { TorqueTrainingRecentSessions } from '../../features/assembly/torque-training/TorqueTrainingRecentSessions';
import { TorqueTrainingSettingsAccessDialog } from '../../features/assembly/torque-training/TorqueTrainingSettingsAccessDialog';
import { TorqueTrainingStepper } from '../../features/assembly/torque-training/TorqueTrainingStepper';
import { TorqueTrainingTargetBand, type TorqueTrainingTargetBandPoint } from '../../features/assembly/torque-training/TorqueTrainingTargetBand';
import { TENDENCY_TEXT_CLASS, TorqueTrainingTeamKpiBand } from '../../features/assembly/torque-training/TorqueTrainingTeamKpiBand';
import { presentTorqueTrainingSetupReason } from '../../features/assembly/torque-training/torqueTrainingWrenchPreparation';
import { TorqueTrainingWrenchPreparationPanel } from '../../features/assembly/torque-training/TorqueTrainingWrenchPreparationPanel';
import { useTorqueTrainingAdminController } from '../../features/assembly/torque-training/useTorqueTrainingAdminController';
import { useTorqueTrainingCompletion } from '../../features/assembly/torque-training/useTorqueTrainingCompletion';
import { useTorqueTrainingTeamOverview } from '../../features/assembly/torque-training/useTorqueTrainingTeamOverview';
import { useTorqueTrainingWrenchPreparation } from '../../features/assembly/torque-training/useTorqueTrainingWrenchPreparation';
import {
  TorqueWrenchTakeoverPanel,
  useTorqueWrenchConnection
} from '../../features/torque-wrench-connection';
import { useNfcStream } from '../../hooks/useNfcStream';

function requestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const NO_KNOWN_TRAINING_SOURCE_EVENT_KEYS: ReadonlySet<string> = new Set();

function toTrainingSlotItem(attempt: TorqueTrainingAttemptApi): TorqueTrainingSlotItem {
  const deviation = attempt.deviationPercent === null ? null : `差 ${formatSignedTrainingPercent(Number(attempt.deviationPercent))}`;
  const detail = attempt.settingVerificationMode === 'BOLT_CONDITION_ONLY'
    ? [deviation, '設定照合対象外'].filter(Boolean).join(' / ')
    : deviation;
  return { key: attempt.id, valueNm: attempt.valueNm, judgement: attempt.judgement, detail };
}

function toTargetBandPoints(attempts: TorqueTrainingAttemptApi[]): TorqueTrainingTargetBandPoint[] {
  return attempts
    .filter((attempt) => attempt.accepted && attempt.attemptNo !== null && attempt.valueNm !== null && attempt.judgement !== 'IGNORED')
    .map((attempt) => ({
      key: attempt.id,
      attemptNo: attempt.attemptNo!,
      valueNm: Number(attempt.valueNm),
      judgement: attempt.judgement as TorqueTrainingTargetBandPoint['judgement']
    }))
    .filter((point) => Number.isFinite(point.valueNm));
}

function targetBandLimits(attempts: TorqueTrainingAttemptApi[]) {
  const reference = attempts.find((attempt) => attempt.lowerLimit !== null && attempt.nominalTorque !== null && attempt.upperLimit !== null);
  if (!reference) return null;
  const limits = {
    lowerNm: Number(reference.lowerLimit),
    nominalNm: Number(reference.nominalTorque),
    upperNm: Number(reference.upperLimit)
  };
  return Object.values(limits).every(Number.isFinite) && limits.lowerNm < limits.upperNm ? limits : null;
}

export function KioskAssemblyTrainingPage() {
  const navigate = useNavigate();
  const nfcEvent = useNfcStream(true);
  const [operator, setOperator] = useState<TorqueTrainingOperatorContextApi | null>(null);
  const [programs, setPrograms] = useState<TorqueTrainingProgramApi[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [session, setSession] = useState<TorqueTrainingSessionApi | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [agentWrenchSerial, setAgentWrenchSerial] = useState<string | null>(null);
  const [wrenchDetectionReason, setWrenchDetectionReason] = useState<string | null>(null);
  const [trainingWrenchConfirmation, setTrainingWrenchConfirmation] = useState<{
    id: string;
    profileId: string;
    settingVerificationMode: 'REGISTERED_SETTING' | 'BOLT_CONDITION_ONLY';
  } | null>(null);
  const [connectionRetryRequired, setConnectionRetryRequired] = useState(false);
  const [settingsGateOpen, setSettingsGateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Only messages the stepper cannot express (retry, takeover, stale state).
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<TorqueTrainingSessionApi | null>(null);
  const operatorRef = useRef<TorqueTrainingOperatorContextApi | null>(null);
  const operatorUidRef = useRef<string | null>(null);
  const nfcReadGenerationRef = useRef(0);
  const agentRequestIdRef = useRef<string | null>(null);
  const operationInFlightRef = useRef(false);
  const { overview: teamOverview, refresh: refreshTeamOverview } = useTorqueTrainingTeamOverview();

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { operatorRef.current = operator; }, [operator]);
  useEffect(() => () => {
    const current = sessionRef.current;
    if (current?.status === 'IN_PROGRESS') {
      void cancelTorqueTrainingSession(current.id, '訓練画面離脱').catch(() => undefined);
    }
  }, []);

  const torqueConnection = useTorqueWrenchConnection({
    enabled: Boolean(session && session.status === 'IN_PROGRESS'),
    targetKind: 'training',
    sessionId: session?.id ?? null,
    currentTemplateBoltId: null,
    confirmationId: trainingWrenchConfirmation?.id ?? null,
    torqueWrenchProfileId: trainingWrenchConfirmation?.profileId ?? null
  });

  const {
    result: preparationResult,
    status: preparationStatus,
    prepare: prepareWrench,
    reset: resetPreparation
  } = useTorqueTrainingWrenchPreparation({
    sessionId: session?.id ?? null,
    torqueWrenchProfileId: selectedProfileId || null
  });

  const loadPrograms = useCallback(async () => {
    try {
      setPrograms(await listTorqueTrainingPrograms());
    } catch (cause) {
      setError(getApiErrorMessage(cause, '訓練メニューを読み込めませんでした。'));
    }
  }, []);

  const adminController = useTorqueTrainingAdminController({
    isOpen: settingsOpen,
    accessMode: 'kiosk',
    onProgramsChanged: loadPrograms
  });
  const { authenticateSettingsAccessPassword, clearSettingsAccess } = adminController;

  useEffect(() => () => {
    // The operation password is owned only by the controller's React state.
    // Clear it when the kiosk route is left, even if the dialog is still open.
    clearSettingsAccess();
  }, [clearSettingsAccess]);

  useEffect(() => {
    void loadPrograms();
  }, [loadPrograms]);

  useEffect(() => {
    if (!nfcEvent?.uid) return;
    const readGeneration = nfcReadGenerationRef.current + 1;
    nfcReadGenerationRef.current = readGeneration;
    if (sessionRef.current?.status === 'COMPLETED') return;
    setBusy(true);
    setError(null);
    void resolveTorqueTrainingOperator(nfcEvent.uid)
      .then((context) => {
        if (readGeneration !== nfcReadGenerationRef.current) return;
        const current = sessionRef.current;
        if (current?.status === 'COMPLETED') return;
        if (current?.status === 'IN_PROGRESS' && operatorRef.current && operatorRef.current.employee.id !== context.employee.id) {
          throw new Error('進行中の訓練を終了してから別のNFCタグを読み取ってください。');
        }
        operatorUidRef.current = nfcEvent.uid;
        setOperator(context);
        setSession(context.currentSession);
        setWrenchDetectionReason(null);
        setMessage(null);
      })
      .catch((cause) => {
        if (readGeneration === nfcReadGenerationRef.current) {
          setError(getApiErrorMessage(cause, 'NFCタグを確認できませんでした。'));
        }
      })
      .finally(() => {
        if (readGeneration === nfcReadGenerationRef.current) setBusy(false);
      });
  }, [nfcEvent]);

  const selectedVersion = useMemo(
    () => programs.flatMap((program) => program.versions).find((version) => version.id === selectedVersionId) ?? null,
    [programs, selectedVersionId]
  );

  const selectedVersionReady = selectedVersion?.setupState === 'READY';
  const setupReason = presentTorqueTrainingSetupReason(selectedVersion?.setupStateReason);

  const selectedTrainingProfile = useMemo(
    () => session?.program.torqueWrenchProfiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [selectedProfileId, session?.program.torqueWrenchProfiles]
  );
  const settingVerificationMode =
    preparationResult?.settingVerificationMode
    ?? trainingWrenchConfirmation?.settingVerificationMode
    ?? selectedTrainingProfile?.settingVerificationMode
    ?? 'REGISTERED_SETTING';

  useTorqueRecordLiveRefresh({
    enabled: Boolean(session?.id && session.status === 'IN_PROGRESS'),
    sessionId: session?.id ?? null,
    knownSourceEventKeys: NO_KNOWN_TRAINING_SOURCE_EVENT_KEYS,
    loadSession: getTorqueTrainingSession,
    onSessionLoaded: setSession,
    pollIntervalMs: 2000
  });

  const handleTrainingCompleted = useCallback(() => {
    const completedSessionId = sessionRef.current?.id;
    setMessage(null);
    void refreshTeamOverview();
    const authenticatedUid = operatorUidRef.current;
    const employeeId = operatorRef.current?.employee.id;
    if (!authenticatedUid || !completedSessionId || !employeeId) return;
    void resolveTorqueTrainingOperator(authenticatedUid)
      .then((context) => {
        const current = sessionRef.current;
        if (
          !current
          || current.id !== completedSessionId
          || current.status !== 'COMPLETED'
          || context.employee.id !== employeeId
        ) return;
        setOperator(context);
      })
      .catch((cause) => {
        if (sessionRef.current?.id === completedSessionId) {
          setError(getApiErrorMessage(cause, '成長度合いを更新できませんでした。'));
        }
      });
  }, [refreshTeamOverview]);

  useTorqueTrainingCompletion({
    sessionId: session?.id ?? null,
    status: session?.status ?? null,
    hasLocalLease: torqueConnection.leaseOwned,
    releaseLocalLease: torqueConnection.release,
    onCompleted: handleTrainingCompleted
  });

  useEffect(() => {
    if (
      !session
      || session.status !== 'IN_PROGRESS'
      || torqueConnection.leaseOwned
      || trainingWrenchConfirmation
      // Once the server setting is registered, a heartbeat without the
      // optional serial list must not clear the selected profile. Keeping it
      // is what makes an agent-only retry possible without a second API call.
      || preparationResult
      || preparationStatus === 'registering'
      || connectionRetryRequired
    ) return;
    const serials = torqueConnection.status?.wrenchSerialNumbers ?? [];
    const matches = session.program.torqueWrenchProfiles.filter((profile) => serials.includes(profile.serialNumber));
    if (matches.length === 1) {
      setSelectedProfileId(matches[0].id);
      setAgentWrenchSerial(matches[0].serialNumber);
      setWrenchDetectionReason(null);
      setError(null);
    } else {
      setSelectedProfileId('');
      setAgentWrenchSerial(serials.length === 1 ? serials[0] : null);
      const detectionReason = serials.length === 0
        ? torqueConnection.reachability === 'reachable'
          ? 'torque-agentから物理レンチの製造番号を取得できません。端末設定を確認してください。'
          : null
        : matches.length === 0
          ? `検出した物理レンチ（${serials.join('、')}）はこの訓練版に割り当てられていません。`
          : `接続中の物理レンチを一意に特定できません（候補が${matches.length}台あります）。対象レンチを1台だけ接続してください。`;
      setWrenchDetectionReason(detectionReason);
      if (detectionReason) setError(detectionReason);
    }
  }, [connectionRetryRequired, preparationResult, preparationStatus, session, torqueConnection.leaseOwned, torqueConnection.reachability, torqueConnection.status, trainingWrenchConfirmation]);

  useEffect(() => {
    if (
      torqueConnection.status?.state !== 'expired'
      || trainingWrenchConfirmation?.settingVerificationMode !== 'BOLT_CONDITION_ONLY'
    ) return;
    // The one-touch BOLT path starts with a fresh confirmation after expiry.
    // Registered-setting sessions retain their existing two-step behavior.
    setTrainingWrenchConfirmation(null);
    setConnectionRetryRequired(false);
    agentRequestIdRef.current = null;
    resetPreparation();
  }, [resetPreparation, torqueConnection.status?.state, trainingWrenchConfirmation?.settingVerificationMode]);

  const start = async () => {
    if (!nfcEvent?.uid || !selectedVersionId) return;
    setBusy(true);
    setError(null);
    setConnectionRetryRequired(false);
    agentRequestIdRef.current = null;
    setWrenchDetectionReason(null);
    resetPreparation();
    try {
      const next = await startTorqueTrainingSession({ uid: nfcEvent.uid, programVersionId: selectedVersionId, requestId: requestId('training-session') });
      setSession(next);
      setMessage(null);
    } catch (cause) {
      setError(getApiErrorMessage(cause, '訓練を開始できませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  const confirmAndAcquire = async () => {
    if (!session || !nfcEvent?.uid || !selectedProfileId) return;
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setConnectionRetryRequired(false);
    let preparationCompleted = Boolean(preparationResult);
    try {
      const prepared = preparationResult ?? await prepareWrench({ uid: nfcEvent.uid });
      preparationCompleted = true;
      const preparedMode = prepared.settingVerificationMode;
      // Set confirmation before acquire and pass the same binding explicitly;
      // this avoids acquiring against the previous React render's binding.
      setTrainingWrenchConfirmation({
        id: prepared.confirmationId,
        profileId: prepared.torqueWrenchProfileId,
        settingVerificationMode: preparedMode
      });
      const connectionRequestId = agentRequestIdRef.current ?? requestId('training-agent-lease');
      agentRequestIdRef.current = connectionRequestId;
      const agentStatus = await torqueConnection.acquire(connectionRequestId, {
        targetKind: 'training',
        sessionId: session.id,
        currentTemplateBoltId: null,
        confirmationId: prepared.confirmationId,
        torqueWrenchProfileId: prepared.torqueWrenchProfileId
      });
      if (requiresFreshAssemblyWrenchConfirmation(agentStatus)) throw agentStatus;
      if (agentStatus && !agentStatus.leaseOwned && agentStatus.state !== 'owned_by_other') {
        throw new Error(agentStatus.lastError ?? 'Pi3 torque-agentへ接続できませんでした。');
      }
      // Keep target values visible until the local lease is actually
      // acquired. A recoverable agent failure must retry only the local
      // connection and must not switch to the takeover view prematurely.
      setSession(await getTorqueTrainingSession(session.id));
      setMessage(agentStatus?.state === 'owned_by_other'
        ? '別端末が使用中です。現物が手元にある場合だけ引継ぎ操作を行ってください。'
        : null);
    } catch (cause) {
      if (requiresFreshAssemblyWrenchConfirmation(cause)) {
        // The server/agent fenced this confirmation or detected a changed
        // binding. Drop both snapshots so the next click creates a fresh one.
        setTrainingWrenchConfirmation(null);
        setConnectionRetryRequired(false);
        agentRequestIdRef.current = null;
        resetPreparation();
        try {
          setSession(await getTorqueTrainingSession(session.id));
        } catch (refreshCause) {
          setError(getApiErrorMessage(refreshCause, '訓練状態を更新できませんでした。'));
        }
        setMessage('確認状態が古くなりました。訓練対象とレンチを確認して接続し直してください。');
      } else if (preparationCompleted) {
        // The server transaction already registered the setting.  A local
        // agent failure is recoverable by this same button and must not cause
        // another setting history/confirmation request.
        torqueConnection.clearError();
        setConnectionRetryRequired(true);
        setMessage(settingVerificationMode === 'BOLT_CONDITION_ONLY'
          ? '確認済み・接続を再試行'
          : '設定登録済みです。torque-agent接続のみ再試行してください。');
      } else {
        setError(getApiErrorMessage(cause, 'レンチを接続できませんでした。'));
      }
    } finally {
      setBusy(false);
      operationInFlightRef.current = false;
    }
  };

  const openSettings = () => setSettingsGateOpen(true);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsGateOpen(false);
    clearSettingsAccess();
  }, [clearSettingsAccess]);

  const authenticateSettings = useCallback(async (accessPassword: string) => {
    const authenticated = await authenticateSettingsAccessPassword(accessPassword);
    if (!authenticated) return;
    setSettingsGateOpen(false);
    setSettingsOpen(true);
  }, [authenticateSettingsAccessPassword]);

  const resetOperator = async () => {
    nfcReadGenerationRef.current += 1;
    if (session?.status === 'IN_PROGRESS') {
      try {
        await cancelTorqueTrainingSession(session.id, '作業者切替');
      } catch (cause) {
        setError(getApiErrorMessage(cause, '進行中の訓練を終了できませんでした。'));
        return;
      }
      await torqueConnection.release('TRAINING_OPERATOR_RESET').catch(() => undefined);
    }
    operatorUidRef.current = null;
    setOperator(null);
    setSession(null);
    setSelectedVersionId('');
    setSelectedProfileId('');
    setAgentWrenchSerial(null);
    setWrenchDetectionReason(null);
    setTrainingWrenchConfirmation(null);
    setConnectionRetryRequired(false);
    agentRequestIdRef.current = null;
    operationInFlightRef.current = false;
    resetPreparation();
    setMessage(null);
  };

  const takeoverTrainingWrench = async () => {
    if (!session || !trainingWrenchConfirmation) return;
    setBusy(true);
    setError(null);
    try {
      await torqueConnection.takeover('訓練者が現物を手元で二段階確認', requestId('training-agent-takeover'));
      setConnectionRetryRequired(false);
      setSession(await getTorqueTrainingSession(session.id));
      setMessage('レンチの接続権を引き継ぎました。Bluetooth接続待ちの間は締付けないでください。');
    } catch (cause) {
      if (requiresFreshAssemblyWrenchConfirmation(cause)) {
        setTrainingWrenchConfirmation(null);
        setConnectionRetryRequired(false);
        agentRequestIdRef.current = null;
        resetPreparation();
        try {
          setSession(await getTorqueTrainingSession(session.id));
        } catch (refreshCause) {
          setError(getApiErrorMessage(refreshCause, '訓練状態を更新できませんでした。'));
        }
        setMessage('確認状態が古くなりました。訓練対象とレンチを確認して接続し直してください。');
      } else {
        setError(getApiErrorMessage(cause, 'レンチ接続権を引き継げませんでした。'));
      }
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const visibleError = connectionRetryRequired ? error : torqueConnection.error ?? error;
  const notice = visibleError ?? message;
  const regularAttemptIds = new Set<string>();
  const slotItems: Array<TorqueTrainingSlotItem | null> = session
    ? Array.from({ length: session.targetAttemptCount }, (_, index) => {
        const attempt = session.attempts.find((item) => item.attemptNo === index + 1);
        if (!attempt) return null;
        regularAttemptIds.add(attempt.id);
        return toTrainingSlotItem(attempt);
      })
    : [];
  const outOfSequenceSlotItems = session
    ? session.attempts.filter((attempt) => !regularAttemptIds.has(attempt.id)).map(toTrainingSlotItem)
    : [];
  const acceptedCount = session?.attempts.filter((attempt) => attempt.accepted).length ?? 0;
  const currentStep = !operator
    ? 0
    : !session || session.status === 'CANCELLED'
      ? 1
      : session.status === 'COMPLETED'
        ? 4
        : torqueConnection.leaseOwned ? 3 : 2;
  const completedSummary = session?.status === 'COMPLETED' ? summarizeTrainingSessionAttempts(session.attempts) : null;
  const completedTendency = trainingTendency(completedSummary?.meanDeviationPercent);
  const completedLimits = session?.status === 'COMPLETED' ? targetBandLimits(session.attempts) : null;
  const focusFingerprint = session?.conditionFingerprint ?? selectedVersion?.conditionFingerprint ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-slate-800 p-3 text-white">
      <header className="grid min-h-16 grid-cols-1 items-center gap-3 rounded border border-white/15 bg-slate-900/80 px-4 py-2 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <h1 className="text-2xl font-bold">締付トルク訓練</h1>
        <TorqueTrainingStepper current={currentStep} />
        <div className="flex gap-2">
          <Button variant="ghostOnDark" className="h-11" onClick={openSettings}>設定</Button>
          <Button variant="ghostOnDark" className="h-11" onClick={() => navigate('/kiosk/assembly')}>組立へ戻る</Button>
        </div>
      </header>

      <TorqueTrainingTeamKpiBand recent={teamOverview?.recent} allTime={teamOverview?.allTime} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_34rem] 2xl:grid-cols-[minmax(0,1fr)_38rem]">
        <section className="flex min-w-0 flex-col gap-5 rounded border border-white/10 bg-slate-900/70 p-5" data-testid="torque-training-preparation">
          {operator ? (
            <div className="flex flex-wrap items-center gap-4" data-testid="torque-training-operator-card">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-400/15 text-xl font-bold text-emerald-300" aria-hidden="true">
                {operator.employee.displayName.slice(0, 1)}
              </span>
              <div>
                <p className="text-2xl font-bold">{operator.employee.displayName}</p>
                <p className="text-sm text-white/60">社員コード {operator.employee.employeeCode}</p>
              </div>
              {!session || session.status === 'IN_PROGRESS' ? (
                <Button variant="ghostOnDark" className="ml-auto h-11" onClick={() => void resetOperator()}>別の作業者</Button>
              ) : null}
            </div>
          ) : (
            <div
              className="flex items-center gap-5 self-start rounded-xl border-2 border-cyan-300 bg-cyan-300/10 py-4 pl-4 pr-7"
              data-testid="torque-training-nfc-guide"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-cyan-300 text-slate-900">
                <TorqueTrainingNfcIcon className="h-9 w-9" />
              </span>
              <span className="text-3xl font-bold text-cyan-300">タグをかざす</span>
            </div>
          )}

          {notice ? (
            <AssemblySessionStatusNotice message={notice} tone={visibleError ? 'error' : 'default'} className="self-start text-base" />
          ) : null}

          {!session ? (
            <>
              <TorqueTrainingProgramMatrix
                programs={programs}
                selectedVersionId={selectedVersionId}
                disabled={!operator || busy}
                onSelect={setSelectedVersionId}
              />
              {operator && selectedVersion ? (
                <div className="flex flex-wrap items-center gap-5">
                  <p className="text-2xl font-bold" title={selectedVersion.displayName}>
                    {selectedVersion.nominalDiameter} {selectedVersion.material}
                    <span className="ml-3 text-base font-normal text-white/60">首下{selectedVersion.boltLengthMm}mm · {selectedVersion.strengthClass}</span>
                  </p>
                  {!selectedVersionReady ? <p className="text-base text-amber-200">{setupReason ?? '対応レンチ未登録'}</p> : null}
                  <Button className="h-11 px-6 text-lg" onClick={() => void start()} disabled={!selectedVersionReady || busy}>
                    {busy ? '処理中...' : '訓練を開始'}
                  </Button>
                </div>
              ) : null}
            </>
          ) : session.status === 'IN_PROGRESS' ? (
            <>
              <div className="flex flex-wrap items-center gap-2" data-testid="torque-training-target-summary">
                <span className="rounded-full border border-white/10 bg-slate-800 px-4 py-1.5 text-lg font-bold" title={session.program.displayName}>
                  {session.program.nominalDiameter} {session.program.material} 首下{session.program.boltLengthMm}mm
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-800 px-4 py-1.5 text-base text-white/80">
                  <TorqueTrainingEyeOffIcon className="h-5 w-5" />
                  目標値は結果で表示
                </span>
              </div>
              {!torqueConnection.leaseOwned ? (
                torqueConnection.state === 'owned_by_other' && trainingWrenchConfirmation ? (
                  <TorqueWrenchTakeoverPanel
                    owner={torqueConnection.status?.owner ?? null}
                    targetKind="training"
                    busy={busy || torqueConnection.busy}
                    onTakeover={takeoverTrainingWrench}
                  />
                ) : (
                  <div className="w-full max-w-md" data-testid="torque-training-wrench-detection">
                    <TorqueTrainingWrenchPreparationPanel
                      target={session.program}
                      wrenchSerialNumber={agentWrenchSerial}
                      disabledReason={preparationResult ? null : wrenchDetectionReason}
                      busy={busy || torqueConnection.busy || preparationStatus === 'registering'}
                      settingRegistered={preparationStatus === 'registered' && settingVerificationMode === 'REGISTERED_SETTING'}
                      connectionRetryRequired={connectionRetryRequired}
                      settingVerificationMode={settingVerificationMode}
                      onPrepareAndConnect={() => void confirmAndAcquire()}
                    />
                  </div>
                )
              ) : (
                <div className="flex flex-wrap items-center gap-4" data-testid="torque-training-wrench-connection">
                  <span className={`grid h-16 w-16 place-items-center rounded-xl ${torqueConnection.ready ? 'bg-emerald-300 text-slate-900' : 'bg-slate-700 text-white/70'}`}>
                    <TorqueTrainingWrenchIcon className="h-9 w-9" />
                  </span>
                  {torqueConnection.ready ? (
                    <p className="text-4xl font-black">
                      締付 {Math.min(acceptedCount + 1, session.targetAttemptCount)}
                      <span className="ml-2 text-2xl font-bold text-white/60">/ {session.targetAttemptCount}本目</span>
                    </p>
                  ) : (
                    <div>
                      <p className="text-2xl font-bold">{torqueConnection.state === 'handoff_wait' ? '引継ぎ待機中' : 'Bluetooth接続待ち'}</p>
                      <p className="text-base text-amber-200">青ランプ点灯まで締付けない</p>
                    </div>
                  )}
                </div>
              )}
              <TorqueTrainingAttemptSlots
                items={slotItems}
                highlightNext={torqueConnection.leaseOwned && torqueConnection.ready}
                outOfSequenceItems={outOfSequenceSlotItems}
              />
            </>
          ) : session.status === 'COMPLETED' ? (
            <div className="flex flex-col gap-4" data-testid="torque-training-completed-result">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <p className="text-6xl font-black leading-none text-emerald-300">
                  {completedSummary?.okCount ?? 0}
                  <span className="ml-2 text-3xl text-white">/ {session.targetAttemptCount}本 合格</span>
                </p>
                <p className="text-lg text-white/60" title={session.program.displayName}>
                  {session.program.nominalDiameter} {session.program.material}
                  {' · '}平均ずれ <b className="text-white">{formatTrainingPercent(completedSummary?.meanAbsoluteErrorPercent)}%</b>
                  {' · '}傾向 <b className={TENDENCY_TEXT_CLASS[completedTendency.tone]}>{completedTendency.label} {completedTendency.signedLabel}</b>
                </p>
              </div>
              {completedLimits ? (
                <TorqueTrainingTargetBand {...completedLimits} points={toTargetBandPoints(session.attempts)} />
              ) : null}
              <TorqueTrainingAttemptSlots items={slotItems} highlightNext={false} outOfSequenceItems={outOfSequenceSlotItems} />
              <div>
                <Button className="h-11 px-6 text-lg" onClick={() => void resetOperator()}>訓練完了</Button>
              </div>
            </div>
          ) : (
            <TorqueTrainingAttemptSlots items={slotItems} highlightNext={false} outOfSequenceItems={outOfSequenceSlotItems} />
          )}
        </section>

        <aside className="min-w-0 rounded border border-white/10 bg-slate-900/70 p-5">
          {operator ? (
            <TorqueTrainingPersonalRecord
              metrics={operator.metrics}
              focusFingerprint={focusFingerprint}
              completedSessionId={session?.status === 'COMPLETED' ? session.id : null}
              team={teamOverview?.recent}
            />
          ) : (
            <TorqueTrainingRecentSessions sessions={teamOverview?.recentSessions} />
          )}
        </aside>
      </main>

      <TorqueTrainingAdminDialog
        isOpen={settingsOpen}
        onClose={closeSettings}
        controller={adminController}
      />
      <TorqueTrainingSettingsAccessDialog
        open={settingsGateOpen}
        busy={adminController.adminBusy}
        error={adminController.error}
        onSubmit={authenticateSettings}
        onCancel={closeSettings}
      />
    </div>
  );
}
