import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import {
  confirmTorqueTrainingWrench,
  cancelTorqueTrainingSession,
  getTorqueTrainingSession,
  listTorqueTrainingPrograms,
  resolveTorqueTrainingOperator,
  startTorqueTrainingSession,
  type TorqueTrainingOperatorContextApi,
  type TorqueTrainingProgramApi,
  type TorqueTrainingSessionApi
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { TorqueTrainingAdminDialog } from '../../features/assembly/torque-training/TorqueTrainingAdminDialog';
import { useTorqueTrainingAdminController } from '../../features/assembly/torque-training/useTorqueTrainingAdminController';
import { acquireTorqueAgentTrainingLease, getTorqueAgentHealth, releaseTorqueAgentLease } from '../../features/assembly/torqueAgentClient';
import { useTorqueTrainingAgentHeartbeat } from '../../features/assembly/useTorqueTrainingAgentHeartbeat';
import { useNfcStream } from '../../hooks/useNfcStream';

function requestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function KioskAssemblyTrainingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const nfcEvent = useNfcStream(true);
  const [operator, setOperator] = useState<TorqueTrainingOperatorContextApi | null>(null);
  const [programs, setPrograms] = useState<TorqueTrainingProgramApi[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [session, setSession] = useState<TorqueTrainingSessionApi | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [agentWrenchSerial, setAgentWrenchSerial] = useState<string | null>(null);
  const [lease, setLease] = useState<{ active: true } | null>(null);
  const [trainingWrenchConnection, setTrainingWrenchConnection] = useState<{
    sessionId: string;
    confirmationId: string;
    profileId: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('NFCタグを読み取って訓練者を確認してください。');
  const [error, setError] = useState<string | null>(null);
  const [agentHeartbeatError, setAgentHeartbeatError] = useState<string | null>(null);
  const leaseRef = useRef(false);
  const sessionRef = useRef<TorqueTrainingSessionApi | null>(null);
  const operatorRef = useRef<TorqueTrainingOperatorContextApi | null>(null);

  useEffect(() => { leaseRef.current = lease !== null; }, [lease]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { operatorRef.current = operator; }, [operator]);
  useEffect(() => () => {
    const current = sessionRef.current;
    if (current?.status === 'IN_PROGRESS') void cancelTorqueTrainingSession(current.id, '訓練画面離脱').catch(() => undefined);
    if (leaseRef.current) void releaseTorqueAgentLease('TRAINING_PAGE_LEAVE').catch(() => undefined);
  }, []);

  const handleAgentHeartbeatLost = useCallback((heartbeatError: string) => {
    setLease(null);
    setTrainingWrenchConnection(null);
    setSelectedProfileId('');
    setAgentHeartbeatError(heartbeatError);
    setMessage('レンチ接続が切れました。検出レンチを確認して接続し直してください。');
  }, []);

  const agentHeartbeat = useTorqueTrainingAgentHeartbeat({
    enabled: Boolean(session && session.status === 'IN_PROGRESS' && lease && trainingWrenchConnection),
    sessionId: trainingWrenchConnection?.sessionId ?? null,
    confirmationId: trainingWrenchConnection?.confirmationId ?? null,
    torqueWrenchProfileId: trainingWrenchConnection?.profileId ?? null,
    onLost: handleAgentHeartbeatLost
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
    onProgramsChanged: loadPrograms
  });

  useEffect(() => {
    void loadPrograms();
  }, [loadPrograms]);

  useEffect(() => {
    if (!nfcEvent?.uid) return;
    setBusy(true);
    setError(null);
    void resolveTorqueTrainingOperator(nfcEvent.uid)
      .then((context) => {
        const current = sessionRef.current;
        if (current?.status === 'IN_PROGRESS' && operatorRef.current && operatorRef.current.employee.id !== context.employee.id) {
          throw new Error('進行中の訓練を終了してから別のNFCタグを読み取ってください。');
        }
        setOperator(context);
        setSession(context.currentSession);
        setMessage(`${context.employee.displayName}さんを確認しました。訓練メニューを選択してください。`);
      })
      .catch((cause) => setError(getApiErrorMessage(cause, 'NFCタグを確認できませんでした。')))
      .finally(() => setBusy(false));
  }, [nfcEvent]);

  const selectedVersion = useMemo(
    () => programs.flatMap((program) => program.versions).find((version) => version.id === selectedVersionId) ?? null,
    [programs, selectedVersionId]
  );

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return;
    const timer = window.setInterval(() => {
      void getTorqueTrainingSession(session.id).then(setSession).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (session?.status !== 'COMPLETED' || !lease) return;
    void releaseTorqueAgentLease('TRAINING_COMPLETED');
    setLease(null);
    setOperator(null);
    setSelectedVersionId('');
    setSelectedProfileId('');
    setAgentWrenchSerial(null);
    setTrainingWrenchConnection(null);
    setAgentHeartbeatError(null);
    setMessage('訓練が完了しました。次の作業者はNFCタグを読み取ってください。');
  }, [lease, session?.status]);

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS' || lease) return;
    let active = true;
    void getTorqueAgentHealth().then((status) => {
      if (!active) return;
      const serials = status.wrenchSerialNumbers ?? [];
      const matches = session.program.torqueWrenchProfiles.filter((profile) => serials.includes(profile.serialNumber));
      if (matches.length === 1) {
        setSelectedProfileId(matches[0].id);
        setAgentWrenchSerial(matches[0].serialNumber);
        setError(null);
      } else {
        setSelectedProfileId('');
        setAgentWrenchSerial(serials.length === 1 ? serials[0] : null);
        setError(serials.length === 0
          ? 'torque-agentから物理レンチの製造番号を取得できません。端末設定を確認してください。'
          : '接続中の物理レンチがこの訓練版に一意に割り当てられていません。');
      }
    }).catch((cause) => {
      if (active) setError(getApiErrorMessage(cause, 'torque-agentの物理レンチを特定できませんでした。'));
    });
    return () => { active = false; };
  }, [lease, session]);

  const start = async () => {
    if (!nfcEvent?.uid || !selectedVersionId) return;
    setBusy(true);
    setError(null);
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
    setBusy(true);
    setError(null);
    try {
      const confirmation = await confirmTorqueTrainingWrench(session.id, { uid: nfcEvent.uid, torqueWrenchProfileId: selectedProfileId });
      const agentStatus = await acquireTorqueAgentTrainingLease({
        sessionId: session.id,
        confirmationId: confirmation.id,
        torqueWrenchProfileId: selectedProfileId,
        requestId: requestId('training-agent-lease')
      });
      if (!agentStatus.leaseOwned) throw new Error(agentStatus.lastError ?? 'Pi3 torque-agentへ接続できませんでした。');
      setAgentHeartbeatError(null);
      setTrainingWrenchConnection({ sessionId: session.id, confirmationId: confirmation.id, profileId: selectedProfileId });
      setLease({ active: true });
      setSession(await getTorqueTrainingSession(session.id));
      setMessage('レンチ接続を確認しました。画面の接続準備状態を確認してください。');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'レンチを接続できませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    if (user?.role !== 'ADMIN') {
      navigate('/login', { state: { from: { pathname: location.pathname, search: location.search, hash: location.hash }, forceLogin: true } });
      return;
    }
    setSettingsOpen(true);
  };

  const resetOperator = async () => {
    if (session?.status === 'IN_PROGRESS') {
      try {
        await cancelTorqueTrainingSession(session.id, '作業者切替');
      } catch (cause) {
        setError(getApiErrorMessage(cause, '進行中の訓練を終了できませんでした。'));
        return;
      }
      if (lease) await releaseTorqueAgentLease('TRAINING_OPERATOR_RESET').catch(() => undefined);
    }
    setOperator(null);
    setSession(null);
    setSelectedVersionId('');
    setSelectedProfileId('');
    setLease(null);
    setTrainingWrenchConnection(null);
    setAgentHeartbeatError(null);
    setMessage('NFCタグを読み取って訓練者を確認してください。');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-slate-800 p-3 text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/80 p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Kiosk / Assembly</p>
          <h1 className="text-2xl font-bold">締付トルク訓練</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghostOnDark" onClick={openSettings}>設定</Button>
          <Button variant="ghostOnDark" onClick={() => navigate('/kiosk/assembly')}>組立へ戻る</Button>
        </div>
      </header>
      {message ? <p className="rounded border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">{message}</p> : null}
      {(agentHeartbeatError ?? agentHeartbeat.error ?? error) ? <p className="rounded border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-100" role="alert">{agentHeartbeatError ?? agentHeartbeat.error ?? error}</p> : null}

      <main className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-3 rounded border border-white/10 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">訓練の準備</h2>
            {operator ? <Button variant="ghostOnDark" onClick={() => void resetOperator()}>別の作業者</Button> : null}
          </div>
          {operator ? (
            <div className="rounded border border-emerald-300/30 bg-emerald-500/10 p-3">
              <p className="font-semibold">{operator.employee.displayName}</p>
              <p className="text-sm text-emerald-100/80">社員コード: {operator.employee.employeeCode}</p>
            </div>
          ) : (
            <p className="rounded border border-white/10 bg-white/5 p-3 text-sm text-white/70">NFCリーダーに本人のタグをかざしてください。</p>
          )}

          {!session ? (
            <div className="w-full max-w-xl space-y-2">
              <label className="block text-sm font-semibold" htmlFor="training-program">対象ボルト・訓練メニュー</label>
              <select id="training-program" className="min-h-11 w-full rounded border border-white/20 bg-slate-800 px-3 text-white" value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)} disabled={!operator || busy}>
                <option value="">選択してください</option>
                {programs.flatMap((program) => program.versions.map((version) => (
                  <option key={version.id} value={version.id}>{program.code} / {version.displayName}（{version.nominalDiameter}）</option>
                )))}
              </select>
              {selectedVersion ? <p className="text-sm text-white/70">対象: {selectedVersion.nominalDiameter} / {selectedVersion.displayName}。締付条件は入力後に表示します。</p> : null}
              <Button onClick={() => void start()} disabled={!operator || !selectedVersionId || busy}>{busy ? '処理中...' : '訓練を開始'}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded border border-white/10 bg-white/5 p-3">
                <p className="text-sm text-white/70">対象: {session.program.displayName} / {session.program.nominalDiameter}</p>
                <p className="text-sm text-white/50">締付中は目標値を隠し、入力後に結果を表示します。</p>
              </div>
              {!lease ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">使用するdigitalトルクレンチ</p>
                  <p className="rounded border border-white/10 bg-white/5 p-3 text-sm">torque-agent自動検出: {agentWrenchSerial ?? '未特定'}</p>
                  <Button onClick={() => void confirmAndAcquire()} disabled={!selectedProfileId || busy}>{busy ? '確認中...' : '検出レンチを確認して接続'}</Button>
                </div>
              ) : (
                <div className="rounded border border-emerald-300/30 bg-emerald-500/10 p-4">
                  <p className="font-bold text-emerald-100">{agentHeartbeat.status === 'healthy' ? '接続準備完了' : 'Bluetooth接続待ち'}</p>
                  <p className="mt-1 text-sm text-emerald-100/80">{agentHeartbeat.status === 'healthy' ? '5回締付けてください。結果はdigitalトルクレンチから自動記録されます。' : '青いランプが点灯し、接続準備完了になるまで締付けないでください。'}</p>
                  <p className="mt-2 text-sm">進捗: {session.attempts.filter((attempt) => attempt.accepted).length} / {session.targetAttemptCount}</p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="訓練試行進捗">
                {Array.from({ length: 5 }, (_, index) => {
                  const attempt = session.attempts.find((item) => item.attemptNo === index + 1);
                  return <div key={index} className={`rounded border p-2 text-center text-sm ${attempt ? 'border-emerald-300/40 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>{attempt ? (attempt.judgement === 'OK' ? 'OK' : attempt.judgement === 'UNDER' ? '弱い' : '強い') : `${index + 1}回目`}</div>;
                })}
              </div>
              {session.attempts.length > 0 ? <div className="space-y-2">{session.attempts.map((attempt) => <div key={attempt.id} className="rounded border border-white/10 bg-slate-800/70 p-3 text-sm"><span className="font-semibold">{attempt.attemptNo ?? '記録外'}回目: {attempt.judgement === 'OK' ? 'OK' : attempt.judgement === 'UNDER' ? '弱い' : attempt.judgement === 'OVER' ? '強い' : '記録外'}</span>{attempt.valueNm && attempt.nominalTorque ? <span className="ml-2 text-white/70">実測 {attempt.valueNm} Nm / 目標 {attempt.nominalTorque} Nm / 差 {attempt.deviationPercent}%</span> : null}</div>)}</div> : null}
            </div>
          )}
        </section>

        <aside className="space-y-3 rounded border border-white/10 bg-slate-900/70 p-4">
          <h2 className="text-lg font-bold">成長度合い</h2>
          {operator?.metrics.length ? operator.metrics.map((metric) => {
            return <div key={metric.conditionFingerprint} className="rounded border border-white/10 bg-white/5 p-3"><p className="truncate text-xs text-white/50" title={metric.conditionFingerprint}>条件 {metric.conditionFingerprint.slice(0, 12)}…（同一条件の直近10回）</p><p className="mt-1 text-sm">合格率 <strong>{Math.round(metric.passRate * 100)}%</strong></p><p className="text-sm">平均絶対誤差 <strong>{metric.meanAbsoluteErrorPercent.toFixed(1)}%</strong></p><p className="text-sm">ばらつき（母標準偏差） <strong>{metric.variationPercent.toFixed(1)}%</strong></p><div className="mt-2 h-28" aria-label="同一条件の直近10回合格率"><ResponsiveContainer width="100%" height="100%"><LineChart data={[...metric.sessions].reverse()}><XAxis dataKey="completedAt" hide /><YAxis domain={[0, 1]} hide /><Tooltip formatter={(value) => `${Math.round(Number(value) * 100)}%`} /><Line type="monotone" dataKey="passRate" stroke="#6ee7b7" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div></div>;
          }) : <p className="text-sm text-white/60">完了セッションがまだありません。</p>}
        </aside>
      </main>

      <TorqueTrainingAdminDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        controller={adminController}
      />
    </div>
  );
}
