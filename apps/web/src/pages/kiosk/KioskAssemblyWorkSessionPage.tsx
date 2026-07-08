import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  advanceAssemblyArea,
  completeAssemblyWorkSession,
  downloadAssemblyWorkSessionXlsx,
  getAssemblyWorkSession,
  getAssemblyWorkSessionProcedureSequence,
  recordAssemblyCheck,
  recordAssemblyTorque,
  restartAssemblyArea
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import {
  AssemblyProcedureCanvas,
  AssemblyProcedureSequenceViewer,
  currentAssemblyArea,
  currentAssemblyBolt,
  kioskAssemblyTemplateEditPath,
  KIOSK_ASSEMBLY_HOME_PATH,
  latestStatusByBolt,
  readAssemblyApiErrorMessage,
  resolveAssemblyCheckSummary,
  sessionCheckItemsToCanvas,
  templateToCanvasBolts
} from '../../features/assembly';

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
  const allBoltsComplete = session
    ? session.template.areas.every((area) => area.bolts.every((bolt) => statusByBolt.get(bolt.id) === 'ok'))
    : false;
  const checksComplete = checkSummary?.allRequiredCompleted ?? true;
  const canComplete = Boolean(session && allBoltsComplete && checksComplete && session.status === 'in_progress');
  const hasConfiguredProcedureSequence =
    procedureSequence?.mode === 'configured' && procedureSequence.documents.length > 0;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0">
          <h1 className="text-[1.28rem] font-bold leading-tight">組立締付作業</h1>
          <p className="mt-1 truncate text-sm text-white/60">
            {session.productNo} / {session.template.modelCode} / {session.template.procedurePattern}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}>
            組立トップ
          </Link>
          <Link
            to={kioskAssemblyTemplateEditPath(session.template.id)}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}
          >
            テンプレ
          </Link>
          <Button type="button" variant="ghostOnDark" className="min-h-10" disabled={busy} onClick={() => void downloadAssemblyWorkSessionXlsx(session.id)}>
            Excel
          </Button>
        </div>
      </div>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(0,1fr)_minmax(21rem,27rem)] xl:overflow-hidden">
        <section className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0">
          <div className="shrink-0 border-b border-white/10 p-3">
            <h2 className="text-[1.02rem] font-bold">{hasConfiguredProcedureSequence ? '要領書 / ページ送り' : '手順書 / 締付位置'}</h2>
            <p className="mt-1 text-sm text-white/60">
              {procedureSequenceLoading
                ? '要領書を確認中'
                : currentBolt?.tighteningId ?? (allBoltsComplete ? '全締付完了' : '次工程待ち')}
            </p>
            {checkSummary && checkSummary.requiredTotal > 0 ? (
              <p className="mt-1 text-sm font-semibold text-lime-200">
                必須チェック {checkSummary.requiredCompleted}/{checkSummary.requiredTotal}
              </p>
            ) : null}
          </div>
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
            <div className="mt-1 text-lg font-bold">{currentBolt?.tighteningId ?? (allBoltsComplete ? '全締付完了' : '次工程待ち')}</div>
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
                  <div className="font-semibold">{record.tighteningId}</div>
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
