import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  advanceAssemblyArea,
  completeAssemblyWorkSession,
  getAssemblyWorkSession,
  getAssemblyWorkSessionProcedureSequence,
  listCurrentTorqueWrenchConfirmations,
  listCompatibleTorqueWrenchesForSession,
  confirmAssemblyTorqueWrench,
  recordAssemblyCheck,
  recordAssemblyTorque,
  restartAssemblyArea
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import {
  AssemblyProcedureCanvas,
  AssemblyProcedureSequenceViewer,
  AssemblyWorkSessionHeader,
  currentAssemblyArea,
  currentAssemblyBolt,
  KIOSK_ASSEMBLY_HOME_PATH,
  latestStatusByBolt,
  readAssemblyApiErrorMessage,
  resolveAssemblyCheckSummary,
  sessionCheckItemsToCanvas,
  templateToCanvasBolts
} from '../../features/assembly';

import type { TorqueWrenchProfileApi } from '../../api/domains/torque-wrenches';
import type { AssemblyProcedureSequencePageDto, AssemblyWorkSessionDto } from '../../features/assembly/types';

type TorqueAgentLeaseStatus = {
  ok: boolean;
  ready: boolean;
  state: 'available' | 'owned_by_self' | 'owned_by_other' | 'handoff_wait' | 'expired' | 'communication_lost' | 'fenced';
  owner: {
    clientDeviceName: string;
    clientDeviceLocation: string | null;
  } | null;
  bound: boolean;
  leaseOwned: boolean;
  bluetoothPowered: boolean;
  hidExclusive: boolean;
  lastError: string | null;
};

const TORQUE_AGENT_ORIGIN = 'http://127.0.0.1:7073';
const TAKEOVER_CONFIRMATION_ARM_DELAY_MS = 1200;

function torqueAgentStateLabel(status: TorqueAgentLeaseStatus | null, reachable: boolean): string {
  if (!reachable) return '通信断';
  if (!status) return '使用可能';
  if (status.state === 'owned_by_other') return '別の作業または端末が使用中';
  if (status.state === 'handoff_wait') return '引継ぎ待機中';
  if (status.state === 'communication_lost') return '通信断';
  if (status.state === 'fenced') return '接続権が移動済み';
  if (status.ready) return '入力待機中';
  if (status.leaseOwned) return 'Bluetooth接続待ち';
  return '使用可能';
}

function torqueAgentConnectionMessage(status: TorqueAgentLeaseStatus | null, reachable: boolean): string | null {
  if (!reachable) return 'torque-agentとの通信が切れました。接続状態を確認してください。';
  if (!status) return null;
  if (status.state === 'owned_by_other') {
    return '別の作業または端末が使用中です。現物が手元にある場合だけ引継ぎ操作を行ってください。';
  }
  if (status.state === 'handoff_wait') return '旧端末のBluetooth停止を待っています。';
  if (status.state === 'communication_lost') {
    return 'Pi 5との通信が切れたため接続を停止しました。もう一度「このレンチを使用開始」を押してください。';
  }
  if (status.state === 'fenced') {
    return '接続権が別端末へ移動しました。もう一度使用する場合は「このレンチを使用開始」を押してください。';
  }
  if (status.state === 'expired') {
    return '接続権の期限が切れました。もう一度「このレンチを使用開始」を押してください。';
  }
  if (status.lastError === 'BROWSER_DISARMED') return null;
  if (status.lastError) return `トルクレンチ接続を開始できませんでした: ${status.lastError}`;
  if (status.leaseOwned && !status.ready) return '接続権を取得しました。Bluetooth接続を待っています。';
  return null;
}

