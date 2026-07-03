import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  advanceAssemblyArea,
  completeAssemblyWorkSession,
  downloadAssemblyWorkSessionXlsx,
  getAssemblyWorkSession,
  recordAssemblyTorque,
  restartAssemblyArea
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import {
  AssemblyProcedureCanvas,
  currentAssemblyArea,
  currentAssemblyBolt,
  kioskAssemblyTemplateEditPath,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  latestStatusByBolt,
  readAssemblyApiErrorMessage,
  templateToCanvasBolts
} from '../../features/assembly';

import type { AssemblyWorkSessionDto } from '../../features/assembly/types';

export function KioskAssemblyWorkSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<AssemblyWorkSessionDto | null>(null);
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

  const statusByBolt = useMemo(() => (session ? latestStatusByBolt(session) : new Map()), [session]);
  const currentArea = session ? currentAssemblyArea(session) : null;
  const currentBolt = session ? currentAssemblyBolt(session) : null;
  const allComplete = session
    ? session.template.areas.every((area) => area.bolts.every((bolt) => statusByBolt.get(bolt.id) === 'ok'))
    : false;

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

  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
        <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 w-fit items-center')}>
          一覧へ
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
          <Link to={KIOSK_ASSEMBLY_LIBRARY_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center')}>
            一覧へ
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
            <h2 className="text-[1.02rem] font-bold">手順書 / 締付位置</h2>
            <p className="mt-1 text-sm text-white/60">{currentBolt?.tighteningId ?? (allComplete ? '全締付完了' : '次工程待ち')}</p>
          </div>
          <div className="min-h-0 flex-1">
            <AssemblyProcedureCanvas
              imageRelativePath={session.template.procedureDocument.imageRelativePath}
              bolts={templateToCanvasBolts(session.template, statusByBolt)}
              selectedBoltId={session.currentBoltId}
              className="h-full"
            />
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">締付</h2>
          <div className="mt-3 rounded border border-white/10 bg-slate-950 p-3">
            <div className="text-sm text-white/60">現在</div>
            <div className="mt-1 text-lg font-bold">{currentBolt?.tighteningId ?? (allComplete ? '全締付完了' : '次工程待ち')}</div>
            <div className="mt-1 text-sm text-white/70">{currentArea?.areaName ?? ''}</div>
            {currentBolt ? (
              <div className="mt-2 text-sm text-white/80">
                規定 {currentBolt.nominalTorque} / 下限 {currentBolt.lowerLimit} / 上限 {currentBolt.upperLimit} {currentBolt.unit}
              </div>
            ) : null}
          </div>
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
              disabled={busy || Boolean(session.currentBoltId) || allComplete}
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
              disabled={busy || !allComplete || session.status !== 'in_progress'}
              className="col-span-2"
              onClick={() => void runBusy(async () => setSession(await completeAssemblyWorkSession(session.id)))}
            >
              作業完了
            </Button>
          </div>
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
