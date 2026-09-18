import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import {
  cancelTorqueTrainingSession,
  getTorqueTrainingSession,
  listTorqueTrainingPrograms,
  resolveTorqueTrainingOperator,
  startTorqueTrainingSession,
  type TorqueTrainingAttemptApi,
  type TorqueTrainingMetricApi,
  type TorqueTrainingOperatorContextApi,
  type TorqueTrainingProgramApi,
  type TorqueTrainingSessionApi
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Button } from '../../components/ui/Button';
import {
  AssemblySessionStatusNotice,
  TorqueTrainingAttemptHistory,
  type TorqueTrainingAttemptHistoryItem,
  requiresFreshAssemblyWrenchConfirmation,
  useTorqueRecordLiveRefresh
} from '../../features/assembly';
import { TorqueTrainingAdminDialog } from '../../features/assembly/torque-training/TorqueTrainingAdminDialog';
import { TorqueTrainingSettingsAccessDialog } from '../../features/assembly/torque-training/TorqueTrainingSettingsAccessDialog';
import { presentTorqueTrainingSetupReason } from '../../features/assembly/torque-training/torqueTrainingWrenchPreparation';
import { TorqueTrainingWrenchPreparationPanel } from '../../features/assembly/torque-training/TorqueTrainingWrenchPreparationPanel';
import { useTorqueTrainingAdminController } from '../../features/assembly/torque-training/useTorqueTrainingAdminController';
import { useTorqueTrainingCompletion } from '../../features/assembly/torque-training/useTorqueTrainingCompletion';
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

function trainingAttemptPresentation(judgement: TorqueTrainingAttemptApi['judgement']): Pick<TorqueTrainingAttemptHistoryItem, 'resultLabel' | 'resultTone'> {
  if (judgement === 'OK') return { resultLabel: 'OK', resultTone: 'success' };
  if (judgement === 'UNDER') return { resultLabel: '弱い', resultTone: 'failure' };
  if (judgement === 'OVER') return { resultLabel: '強い', resultTone: 'failure' };
  return { resultLabel: '記録外', resultTone: 'neutral' };
}

function toTrainingAttemptHistoryItem(attempt: TorqueTrainingAttemptApi, attemptNo: number): TorqueTrainingAttemptHistoryItem {
  return {
    key: attempt.id,
    attemptNo,
    recordedAt: attempt.recordedAt,
    valueLabel: attempt.valueNm ? `${attempt.valueNm} Nm` : '-',
    ...trainingAttemptPresentation(attempt.judgement),
    details: attempt.nominalTorque
      ? `目標 ${attempt.nominalTorque} Nm / 差 ${attempt.deviationPercent ?? '-'}%${attempt.settingVerificationMode === 'BOLT_CONDITION_ONLY' ? ' / 設定照合対象外' : ''}`
      : attempt.settingVerificationMode === 'BOLT_CONDITION_ONLY' ? '設定照合対象外' : null
  };
}

function passedAttemptCount(attemptCount: number, passRate: number): number {
  return Math.round(attemptCount * passRate);
}