async function postTorqueAgent(path: string, payload: object, keepalive = false): Promise<TorqueAgentLeaseStatus> {
  const response = await fetch(`${TORQUE_AGENT_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive
  });
  if (!response.ok) throw new Error(`torque-agent ${response.status}`);
  return response.json() as Promise<TorqueAgentLeaseStatus>;
}

export function KioskAssemblyWorkSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<AssemblyWorkSessionDto | null>(null);
  const [procedureSequence, setProcedureSequence] = useState<Awaited<ReturnType<typeof getAssemblyWorkSessionProcedureSequence>> | null>(null);
  const [procedureSequenceLoading, setProcedureSequenceLoading] = useState(false);
  const [currentSequencePage, setCurrentSequencePage] = useState<AssemblyProcedureSequencePageDto | null>(null);
  const [torqueValue, setTorqueValue] = useState('');
  const [torqueSource, setTorqueSource] = useState<'manual' | 'mock'>('manual');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [compatibleWrenches, setCompatibleWrenches] = useState<Array<{ profile: TorqueWrenchProfileApi; conditionFingerprint: string }>>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [confirmation, setConfirmation] = useState<{ id: string; torqueWrenchProfileId: string; settingHistoryId: string } | null>(null);
  const [confirmationReused, setConfirmationReused] = useState(false);
  const [agentReachable, setAgentReachable] = useState(false);
  const [agentStatus, setAgentStatus] = useState<TorqueAgentLeaseStatus | null>(null);
  const [torqueConnectionMessage, setTorqueConnectionMessage] = useState<string | null>(null);
  const [takeoverConfirmationVisible, setTakeoverConfirmationVisible] = useState(false);
  const [takeoverConfirmationArmed, setTakeoverConfirmationArmed] = useState(false);
  const [takeoverPhysicalPresenceConfirmed, setTakeoverPhysicalPresenceConfirmed] = useState(false);

  const closeTakeoverConfirmation = useCallback(() => {
    setTakeoverConfirmationVisible(false);
    setTakeoverConfirmationArmed(false);
    setTakeoverPhysicalPresenceConfirmed(false);
  }, []);

  const openTakeoverConfirmation = useCallback(() => {
    setTakeoverConfirmationArmed(false);
    setTakeoverPhysicalPresenceConfirmed(false);
    setTakeoverConfirmationVisible(true);
  }, []);

  useEffect(() => {
    if (!takeoverConfirmationVisible) return;
    const timer = window.setTimeout(
      () => setTakeoverConfirmationArmed(true),
      TAKEOVER_CONFIRMATION_ARM_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [takeoverConfirmationVisible]);

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

  useEffect(() => {
    if (!session?.id) {
      setProcedureSequence(null);
      return;
    }
    let cancelled = false;
    setProcedureSequenceLoading(true);
    void getAssemblyWorkSessionProcedureSequence(session.id)
      .then((next) => {
        if (!cancelled) setProcedureSequence(next);
      })
      .catch(() => {
        if (!cancelled) setProcedureSequence(null);
      })
      .finally(() => {
        if (!cancelled) setProcedureSequenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

  const statusByBolt = useMemo(() => (session ? latestStatusByBolt(session) : new Map()), [session]);
  const checkSummary = useMemo(() => (session ? resolveAssemblyCheckSummary(session) : null), [session]);
  const currentArea = session ? currentAssemblyArea(session) : null;
  const currentBolt = session ? currentAssemblyBolt(session) : null;
  const traceabilityRequired = session?.template.traceabilityMode === 'REQUIRED';
  const allBoltsComplete = session
    ? session.template.areas.every((area) => area.bolts.every((bolt) => statusByBolt.get(bolt.id) === 'ok'))
    : false;
  const checksComplete = checkSummary?.allRequiredCompleted ?? true;
  const canComplete = Boolean(session && allBoltsComplete && checksComplete && session.status === 'in_progress');
  const hasConfiguredProcedureSequence =
    procedureSequence?.mode === 'configured' && procedureSequence.documents.length > 0;

  useEffect(() => {
    if (!session?.id || !session.currentBoltId || !traceabilityRequired) {
      setCompatibleWrenches([]);
      setSelectedProfileId('');
      setConfirmation(null);
      setConfirmationReused(false);
      return;
    }
    let cancelled = false;
    setConfirmation(null);
    setConfirmationReused(false);
    setAgentStatus(null);
    setTorqueConnectionMessage(null);
    closeTakeoverConfirmation();
    void Promise.all([
      listCompatibleTorqueWrenchesForSession(session.id),
      listCurrentTorqueWrenchConfirmations(session.id)
    ])
      .then(([items, confirmations]) => {
        if (cancelled) return;
        setCompatibleWrenches(items);
        const reusable = confirmations.find((candidate) =>
          items.some(({ profile }) => profile.id === candidate.torqueWrenchProfileId)
        );
        setSelectedProfileId(reusable?.torqueWrenchProfileId ?? items[0]?.profile.id ?? '');
        setConfirmation(
          reusable
            ? {
                id: reusable.id,
                torqueWrenchProfileId: reusable.torqueWrenchProfileId,
                settingHistoryId: reusable.settingHistoryId
              }
            : null
        );
        setConfirmationReused(Boolean(reusable));
      })
      .catch((error) => {
        if (!cancelled) setMessage(readAssemblyApiErrorMessage(error, '適合トルクレンチを取得できませんでした。'));
      });
    return () => {
      cancelled = true;
    };
  }, [closeTakeoverConfirmation, session?.currentBoltId, session?.id, traceabilityRequired]);

  useEffect(() => {
    if (!session?.id || !traceabilityRequired) return;
    let cancelled = false;
    const heartbeat = async () => {
      if (session.currentBoltId && !confirmation) return;
      try {
        const status = await postTorqueAgent('/heartbeat', {
          sessionId: session.id,
          currentTemplateBoltId: session.currentBoltId,
          confirmationId: confirmation?.id ?? null,
          torqueWrenchProfileId: confirmation?.torqueWrenchProfileId ?? null
        });
        if (!cancelled) {
          setAgentReachable(true);
          setAgentStatus(status);
          setTorqueConnectionMessage(torqueAgentConnectionMessage(status, true));
        }
      } catch {
        if (!cancelled) {
          setAgentReachable(false);
          setTorqueConnectionMessage(torqueAgentConnectionMessage(null, false));
        }
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [confirmation, session?.currentBoltId, session?.id, traceabilityRequired]);

  useEffect(() => {
    if (!traceabilityRequired) return;
    return () => {
      void postTorqueAgent('/lease/release', { reason: 'PAGE_LEFT' }, true).catch(() => undefined);
    };
  }, [traceabilityRequired]);

  useEffect(() => {
    if (!session?.id || !traceabilityRequired || !confirmation) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getAssemblyWorkSession(session.id).then((next) => {
        if (!cancelled) setSession(next);
      }).catch(() => undefined);
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [confirmation, session?.id, traceabilityRequired]);

  const fallbackPageRef = useMemo(() => {
    if (!session) return null;
    return {
      source: 'assembly_procedure_document' as const,
      documentId: session.template.procedureDocumentId,
      pageIndex: 0
    };
  }, [session]);

  const activePageRef = useMemo(() => {
    if (hasConfiguredProcedureSequence && currentSequencePage) {
      return {
        source: currentSequencePage.source,
        documentId: currentSequencePage.documentId,
        pageIndex: currentSequencePage.pageIndex
      };
    }
    return fallbackPageRef;
  }, [currentSequencePage, fallbackPageRef, hasConfiguredProcedureSequence]);

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

  const runBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e: unknown) {
      setMessage(readAssemblyApiErrorMessage(e, '処理に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const recordTorque = () =>
    runBusy(async () => {
      if (!session) throw new Error('作業を開始してください。');
      const value = Number(torqueValue);
      if (!Number.isFinite(value)) throw new Error('トルク値を入力してください。');
      const result = await recordAssemblyTorque(session.id, { value, source: torqueSource });
      setSession(result.session);
      setTorqueValue('');
      if (result.outcome.kind === 'ignored_duplicate') setMessage('1秒以内の再送信として無視しました。');
      else if (result.outcome.kind === 'recorded_ng') {
        setMessage(result.outcome.requiresAreaRestart ? 'NGです。上限超過が続いています。エリアやり直しを確認してください。' : 'NGです。同じ箇所で停止します。');
      } else {
        setMessage(result.outcome.areaCompleted ? 'エリア完了です。次工程へ進んでください。' : 'OKです。次の締付箇所へ進みました。');
      }
    });

  const confirmPhysicalWrench = () =>
    runBusy(async () => {
      if (!session?.currentBoltId || !selectedProfileId) throw new Error('確認する物理トルクレンチを選択してください。');
      const next = await confirmAssemblyTorqueWrench(session.id, {
        expectedTemplateBoltId: session.currentBoltId,
        torqueWrenchProfileId: selectedProfileId,
        physicalDisplayConfirmed: true
      });
      setConfirmation(next);
      setConfirmationReused(false);
      setTorqueConnectionMessage(null);
      setMessage('現物の製造番号と設定値を確認済みにしました。「このレンチを使用開始」を押してください。');
    });

  const startUsingWrench = () =>
    runBusy(async () => {
      if (!session?.currentBoltId || !confirmation) throw new Error('先に現物確認を完了してください。');
      const status = await postTorqueAgent('/lease/acquire', {
        sessionId: session.id,
        currentTemplateBoltId: session.currentBoltId,
        confirmationId: confirmation.id,
        torqueWrenchProfileId: confirmation.torqueWrenchProfileId,
        requestId: globalThis.crypto?.randomUUID?.() ?? `lease-${Date.now()}`
      });
      setAgentReachable(true);
      setAgentStatus(status);
      closeTakeoverConfirmation();
      setTorqueConnectionMessage(torqueAgentConnectionMessage(status, true));
    });

  const takeoverWrench = () =>
    runBusy(async () => {
      if (!session?.currentBoltId || !confirmation) throw new Error('先に現物確認を完了してください。');
      if (!takeoverConfirmationArmed || !takeoverPhysicalPresenceConfirmed) {
        throw new Error('レンチ本体が手元にあることを確認してください。');
      }
      const status = await postTorqueAgent('/lease/takeover', {
        sessionId: session.id,
        currentTemplateBoltId: session.currentBoltId,
        confirmationId: confirmation.id,
        torqueWrenchProfileId: confirmation.torqueWrenchProfileId,
        requestId: globalThis.crypto?.randomUUID?.() ?? `takeover-${Date.now()}`,
        physicalWrenchPresent: true,
        reason: '作業者が現物を手元で二段階確認'
      });
      setAgentReachable(true);
      setAgentStatus(status);
      closeTakeoverConfirmation();
      setTorqueConnectionMessage(torqueAgentConnectionMessage(status, true));
    });

  const stopUsingWrench = async (reason = 'OPERATOR_RELEASE') => {
    try {
      const status = await postTorqueAgent('/lease/release', { reason });
      setAgentReachable(true);
      setAgentStatus(status);
      setTorqueConnectionMessage(torqueAgentConnectionMessage(status, true));
      closeTakeoverConfirmation();
    } catch {
      setAgentReachable(false);
      setTorqueConnectionMessage(torqueAgentConnectionMessage(null, false));
    }
  };

  const toggleCheckItem = (checkItemId: string) =>
    runBusy(async () => {
      if (!session) return;
      const item = session.checkItems?.find((candidate) => candidate.id === checkItemId);
      const nextChecked = !(item?.record?.checked ?? false);
      const result = await recordAssemblyCheck(session.id, { checkItemId, checked: nextChecked });
      setSession((prev) =>
        prev
          ? {
              ...prev,
              checkSummary: result.checkSummary,
              checkItems: (prev.checkItems ?? []).map((candidate) =>
                candidate.id === checkItemId ? { ...candidate, record: result.record } : candidate
              )
            }
          : prev
      );
    });

  const completeSession = () =>
    runBusy(async () => {
      if (!session) return;
      await stopUsingWrench('WORK_SESSION_COMPLETED');
      const updated = await completeAssemblyWorkSession(session.id);
      setSession(updated);
      setMessage('作業を完了しました。');
    });

  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
        <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 w-fit items-center')}>
          組立トップ
        </Link>
        <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">
          {message ?? '作業データが見つかりません。'}
        </p>
      </div>
    );
  }

  const currentPositionLabel = procedureSequenceLoading
    ? '要領書を確認中'
    : currentBolt ? `丸数字 ${currentBolt.markerNo}` : (allBoltsComplete ? '全締付完了' : '次工程待ち');
  const requiredCheckLabel =
    checkSummary && checkSummary.requiredTotal > 0
      ? `必須 ${checkSummary.requiredCompleted}/${checkSummary.requiredTotal}`
      : null;
  const visibleMessage = torqueConnectionMessage ?? message;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <AssemblyWorkSessionHeader
        productNo={session.productNo}
        modelCode={session.template.modelCode}
        procedurePattern={session.template.procedurePattern}
        procedureModeLabel={hasConfiguredProcedureSequence ? '要領書' : '手順書'}
        currentPositionLabel={currentPositionLabel}
        requiredCheckLabel={requiredCheckLabel}
      />

      {visibleMessage ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{visibleMessage}</p> : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)] xl:overflow-hidden">
        <section className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0">
          <div className="min-h-0 flex-1">
            {hasConfiguredProcedureSequence && procedureSequence ? (
              <AssemblyProcedureSequenceViewer
                sequence={procedureSequence}
                className="h-full"
                boltMarkers={visibleBoltMarkers}
                checkMarkers={visibleCheckMarkers}
                selectedBoltId={session.currentBoltId}
                onToggleCheckItem={(checkItemId) => void toggleCheckItem(checkItemId)}
                onCurrentPageChange={handleCurrentPageChange}
              />
            ) : (
              <AssemblyProcedureCanvas
                imageRelativePath={session.template.procedureDocument.imageRelativePath}
                bolts={visibleBoltMarkers}
                checkItems={visibleCheckMarkers}
                selectedBoltId={session.currentBoltId}
                onToggleCheckItem={(checkItemId) => void toggleCheckItem(checkItemId)}
                className="h-full"
              />
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">締付</h2>
          <div className="mt-3 rounded border border-white/10 bg-slate-950 p-3">
            <div className="text-sm text-white/60">現在</div>
            <div className="mt-1 text-lg font-bold">{currentBolt ? `丸数字 ${currentBolt.markerNo}` : (allBoltsComplete ? '全締付完了' : '次工程待ち')}</div>
            <div className="mt-1 text-sm text-white/70">{currentArea?.areaName ?? ''}</div>
            {currentBolt ? (
              <div className="mt-2 text-sm text-white/80">
                規定 {currentBolt.nominalTorque} / 下限 {currentBolt.lowerLimit} / 上限 {currentBolt.upperLimit} {currentBolt.unit}
              </div>
            ) : null}
          </div>
          {checkSummary && checkSummary.requiredTotal > 0 ? (
            <div className="mt-3 rounded border border-lime-300/20 bg-lime-500/10 p-3 text-sm">
              <div className="font-semibold text-lime-100">チェック進捗</div>
              <div className="mt-1 text-lime-50">
                必須 {checkSummary.requiredCompleted}/{checkSummary.requiredTotal}
              </div>
            </div>
          ) : null}
          {traceabilityRequired ? (
            <div className="mt-3 grid gap-3 rounded border border-cyan-300/25 bg-cyan-950/20 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">トルクレンチ接続</span>
                <span className={agentStatus?.ready ? 'text-emerald-300' : 'text-amber-200'}>
                  {torqueAgentStateLabel(agentStatus, agentReachable)}
                </span>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-white/70">
                使用する物理トルクレンチ
                <select className="min-h-11 rounded bg-slate-950 px-2 text-sm" value={selectedProfileId} disabled={busy || Boolean(confirmation)} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  {compatibleWrenches.length === 0 ? <option value="">適合レンチなし</option> : null}
                  {compatibleWrenches.map(({ profile }) => {
                    const setting = profile.settingHistories[0];
                    return <option key={profile.id} value={profile.id}>{profile.serialNumber} / {profile.model.modelNumber}{setting ? ` / ${setting.nominalTorque} ${setting.unit}` : ''}</option>;
                  })}
                </select>
              </label>
              <Button type="button" variant="primary" disabled={busy || !selectedProfileId || Boolean(confirmation)} onClick={confirmPhysicalWrench}>
                {confirmation ? '現物確認済み' : '製造番号と現物設定を確認'}
              </Button>
              {confirmation && !agentStatus?.leaseOwned && agentStatus?.state !== 'owned_by_other' ? (
                <Button type="button" variant="primary" disabled={busy} onClick={startUsingWrench}>
                  このレンチを使用開始
                </Button>
              ) : null}
              {agentStatus?.leaseOwned ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void stopUsingWrench()}>
                  使用終了
                </Button>
              ) : null}
              {agentStatus?.state === 'owned_by_other' ? (
                <div className="grid gap-2 rounded border border-amber-300/30 bg-amber-950/30 p-3 text-sm">
                  <div className="font-semibold text-amber-100">
                    {agentStatus.owner?.clientDeviceName ?? '別端末'}
                    {agentStatus.owner?.clientDeviceLocation ? `（${agentStatus.owner.clientDeviceLocation}）` : ''} が使用中
                  </div>
                  {!takeoverConfirmationVisible ? (
                    <Button type="button" variant="secondary" disabled={busy} onClick={openTakeoverConfirmation}>
                      現物が手元にあるため引き継ぐ
                    </Button>
                  ) : (
                    <div className="grid gap-3 rounded border border-amber-200/25 bg-slate-950/70 p-3">
                      <p className="text-xs font-semibold text-amber-100">レンチ本体がこの端末の前にあることを、もう一度確認してください。</p>
                      <label className="flex min-h-12 items-center gap-3 rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-amber-400"
                          checked={takeoverPhysicalPresenceConfirmed}
                          disabled={busy || !takeoverConfirmationArmed}
                          onChange={(event) => setTakeoverPhysicalPresenceConfirmed(event.target.checked)}
                        />
                        <span>レンチ本体がこの端末の前にあることを確認しました</span>
                      </label>
                      <p className="text-xs text-white/65" aria-live="polite">
                        {takeoverConfirmationArmed
                          ? '確認欄にチェックしてから、接続権の引継ぎを実行してください。'
                          : '誤操作防止のため、確認欄が有効になるまで少しお待ちください。'}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant="secondary" disabled={busy} onClick={closeTakeoverConfirmation}>
                          やめる
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={busy || !takeoverConfirmationArmed || !takeoverPhysicalPresenceConfirmed}
                          onClick={takeoverWrench}
                        >
                          確認して接続権を引き継ぐ
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              <div className="rounded bg-slate-950/70 px-3 py-2 text-center text-sm font-semibold">
                {!confirmation
                  ? '現物確認後に使用開始してください'
                  : agentStatus?.ready
                    ? '入力待機中'
                    : confirmationReused
                      ? '同じ締付条件の現物確認を引継ぎ済み・使用開始が必要です'
                      : '現物確認済み・使用開始が必要です'}
              </div>
            </div>
          ) : (
          <>
          <div className="mt-3 grid grid-cols-[1fr_6rem] gap-2">
            <input
              className="rounded bg-slate-950 px-3 py-3 text-lg"
              value={torqueValue}
              onChange={(event) => setTorqueValue(event.target.value)}
              placeholder="トルク値"
            />
            <select
              className="rounded bg-slate-950 px-2 text-sm"
              value={torqueSource}
              onChange={(event) => setTorqueSource(event.target.value as 'manual' | 'mock')}
            >
              <option value="manual">手入力</option>
              <option value="mock">mock</option>
            </select>
          </div>
          <Button type="button" variant="primary" disabled={busy || !session.currentBoltId} className="mt-2 min-h-12 w-full" onClick={recordTorque}>
            トルク記録
          </Button>
          </>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || Boolean(session.currentBoltId) || allBoltsComplete}
              onClick={() => void runBusy(async () => setSession(await advanceAssemblyArea(session.id)))}
            >
              次工程へ
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy || !session.currentAreaId}
              onClick={() => void runBusy(async () => setSession(await restartAssemblyArea(session.id, { reason: '画面操作によるエリアやり直し' })))}
            >
              やり直し
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || !canComplete}
              className="col-span-2"
              title={completeDisabledReason ?? undefined}
              onClick={completeSession}
            >
              作業完了
            </Button>
          </div>
          {completeDisabledReason ? (
            <p className="mt-2 text-xs font-semibold text-amber-200">{completeDisabledReason}</p>
          ) : null}
          <h3 className="mt-5 text-sm font-bold">履歴</h3>
          <div className="mt-2 max-h-80 overflow-y-auto rounded border border-white/10">
            {session.torqueRecords.slice().reverse().map((record) => (
              <div key={record.id} className="grid grid-cols-[1fr_4rem_4rem] gap-2 border-b border-white/10 px-3 py-2 text-xs">
                <div>
                  <div className="font-semibold">丸数字 {record.markerNo}{record.serialNumberSnapshot ? ` / ${record.serialNumberSnapshot}` : ''}</div>
                  <div className="text-white/50">{new Date(record.recordedAt).toLocaleString()}</div>
                </div>
                <div>{record.value ?? '-'}</div>
                <div className={record.judgement === 'ok' ? 'text-emerald-300' : record.judgement === 'ng' ? 'text-rose-300' : 'text-slate-300'}>
                  {record.judgement.toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
