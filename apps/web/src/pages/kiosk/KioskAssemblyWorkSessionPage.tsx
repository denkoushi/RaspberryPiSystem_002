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
import { buttonClassName } from '../../components/ui/Button';
import {
  AssemblyProcedureCanvas,
  AssemblyProcedureSequenceViewer,
  AssemblyLegacyTorqueEntry,
  AssemblyRequiredTorqueEntry,
  AssemblyTorqueCurrentCondition,
  AssemblyTorqueFeedback,
  AssemblyTorqueHistory,
  AssemblyTorqueWorkflowActions,
  AssemblyWorkSessionHeader,
  assemblyTorqueCurrentFeedback,
  assemblyTorqueMarkerStates,
  currentAssemblyArea,
  currentAssemblyBolt,
  KIOSK_ASSEMBLY_HOME_PATH,
  readAssemblyApiErrorMessage,
  resolveAssemblyCheckSummary,
  sessionCheckItemsToCanvas,
  templateToCanvasBolts
} from '../../features/assembly';

import type { TorqueWrenchProfileApi } from '../../api/domains/torque-wrenches';
import type { AssemblyProcedureSequencePageDto, AssemblyWorkSessionDto } from '../../features/assembly/types';

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
  const [agentConnected, setAgentConnected] = useState(false);

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

  const markerStates = useMemo(() => (session ? assemblyTorqueMarkerStates(session) : new Map()), [session]);
  const currentTorqueFeedback = useMemo(
    () => (session ? assemblyTorqueCurrentFeedback(session) : null),
    [session]
  );
  const checkSummary = useMemo(() => (session ? resolveAssemblyCheckSummary(session) : null), [session]);
  const currentArea = session ? currentAssemblyArea(session) : null;
  const currentBolt = session ? currentAssemblyBolt(session) : null;
  const traceabilityRequired = session?.template.traceabilityMode === 'REQUIRED';
  const allBoltsComplete = session
    ? session.template.areas.every((area) => area.bolts.every((bolt) => markerStates.get(bolt.id) === 'complete'))
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
    setAgentConnected(false);
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
  }, [session?.currentBoltId, session?.id, traceabilityRequired]);

  useEffect(() => {
    if (!session?.id || !traceabilityRequired) return;
    let cancelled = false;
    setAgentConnected(false);
    const heartbeat = async () => {
      try {
        const response = await fetch('http://127.0.0.1:7073/heartbeat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.id,
            currentTemplateBoltId: session.currentBoltId,
            confirmationId: confirmation?.id ?? null,
            torqueWrenchProfileId: confirmation?.torqueWrenchProfileId ?? null
          })
        });
        if (!response.ok) throw new Error(`heartbeat ${response.status}`);
        if (!cancelled) setAgentConnected(true);
      } catch {
        if (!cancelled) setAgentConnected(false);
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
    return templateToCanvasBolts(session.template, markerStates, activePageRef);
  }, [activePageRef, markerStates, session]);

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
      if (result.outcome.kind === 'ignored_duplicate') setMessage(null);
      else if (result.outcome.kind === 'recorded_ng') {
        setMessage(result.outcome.requiresAreaRestart ? '上限超過が続いています。エリアやり直しを確認してください。' : null);
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
      setMessage('現物の製造番号と設定値を確認済みにしました。トルク入力を待っています。');
    });

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

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

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
                showTorqueLegend
                onToggleCheckItem={(checkItemId) => void toggleCheckItem(checkItemId)}
                onCurrentPageChange={handleCurrentPageChange}
              />
            ) : (
              <AssemblyProcedureCanvas
                imageRelativePath={session.template.procedureDocument.imageRelativePath}
                bolts={visibleBoltMarkers}
                checkItems={visibleCheckMarkers}
                selectedBoltId={session.currentBoltId}
                showTorqueLegend
                onToggleCheckItem={(checkItemId) => void toggleCheckItem(checkItemId)}
                className="h-full"
              />
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3" aria-label="締付入力ペイン">
          <h2 className="text-[1.02rem] font-bold">締付</h2>
          <div className="mt-2">
            <AssemblyTorqueCurrentCondition
              currentBolt={currentBolt}
              areaName={currentArea?.areaName}
              allBoltsComplete={allBoltsComplete}
            />
          </div>
          {checkSummary && checkSummary.requiredTotal > 0 ? (
            <div className="mt-2 flex items-center justify-between rounded border border-lime-300/20 bg-lime-500/10 px-2 py-2 text-sm">
              <span className="font-semibold text-lime-100">チェック進捗</span>
              <span className="font-bold text-lime-50">必須 {checkSummary.requiredCompleted}/{checkSummary.requiredTotal}</span>
            </div>
          ) : null}
          {traceabilityRequired ? (
            <AssemblyRequiredTorqueEntry
              busy={busy}
              agentConnected={agentConnected}
              compatibleWrenches={compatibleWrenches}
              selectedProfileId={selectedProfileId}
              confirmation={confirmation}
              confirmationReused={confirmationReused}
              onProfileChange={setSelectedProfileId}
              onConfirm={() => void confirmPhysicalWrench()}
            />
          ) : (
            <AssemblyLegacyTorqueEntry
              value={torqueValue}
              source={torqueSource}
              disabled={busy || !session.currentBoltId}
              onValueChange={setTorqueValue}
              onSourceChange={setTorqueSource}
              onRecord={() => void recordTorque()}
            />
          )}
          <AssemblyTorqueFeedback feedback={currentTorqueFeedback} />
          <AssemblyTorqueWorkflowActions
            busy={busy}
            advanceDisabled={Boolean(session.currentBoltId) || allBoltsComplete}
            restartDisabled={!session.currentAreaId}
            completeDisabled={!canComplete}
            completeDisabledReason={completeDisabledReason}
            onAdvance={() => void runBusy(async () => setSession(await advanceAssemblyArea(session.id)))}
            onRestart={() => void runBusy(async () => setSession(await restartAssemblyArea(session.id, { reason: '画面操作によるエリアやり直し' })))}
            onComplete={() => void completeSession()}
          />
          <AssemblyTorqueHistory records={session.torqueRecords} />
        </section>
      </main>
    </div>
  );
}