function trainingMetricComparison(metric: TorqueTrainingMetricApi): string | null {
  const latest = metric.sessions[0];
  const previous = metric.sessions[1];
  if (
    !latest
    || !previous
    || latest.attemptCount <= 0
    || previous.attemptCount <= 0
    || latest.attemptCount !== previous.attemptCount
  ) return null;

  const change = passedAttemptCount(latest.attemptCount, latest.passRate)
    - passedAttemptCount(previous.attemptCount, previous.passRate);
  if (change === 0) return '前回と同じ合格回数です';
  return change > 0
    ? `前回より${change}回多く合格しました`
    : `前回より${Math.abs(change)}回少ない合格でした`;
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
  const [message, setMessage] = useState('NFCタグを読み取って訓練者を確認してください。');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<TorqueTrainingSessionApi | null>(null);
  const operatorRef = useRef<TorqueTrainingOperatorContextApi | null>(null);
  const operatorUidRef = useRef<string | null>(null);
  const nfcReadGenerationRef = useRef(0);
  const agentRequestIdRef = useRef<string | null>(null);
  const operationInFlightRef = useRef(false);

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
        setMessage(`${context.employee.displayName}さんを確認しました。訓練メニューを選択してください。`);
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
    setMessage('5回分の結果を確認してください。確認が終わったら「訓練完了」を押してください。');
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
  }, []);

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
      setMessage('レンチを選択し、設定値と適合状態を確認してください。');
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
        : 'レンチ接続を確認しました。画面の接続準備状態を確認してください。');
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
    setMessage('NFCタグを読み取って訓練者を確認してください。');
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
  const regularAttemptIds = new Set<string>();
  const trainingAttemptItems: Array<TorqueTrainingAttemptHistoryItem | null> = session
    ? Array.from({ length: session.targetAttemptCount }, (_, index) => {
        const attempt = session.attempts.find((item) => item.attemptNo === index + 1);
        if (!attempt) return null;
        regularAttemptIds.add(attempt.id);
        return toTrainingAttemptHistoryItem(attempt, index + 1);
      })
    : [];
  const outOfSequenceAttemptItems = session
    ? session.attempts
      .filter((attempt) => !regularAttemptIds.has(attempt.id))
      .map((attempt) => ({ ...toTrainingAttemptHistoryItem(attempt, 0), attemptNo: null }))
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-slate-800 p-3 text-white">
      <header className="grid min-h-[58px] grid-cols-1 items-center gap-2 rounded border border-white/15 bg-slate-900/80 p-3 sm:grid-cols-[minmax(0,auto)_minmax(10rem,1fr)_auto]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Kiosk / Assembly</p>
          <h1 className="text-2xl font-bold">締付トルク訓練</h1>
        </div>
        <AssemblySessionStatusNotice
          message={visibleError ?? message}
          tone={visibleError ? 'error' : 'default'}
        />
        <div className="flex gap-2">
          <Button variant="ghostOnDark" onClick={openSettings}>設定</Button>
          <Button variant="ghostOnDark" onClick={() => navigate('/kiosk/assembly')}>組立へ戻る</Button>
        </div>
      </header>

      <main className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]">
        <section className="space-y-3 rounded border border-white/10 bg-slate-900/70 p-4">
          <div className={session?.status === 'COMPLETED' ? 'w-full space-y-3' : 'w-full max-w-5xl space-y-3'} data-testid="torque-training-preparation">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{session?.status === 'COMPLETED' ? '訓練結果' : '訓練の準備'}</h2>
              {operator && (!session || session.status === 'IN_PROGRESS') ? <Button variant="ghostOnDark" onClick={() => void resetOperator()}>別の作業者</Button> : null}
            </div>
            {operator ? (
              <div className="w-full max-w-sm rounded border border-emerald-300/30 bg-emerald-500/10 p-3" data-testid="torque-training-operator-card">
                <p className="font-semibold">{operator.employee.displayName}</p>
                <p className="text-sm text-emerald-100/80">社員コード: {operator.employee.employeeCode}</p>
              </div>
            ) : (
              <p className="w-full max-w-md rounded border border-white/10 bg-white/5 p-3 text-sm text-white/70" data-testid="torque-training-nfc-guide">NFCリーダーに本人のタグをかざしてください。</p>
            )}

            {!session ? (
              <div className="w-full max-w-xl space-y-2">
              <label className="block text-sm font-semibold" htmlFor="training-program">対象ボルト・訓練メニュー</label>
              <select id="training-program" className="min-h-11 w-full rounded border border-white/20 bg-slate-800 px-3 text-white" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} disabled={!operator || busy}>
                <option value="">選択してください</option>
                {programs.flatMap((program) => program.versions.map((version) => (
                  <option
                    key={version.id}
                    value={version.id}
                    disabled={version.setupState !== 'READY'}
                  >
                    {program.code} / {version.displayName}（{version.nominalDiameter}）
                    {version.setupState !== 'READY' ? `（${presentTorqueTrainingSetupReason(version.setupStateReason) ?? '対応レンチ未登録'}）` : ''}
                  </option>
                )))}
              </select>
              {selectedVersion ? (
                <p className="text-sm text-white/70">
                  対象: {selectedVersion.nominalDiameter} / {selectedVersion.displayName}。
                  {!selectedVersionReady ? ` ${setupReason ?? '対応レンチ未登録'}。` : '訓練開始後に設定値を表示します。'}
                </p>
              ) : null}
              <Button onClick={() => void start()} disabled={!operator || !selectedVersionId || !selectedVersionReady || busy}>{busy ? '処理中...' : '訓練を開始'}</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {session.status === 'IN_PROGRESS' ? (
                  <>
                    <div className="w-full max-w-md rounded border border-white/10 bg-white/5 p-3" data-testid="torque-training-target-summary">
                      <p className="text-sm text-white/70">対象: {session.program.displayName} / {session.program.nominalDiameter}</p>
                      <p className="text-sm text-white/50">締付中は目標値を隠し、入力後に結果を表示します。</p>
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
                      <div className="w-full max-w-lg rounded border border-emerald-300/30 bg-emerald-500/10 p-4" data-testid="torque-training-wrench-connection">
                        <p className="font-bold text-emerald-100">{torqueConnection.ready ? '接続準備完了' : torqueConnection.state === 'handoff_wait' ? '引継ぎ待機中' : 'Bluetooth接続待ち'}</p>
                        <p className="mt-1 text-sm text-emerald-100/80">{torqueConnection.ready ? '5回締付けてください。結果はdigitalトルクレンチから自動記録されます。' : '青いランプが点灯し、接続準備完了になるまで締付けないでください。'}</p>
                        <p className="mt-2 text-sm">進捗: {session.attempts.filter((attempt) => attempt.accepted).length} / {session.targetAttemptCount}</p>
                      </div>
                    )}
                  </>
                ) : session.status === 'COMPLETED' ? (
                  <div className="w-full rounded border border-emerald-300/30 bg-emerald-500/10 p-4" data-testid="torque-training-completed-result">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-emerald-100">5回の記録が完了しました</p>
                        <p className="mt-1 text-sm text-emerald-100/80">{session.program.displayName} / 対象ボルト {session.program.nominalDiameter}</p>
                      </div>
                      <p className="text-lg font-bold text-emerald-100">
                        合格 {session.attempts.filter((attempt) => attempt.judgement === 'OK').length} / {session.targetAttemptCount}回
                      </p>
                    </div>
                    <p className="mt-3 text-sm text-white/75">試行履歴と成長度合いを確認して、訓練を終了してください。</p>
                    <Button className="mt-4" onClick={() => void resetOperator()}>訓練完了</Button>
                  </div>
                ) : null}
                <TorqueTrainingAttemptHistory
                  items={trainingAttemptItems}
                  recordedCount={session.attempts.filter((attempt) => attempt.accepted).length}
                  outOfSequenceItems={outOfSequenceAttemptItems}
                  className={session.status === 'COMPLETED' ? 'max-w-none' : undefined}
                />
              </div>
            )}
          </div>
        </section>

        <aside className="w-full max-w-lg space-y-3 rounded border border-white/10 bg-slate-900/70 p-4 xl:max-w-none">
          <h2 className="text-lg font-bold">成長度合い</h2>
          {operator?.metrics.length ? operator.metrics.map((metric) => {
            const latest = metric.sessions[0];
            const comparison = trainingMetricComparison(metric);
            const latestPassedCount = latest ? passedAttemptCount(latest.attemptCount, latest.passRate) : null;
            const latestIsCurrentSession = session?.status === 'COMPLETED' && latest?.sessionId === session.id;
            return (
              <article key={metric.conditionFingerprint} className="rounded border border-white/10 bg-white/5 p-4" data-testid="torque-training-growth-card">
                <h3 className="font-bold">{metric.trainingName}</h3>
                <p className="mt-1 text-sm text-white/65">対象ボルト: {metric.targetBolt} / 直近{metric.sessions.length}回</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded bg-slate-950/50 p-2">
                    <p className="text-xs text-white/55">合格した回数</p>
                    <p className="mt-1 text-lg font-bold">{passedAttemptCount(metric.attemptCount, metric.passRate)} / {metric.attemptCount}回</p>
                  </div>
                  <div className="rounded bg-slate-950/50 p-2">
                    <p className="text-xs text-white/55">{latestIsCurrentSession ? '今回' : '最新の記録'}</p>
                    <p className="mt-1 text-lg font-bold">{latestPassedCount == null ? '-' : `${latestPassedCount} / ${latest?.attemptCount ?? 0}回`}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-emerald-100">{comparison ?? '前回と比べられる同一条件の記録はありません。'}</p>
                <p className="mt-2 text-xs text-white/55">合格率 {Math.round(metric.passRate * 100)}% / 目標からの平均ずれ {metric.meanAbsoluteErrorPercent.toFixed(1)}%</p>
                <div className="mt-3 h-28" aria-label={`${metric.trainingName}の合格率の推移`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...metric.sessions].reverse()}>
                      <XAxis dataKey="completedAt" hide />
                      <YAxis domain={[0, 1]} hide />
                      <Tooltip formatter={(value) => `${Math.round(Number(value) * 100)}%`} />
                      <Line type="monotone" dataKey="passRate" stroke="#6ee7b7" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>
            );
          }) : <p className="text-sm text-white/60">完了セッションがまだありません。</p>}
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
