import { useEffect, useState } from 'react';

import { discardProcedureVideo, getProcedurePageVideos, listProcedureVideos, replaceProcedurePageVideos, restoreProcedureVideo, retryProcedureVideo } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureVideoPlaybackDialog } from './ProcedureVideoPlaybackDialog';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';

import type { ProcedureVideoDto, ProcedureVideoState, ProcedureVideoSummaryDto } from './procedure-video-types';

export function procedureVideoLength(duration: number | null) { return duration == null ? '長さ未確認' : `${duration.toFixed(1)}秒`; }
export function ProcedureVideoShelfDialog({ onClose, link }: { onClose: () => void; link?: { documentId: string; pageIndex: number; accessPassword: string } }) {
  const selectionMode = Boolean(link);
  const [videos, setVideos] = useState<ProcedureVideoDto[]>([]);
  const [q, setQ] = useState('');
  const [state, setState] = useState<ProcedureVideoState>('active');
  const [selected, setSelected] = useState<ProcedureVideoSummaryDto[]>([]);
  const [selectionLoading, setSelectionLoading] = useState(Boolean(link));
  const [selectionFailed, setSelectionFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<ProcedureVideoSummaryDto | null>(null);
  const [discarding, setDiscarding] = useState<ProcedureVideoDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setVideos([]); setError(null);
    void listProcedureVideos({ state: selectionMode ? 'active' : state, q, limit: 100 }).then((rows) => { if (!cancelled) setVideos(rows); })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '動画を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [state, q, version, selectionMode]);
  const documentId = link?.documentId;
  const pageIndex = link?.pageIndex;
  useEffect(() => {
    if (!documentId || pageIndex == null) return;
    let cancelled = false;
    void getProcedurePageVideos(documentId, pageIndex).then((rows) => { if (!cancelled) setSelected(rows); })
      .catch((e: unknown) => { if (!cancelled) { setSelectionFailed(true); setError(readAssemblyApiErrorMessage(e, '紐づけを取得できません')); } })
      .finally(() => { if (!cancelled) setSelectionLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, pageIndex]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); setVersion((v) => v + 1); }
    catch (e) { setError(readAssemblyApiErrorMessage(e, '動画を変更できません')); }
    finally { setBusy(false); }
  };
  const reorder = (index: number, offset: number) => {
    setSelected((items) => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  };
  if (playing) return <ProcedureVideoPlaybackDialog video={playing} onClose={() => setPlaying(null)} />;
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} closeOnEsc={!discarding} trapFocus={!discarding} title={link ? `${(link.pageIndex + 1)}ページの動画` : '動画'} size="lg" className="flex flex-col overflow-hidden">
    <div className="mt-3 flex shrink-0 flex-wrap gap-2">
      <Input aria-label="動画検索" placeholder="タイトルで検索" value={q} onChange={(e) => setQ(e.target.value)} />
      {!link ? <><Button className="min-h-11" variant={state === 'active' ? 'primary' : 'secondary'} onClick={() => setState('active')}>動画</Button><Button className="min-h-11" variant={state === 'discarded' ? 'primary' : 'secondary'} onClick={() => setState('discarded')}>捨てた動画</Button></> : null}
      <Button className="min-h-11" disabled={busy} onClick={() => setVersion((v) => v + 1)}>更新</Button>
      <Button className="min-h-11" disabled={busy} onClick={onClose}>閉じる</Button>
    </div>
    {error ? <p role="alert" className="mt-2 shrink-0 text-sm text-red-700">{error}</p> : null}
    {link ? <section aria-label="紐づけ順" className="mt-3 max-h-48 shrink-0 overflow-auto">
      {selected.map((video, index) => <div key={video.id} className="flex flex-wrap items-center gap-2 border-b py-1"><span className="flex-1 text-sm">{index + 1}. {video.title}</span>
        <Button className="min-h-11" aria-label={`${video.title}を上へ`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}>↑</Button>
        <Button className="min-h-11" aria-label={`${video.title}を下へ`} disabled={busy || index === selected.length - 1} onClick={() => reorder(index, 1)}>↓</Button>
        <Button className="min-h-11" disabled={busy} onClick={() => setSelected((items) => items.filter((item) => item.id !== video.id))}>外す</Button></div>)}
      <Button className="mt-2 min-h-11" disabled={busy || selectionLoading || selectionFailed} onClick={() => void act(async () => { await replaceProcedurePageVideos(link.documentId, link.pageIndex, selected.map((v) => v.id), link.accessPassword); onClose(); })}>紐づけを保存</Button>
    </section> : null}
    <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto">
      {loading ? <p role="status">読込中…</p> : !videos.length ? <p>動画がありません</p> : null}
      {videos.map((video) => <article key={video.id} className="flex flex-wrap items-center gap-3 rounded border p-2">
        {video.hasPoster ? <ProcedureVideoThumbnail id={video.id} title={video.title} /> : null}
        <div className="min-w-0 flex-1"><p className="break-words font-semibold">{video.title}</p><p className="text-sm">{procedureVideoLength(video.durationSeconds)} · {video.status === 'READY' ? '完了' : video.status === 'FAILED' ? `失敗: ${video.errorMessage || video.errorCode || '変換失敗'}` : '処理中'}</p><p className="text-xs">紐づけ {video.linkCount}件</p></div>
        {video.status === 'READY' ? <Button className="min-h-11" onClick={() => setPlaying(video)}>再生</Button> : null}
        {link ? <Button className="min-h-11" disabled={busy || selectionLoading || selectionFailed || selected.some((v) => v.id === video.id) || selected.length >= 50} onClick={() => setSelected((items) => [...items, video])}>選ぶ</Button> : <>
          {video.status === 'FAILED' ? <Button className="min-h-11" disabled={busy} onClick={() => void act(() => retryProcedureVideo(video.id))}>再試行</Button> : null}
          <Button className="min-h-11" disabled={busy || (!video.discardedAt && video.linkCount > 0)} onClick={() => video.discardedAt ? void act(() => restoreProcedureVideo(video.id)) : setDiscarding(video)}>{video.discardedAt ? '戻す' : '捨てる'}</Button>
        </>}
      </article>)}
    </div>
    <ConfirmDialog isOpen={Boolean(discarding)} onCancel={() => setDiscarding(null)} onConfirm={() => { const video = discarding; setDiscarding(null); if (video) void act(() => discardProcedureVideo(video.id)); }} title="動画を捨てる" description="捨てた動画から戻せます。" confirmLabel="捨てる" />
  </Dialog>;
}
