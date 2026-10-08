import { useEffect, useState } from 'react';

import { discardProcedureVideo, getProcedurePageVideos, getProcedureVideoScenes, listProcedureVideos, replaceProcedurePageVideos, restoreProcedureVideo, retryProcedureVideo } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureVideoCommentsDialog } from './ProcedureVideoCommentsDialog';
import { ProcedureVideoConcatDialog } from './ProcedureVideoConcatDialog';
import { ProcedureVideoPlaybackDialog } from './ProcedureVideoPlaybackDialog';
import { ProcedureVideoScenesDialog } from './ProcedureVideoScenesDialog';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';

import type { ProcedureVideoDto, ProcedureVideoState, ProcedureVideoSummaryDto, ProcedureVideoSceneDto, ProcedureVideoLinkItem } from './procedure-video-types';

export function procedureVideoLength(duration: number | null) { return duration == null ? '長さ未確認' : `${duration.toFixed(1)}秒`; }
export function ProcedureVideoShelfDialog({ onClose, link, onError }: { onError?: (error: unknown) => boolean; onClose: () => void; link?: { documentId: string; pageIndex: number; accessPassword: string; holderToken?: string | null } }) {
  const selectionMode = Boolean(link);
  const [videos, setVideos] = useState<ProcedureVideoDto[]>([]);
  const [scenes, setScenes] = useState<Record<string, ProcedureVideoSceneDto[]>>({});
  const [q, setQ] = useState('');
  const [state, setState] = useState<ProcedureVideoState>('active');
  const [selected, setSelected] = useState<Array<ProcedureVideoSummaryDto & ProcedureVideoLinkItem>>([]);
  const [selectionLoading, setSelectionLoading] = useState(Boolean(link));
  const [selectionFailed, setSelectionFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<ProcedureVideoSummaryDto | null>(null);
  const [editing, setEditing] = useState<{ video: ProcedureVideoDto; mode: 'scenes' | 'comments' } | null>(null);
  const [discarding, setDiscarding] = useState<ProcedureVideoDto | null>(null);
  const [concatVideos, setConcatVideos] = useState<ProcedureVideoDto[]>([]);
  const [concatenating, setConcatenating] = useState<ProcedureVideoDto[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setVideos([]); setScenes({}); setError(null);
    void listProcedureVideos({ state: selectionMode ? 'active' : state, q, limit: 100 }).then((rows) => { if (!cancelled) setVideos(rows);
      if (selectionMode) return Promise.all(rows.filter((video) => video.status === 'READY' && !video.discardedAt).map(async (video) => {
        const scenes = await getProcedureVideoScenes(video.id);
        if (!cancelled) setScenes((current) => ({ ...current, [video.id]: scenes }));
      })); })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '動画を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [state, q, version, selectionMode]);
  const processing = videos.some((video) => video.status === 'PENDING' || video.status === 'PROCESSING');
  useEffect(() => {
    if (!processing || playing || editing || concatenating) return;
    const timer = window.setInterval(() => setVersion((v) => v + 1), 5000);
    return () => window.clearInterval(timer);
  }, [processing, playing, editing, concatenating]);
  const documentId = link?.documentId;
  const pageIndex = link?.pageIndex;
  useEffect(() => {
    if (!documentId || pageIndex == null) return;
    let cancelled = false;
    void getProcedurePageVideos(documentId, pageIndex).then((rows) => { if (!cancelled) setSelected(rows.map((video) => ({ ...video, videoId: video.id, sceneId: video.sceneId ?? null }))); })
      .catch((e: unknown) => { if (!cancelled) { setSelectionFailed(true); setError(readAssemblyApiErrorMessage(e, '紐づけを取得できません')); } })
      .finally(() => { if (!cancelled) setSelectionLoading(false); });
    return () => { cancelled = true; };
  }, [documentId, pageIndex]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); setVersion((v) => v + 1); }
    catch (e) { if (!onError?.(e)) setError(readAssemblyApiErrorMessage(e, '動画を変更できません')); }
    finally { setBusy(false); }
  };
  const reorder = (index: number, offset: number) => {
    setSelected((items) => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  };
  const edited = () => { setEditing(null); setVersion((v) => v + 1); };
  if (concatenating) return <ProcedureVideoConcatDialog videos={concatenating} onClose={() => setConcatenating(null)} onSaved={() => { setConcatenating(null); setConcatVideos([]); setQ(''); setState('active'); setVersion((v) => v + 1); }} />;
  if (editing?.mode === 'scenes') return <ProcedureVideoScenesDialog video={editing.video} onClose={edited} />;
  if (editing?.mode === 'comments') return <ProcedureVideoCommentsDialog video={editing.video} onClose={() => setEditing(null)} onSaved={edited} />;
  if (playing) return <ProcedureVideoPlaybackDialog video={playing} range={playing.startSeconds != null && playing.endSeconds != null ? { startSeconds: playing.startSeconds, endSeconds: playing.endSeconds } : undefined} onClose={() => setPlaying(null)} />;
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} closeOnEsc={!discarding} trapFocus={!discarding} title={link ? `${(link.pageIndex + 1)}ページの動画` : '動画'} size="full" className="flex !max-w-[1500px] flex-col overflow-hidden !bg-slate-900 !text-slate-100">
    <p className="mt-3 shrink-0 text-sm">{concatVideos.length} 本を選択中</p>
    <div className="mt-3 flex shrink-0 flex-wrap gap-2">
      <Input aria-label="動画検索" placeholder="タイトルで検索" value={q} onChange={(e) => setQ(e.target.value)} />
      <Button className="min-h-11" disabled={busy || !concatVideos.length} onClick={() => setConcatVideos([])}>選択を解除</Button>
      {!link ? <><Button className="min-h-11" variant={state === 'active' ? 'primary' : 'secondary'} onClick={() => setState('active')}>動画</Button><Button className="min-h-11" variant={state === 'discarded' ? 'primary' : 'secondary'} onClick={() => setState('discarded')}>捨てた動画</Button></> : null}
      <Button className="min-h-11" disabled={busy} onClick={() => setVersion((v) => v + 1)}>更新</Button>
      <Button className="min-h-11" disabled={busy || loading || concatVideos.length < 2 || concatVideos.length > 5} onClick={() => setConcatenating(concatVideos)}>接続</Button>
      <span className="self-center text-sm">接続用 {concatVideos.length}/5本</span>
      <Button className="min-h-11" disabled={busy} onClick={onClose}>閉じる</Button>
    </div>
    {error ? <p role="alert" className="mt-2 shrink-0 text-sm text-red-300">{error}</p> : null}
    {link ? <section aria-label="紐づけ順" className="mt-3 max-h-48 shrink-0 overflow-auto">
      {selected.map((video, index) => <div key={`${video.sceneId ?? video.id}-${index}`} className="flex flex-wrap items-center gap-2 border-b py-1"><span className="flex-1 text-sm">{index + 1}. {video.title}</span>
        <Button className="min-h-11" aria-label={`${video.title}を上へ`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}>↑</Button>
        <Button className="min-h-11" aria-label={`${video.title}を下へ`} disabled={busy || index === selected.length - 1} onClick={() => reorder(index, 1)}>↓</Button>
        <Button className="min-h-11" disabled={busy} onClick={() => setSelected((items) => items.filter((_, itemIndex) => itemIndex !== index))}>外す</Button></div>)}
      <Button className="mt-2 min-h-11" disabled={busy || selectionLoading || selectionFailed} onClick={() => void act(async () => { await replaceProcedurePageVideos(link.documentId, link.pageIndex, selected.map(({ videoId, sceneId }) => ({ videoId, sceneId })), link.accessPassword, link.holderToken); onClose(); })}>紐づけを保存</Button>
    </section> : null}
    <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto">
      {loading ? <p role="status">読込中…</p> : !videos.length ? <p>動画がありません</p> : null}
      {videos.map((video) => <article key={video.id} className="flex flex-wrap items-center gap-3 rounded border p-2">
        {video.status === 'READY' && !video.discardedAt ? <label className="flex min-h-11 min-w-11 items-center justify-center"><input type="checkbox" aria-label={`${video.title}を接続用に選択`} checked={concatVideos.some((item) => item.id === video.id)} disabled={busy || (!concatVideos.some((item) => item.id === video.id) && concatVideos.length >= 5)} onChange={(e) => setConcatVideos((items) => e.target.checked ? [...items, video] : items.filter((item) => item.id !== video.id))} className="h-6 w-6" /></label> : null}
        {video.origin === 'CONCAT' ? <span className="rounded bg-blue-900 px-2 py-1 text-xs font-semibold">接続</span> : null}
        {video.hasPoster ? <ProcedureVideoThumbnail id={video.id} title={video.title} durationSeconds={video.durationSeconds} /> : null}
        <div className="min-w-0 flex-1"><p className="break-words font-semibold">{video.title}</p><p className="text-sm">{procedureVideoLength(video.durationSeconds)} · {video.status === 'READY' ? '完了' : video.status === 'FAILED' ? `失敗: ${video.errorMessage || video.errorCode || '変換失敗'}` : '処理中'}</p>{video.errorCode === 'TRIM_FAILED' ? <p role="alert" className="text-sm text-red-300">トリミング失敗: {video.errorMessage}（元の動画を保持しています）</p> : null}<p className="text-xs">紐づけ {video.linkCount}件</p></div>
        {video.status === 'READY' ? <Button className="min-h-11" onClick={() => setPlaying({ ...video, hasScenePoster: false, sceneId: null, startSeconds: null, endSeconds: null })}>再生</Button> : null}
        {video.status === 'READY' ? <>
          <Button className="min-h-11" disabled={busy || Boolean(video.discardedAt)} onClick={() => setEditing({ video, mode: 'scenes' })}>場面 {video.sceneCount}</Button>
          <Button className="min-h-11" disabled={busy} onClick={() => setEditing({ video, mode: 'comments' })}>コメント</Button>
        </> : null}
        {link ? <Button className="min-h-11" disabled={busy || video.status !== 'READY' || Boolean(video.discardedAt) || selectionLoading || selectionFailed || selected.some((v) => v.videoId === video.id && !v.sceneId) || selected.length >= 50} onClick={() => setSelected((items) => [...items, { ...video, videoId: video.id, hasScenePoster: false, sceneId: null, startSeconds: null, endSeconds: null }])}>選ぶ</Button> : <>
          {video.status === 'FAILED' ? <Button className="min-h-11" disabled={busy} onClick={() => void act(() => retryProcedureVideo(video.id))}>再試行</Button> : null}
          <Button className="min-h-11" disabled={busy || (!video.discardedAt && video.linkCount > 0)} onClick={() => video.discardedAt ? void act(() => restoreProcedureVideo(video.id)) : setDiscarding(video)}>{video.discardedAt ? '戻す' : '捨てる'}</Button>
        </>}
        {link && video.status === 'READY' ? <div className="basis-full space-y-1 pl-12">{(scenes[video.id] ?? []).map((scene) => {
          const item: ProcedureVideoSummaryDto = { ...video, title: scene.title, hasScenePoster: scene.hasScenePoster, sceneId: scene.id, startSeconds: scene.startSeconds, endSeconds: scene.endSeconds, durationSeconds: Math.round((scene.endSeconds - scene.startSeconds) * 10) / 10 };
          return <div key={scene.id} className="flex items-center gap-3 rounded bg-slate-800 p-2"><ProcedureVideoThumbnail id={video.id} sceneId={scene.id} hasScenePoster={scene.hasScenePoster} title={scene.title} className="h-12 w-20" /><span className="min-w-0 flex-1"><span className="font-semibold">{scene.title}</span><span className="ml-2 font-mono text-sm">{scene.startSeconds.toFixed(1)} – {scene.endSeconds.toFixed(1)} · {procedureVideoLength(item.durationSeconds)}</span></span>
            <Button className="min-h-11" aria-label={`${scene.title}を再生`} onClick={() => setPlaying(item)}>再生</Button>
            <Button className="min-h-11" aria-label={`${scene.title}を選ぶ`} disabled={busy || selectionLoading || selectionFailed || selected.length >= 50 || selected.some((selected) => selected.videoId === video.id && selected.sceneId === scene.id)} onClick={() => setSelected((items) => [...items, { ...item, videoId: video.id }])}>選ぶ</Button>
          </div>;
        })}</div> : null}
      </article>)}
    </div>
    <ConfirmDialog isOpen={Boolean(discarding)} onCancel={() => setDiscarding(null)} onConfirm={() => { const video = discarding; setDiscarding(null); if (video) void act(() => discardProcedureVideo(video.id)); }} title="動画を捨てる" description="捨てた動画から戻せます。" confirmLabel="捨てる" />
  </Dialog>;
}
