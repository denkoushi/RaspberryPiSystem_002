import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import {
  confirmTorqueTrainingWrench,
  cancelTorqueTrainingSession,
  createTorqueTrainingProgram,
  deactivateTorqueTrainingProgram,
  excludeTorqueTrainingResult,
  getTorqueTrainingSession,
  listTorqueTrainingAdminPrograms,
  listTorqueTrainingAdminResults,
  listTorqueTrainingPrograms,
  listTorqueWrenchCapabilityGroups,
  listTorqueWrenches,
  reviseTorqueTrainingProgram,
  resolveTorqueTrainingOperator,
  startTorqueTrainingSession,
  type TorqueTrainingAdminResultApi,
  type TorqueTrainingOperatorContextApi,
  type TorqueTrainingProgramApi,
  type TorqueTrainingSessionApi,
  type TorqueWrenchCapabilityGroupApi,
  type TorqueWrenchProfileApi
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { acquireTorqueAgentTrainingLease, getTorqueAgentHealth, releaseTorqueAgentLease } from '../../features/assembly/torqueAgentClient';
import { useNfcStream } from '../../hooks/useNfcStream';

type ProgramForm = {
  code: string;
  displayName: string;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  nominalTorque: string;
  lowerLimit: string;
  upperLimit: string;
  unit: string;
  jigConditionCode: string;
  torqueWrenchProfileIds: string[];
};

const EMPTY_PROGRAM_FORM: ProgramForm = {
  code: '', displayName: '', nominalDiameter: '', boltLengthMm: '', material: '', strengthClass: '', capabilityGroupId: '', nominalTorque: '', lowerLimit: '', upperLimit: '', unit: 'N-m', jigConditionCode: '', torqueWrenchProfileIds: []
};

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminPrograms, setAdminPrograms] = useState<TorqueTrainingProgramApi[]>([]);
  const [adminResults, setAdminResults] = useState<TorqueTrainingAdminResultApi[]>([]);
  const [adminTab, setAdminTab] = useState<'programs' | 'results'>('programs');
  const [programForm, setProgramForm] = useState<ProgramForm>(EMPTY_PROGRAM_FORM);
  const [revisionProgramId, setRevisionProgramId] = useState('');
  const [capabilityGroups, setCapabilityGroups] = useState<TorqueWrenchCapabilityGroupApi[]>([]);
  const [wrenchProfiles, setWrenchProfiles] = useState<TorqueWrenchProfileApi[]>([]);
  const [resultQuery, setResultQuery] = useState('');
  const [exclusionReasons, setExclusionReasons] = useState<Record<string, string>>({});
  const [adminBusy, setAdminBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('NFCタグを読み取って訓練者を確認してください。');
  const [error, setError] = useState<string | null>(null);
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

  const loadPrograms = useCallback(async () => {
    try {
      setPrograms(await listTorqueTrainingPrograms());
    } catch (cause) {
      setError(getApiErrorMessage(cause, '訓練メニューを読み込めませんでした。'));
    }
  }, []);

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
      setLease({ active: true });
      setSession(await getTorqueTrainingSession(session.id));
      setMessage('レンチ接続を確認しました。締付けを開始してください。目標値は入力後に表示されます。');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'レンチを接続できませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  const openSettings = async () => {
    if (user?.role !== 'ADMIN') {
      navigate('/login', { state: { from: { pathname: location.pathname, search: location.search, hash: location.hash }, forceLogin: true } });
      return;
    }
    setSettingsOpen((open) => !open);
    if (!settingsOpen) {
      try {
        const [nextPrograms, nextResults, groups, profiles] = await Promise.all([listTorqueTrainingAdminPrograms(), listTorqueTrainingAdminResults(), listTorqueWrenchCapabilityGroups(true), listTorqueWrenches(true)]);
        setAdminPrograms(nextPrograms);
        setAdminResults(nextResults);
        setCapabilityGroups(groups);
        setWrenchProfiles(profiles);
      } catch (cause) {
        setError(getApiErrorMessage(cause, '管理情報を読み込めませんでした。'));
      }
    }
  };

  const updateProgramForm = (key: keyof ProgramForm, value: string | string[]) => setProgramForm((current) => ({ ...current, [key]: value }));

  const submitProgram = async (revision: boolean) => {
    setAdminBusy(true);
    setError(null);
    try {
      const payload = {
        ...programForm,
        boltLengthMm: Number(programForm.boltLengthMm),
        nominalTorque: Number(programForm.nominalTorque),
        lowerLimit: Number(programForm.lowerLimit),
        upperLimit: Number(programForm.upperLimit)
      };
      if (revision) {
        if (!revisionProgramId) throw new Error('版を追加するメニューを選択してください。');
        const { code, ...revisionPayload } = payload;
        void code;
        await reviseTorqueTrainingProgram(revisionProgramId, revisionPayload);
      } else {
        await createTorqueTrainingProgram(payload);
      }
      setProgramForm(EMPTY_PROGRAM_FORM);
      setAdminPrograms(await listTorqueTrainingAdminPrograms());
      await loadPrograms();
      setMessage(revision ? '新しい訓練メニュー版を追加しました。' : '訓練メニューを追加しました。');
    } catch (cause) {
      setError(getApiErrorMessage(cause, '訓練メニューを保存できませんでした。'));
    } finally {
      setAdminBusy(false);
    }
  };

  const deactivate = async (programId: string) => {
    const reason = window.prompt('停止理由を入力してください。');
    if (!reason) return;
    setAdminBusy(true);
    try {
      await deactivateTorqueTrainingProgram(programId, reason);
      setAdminPrograms(await listTorqueTrainingAdminPrograms());
      await loadPrograms();
    } catch (cause) {
      setError(getApiErrorMessage(cause, '訓練メニューを停止できませんでした。'));
    } finally {
      setAdminBusy(false);
    }
  };

  const excludeResult = async (sessionId: string) => {
    const reason = exclusionReasons[sessionId]?.trim();
    if (!reason) return;
    setAdminBusy(true);
    try {
      await excludeTorqueTrainingResult(sessionId, reason);
      setAdminResults(await listTorqueTrainingAdminResults());
      setExclusionReasons((current) => ({ ...current, [sessionId]: '' }));
    } catch (cause) {
      setError(getApiErrorMessage(cause, '実績を集計対象外にできませんでした。'));
    } finally {
      setAdminBusy(false);
    }
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
      {error ? <p className="rounded border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm text-red-100" role="alert">{error}</p> : null}

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
            <div className="space-y-2">
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
                  <p className="font-bold text-emerald-100">接続準備完了</p>
                  <p className="mt-1 text-sm text-emerald-100/80">5回締付けてください。結果はdigitalトルクレンチから自動記録されます。</p>
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

      {settingsOpen ? (
        <section className="rounded border border-amber-300/30 bg-amber-500/10 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">訓練設定（ADMIN）</h2>
            <Button variant="ghostOnDark" onClick={() => setSettingsOpen(false)}>閉じる</Button>
          </div>
          <div className="mb-3 flex gap-2" role="tablist" aria-label="訓練管理">
            <Button variant={adminTab === 'programs' ? 'primary' : 'ghostOnDark'} onClick={() => setAdminTab('programs')}>訓練メニュー</Button>
            <Button variant={adminTab === 'results' ? 'primary' : 'ghostOnDark'} onClick={() => setAdminTab('results')}>訓練実績</Button>
          </div>
          {adminTab === 'programs' ? (
            <div className="space-y-4">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-2 rounded border border-white/10 bg-slate-900/60 p-3">
                  <h3 className="font-semibold">メニュー追加・新版作成</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(['code', 'displayName', 'nominalDiameter', 'boltLengthMm', 'material', 'strengthClass', 'nominalTorque', 'lowerLimit', 'upperLimit', 'unit', 'jigConditionCode'] as const).map((field) => (
                      <Input key={field} placeholder={field} value={programForm[field]} onChange={(event) => updateProgramForm(field, event.target.value)} />
                    ))}
                  </div>
                  <select className="min-h-10 w-full rounded border border-white/20 bg-slate-800 px-2 text-white" value={programForm.capabilityGroupId} onChange={(event) => updateProgramForm('capabilityGroupId', event.target.value)}>
                    <option value="">能力グループ</option>{capabilityGroups.map((group) => <option key={group.id} value={group.id}>{group.name}（{group.nominalDiameter}）</option>)}
                  </select>
                  <select multiple className="min-h-20 w-full rounded border border-white/20 bg-slate-800 px-2 text-white" value={programForm.torqueWrenchProfileIds} onChange={(event) => updateProgramForm('torqueWrenchProfileIds', [...event.target.selectedOptions].map((option) => option.value))}>
                    {wrenchProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.serialNumber}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-2"><Button disabled={adminBusy} onClick={() => void submitProgram(false)}>メニューを追加</Button><select className="rounded border border-white/20 bg-slate-800 px-2 text-white" value={revisionProgramId} onChange={(event) => setRevisionProgramId(event.target.value)}><option value="">新版対象</option>{adminPrograms.filter((program) => program.isActive).map((program) => <option key={program.id} value={program.id}>{program.code}</option>)}</select><Button disabled={adminBusy || !revisionProgramId} onClick={() => void submitProgram(true)}>新版を追加</Button></div>
                </div>
                <div className="space-y-2 rounded border border-white/10 bg-slate-900/60 p-3"><h3 className="font-semibold">利用停止</h3>{adminPrograms.map((program) => <div key={program.id} className="flex items-center justify-between gap-2 text-sm"><span>{program.code} / v{program.currentVersion}（{program.isActive ? '利用中' : '停止'}）</span>{program.isActive ? <Button variant="danger" disabled={adminBusy} onClick={() => void deactivate(program.id)}>停止</Button> : null}</div>)}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3"><Input placeholder="氏名・社員コード・メニューで検索" value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} />{adminResults.filter((result) => `${result.employeeName} ${result.employeeCode} ${result.programCode}`.toLowerCase().includes(resultQuery.toLowerCase())).map((result) => <div key={result.id} className="rounded border border-white/10 bg-slate-900/60 p-3 text-sm"><p>{result.employeeName}（{result.employeeCode}） / {result.programCode} v{result.programVersion} / {result.completedAt ? new Date(result.completedAt).toLocaleString() : result.status}</p><p>合格率 {Math.round(result.metrics.passRate * 100)}% / 平均絶対誤差 {result.metrics.meanAbsoluteErrorPercent.toFixed(1)}% / ばらつき {result.metrics.variationPercent.toFixed(1)}%</p>{result.excludedAt ? <p className="text-amber-200">集計対象外: {result.exclusionReason}</p> : <div className="mt-2 flex gap-2"><Input placeholder="除外理由" value={exclusionReasons[result.id] ?? ''} onChange={(event) => setExclusionReasons((current) => ({ ...current, [result.id]: event.target.value }))} /><Button variant="danger" disabled={adminBusy || !exclusionReasons[result.id]?.trim()} onClick={() => void excludeResult(result.id)}>集計対象外</Button></div>}</div>)}</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
