import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { createProcedureVideoScene, deleteProcedureVideoScene, getProcedureVideoScenes, updateProcedureVideoScene } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureVideoPlayer } from './ProcedureVideoPlayer';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';

import type { ProcedureVideoDto, ProcedureVideoRange, ProcedureVideoSceneDto } from './procedure-video-types';

const colors = ['#58b7ff', '#63d6a0', '#c79bff', '#ff9fc0', '#ffd166', '#7fe0e6'];
const round = (value: number) => Math.round(value * 10) / 10;
const buttonClass = 'min-h-11 !bg-slate-800 !text-slate-100';
const locked = 'ページに紐づいている場面です';
export function ProcedureVideoScenesDialog({ video, onClose }: { video: ProcedureVideoDto; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const preview = useRef<ProcedureVideoRange | null>(null);
  const duration = Math.floor((video.durationSeconds ?? 0) * 10) / 10;
  const [range, setRange] = useState({ startSeconds: 0, endSeconds: Math.min(duration, 10) });
  const [scenes, setScenes] = useState<ProcedureVideoSceneDto[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ProcedureVideoSceneDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeHandle, setActiveHandle] = useState<'startSeconds' | 'endSeconds'>('startSeconds');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getProcedureVideoScenes(video.id).then((rows) => { if (!cancelled) setScenes(rows); })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, '場面を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [video.id]);
  const stop = () => { preview.current = null; setPlaying(false); videoRef.current?.pause(); };
  const move = (handle: 'startSeconds' | 'endSeconds', value: number) => {
    stop(); setActiveHandle(handle);
    const next = round(handle === 'startSeconds' ? Math.max(0, Math.min(round(value), range.endSeconds - 0.5)) : Math.min(duration, Math.max(round(value), range.startSeconds + 0.5)));
    setRange((current) => ({ ...current, [handle]: next }));
    if (videoRef.current) videoRef.current.currentTime = next;
  };
  const drag = (handle: 'startSeconds' | 'endSeconds', event: PointerEvent<HTMLButtonElement>) => {
    const track = trackRef.current?.getBoundingClientRect();
    if (track?.width) move(handle, (event.clientX - track.left) / track.width * duration);
  };
  const key = (handle: 'startSeconds' | 'endSeconds', event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); move(handle, range[handle] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
  };
  const play = async (selection: ProcedureVideoRange) => {
    const player = videoRef.current; if (!player) return;
    player.pause(); player.currentTime = selection.startSeconds; preview.current = selection;
    try { await player.play(); setPlaying(true); }
    catch (e) { setError(readAssemblyApiErrorMessage(e, '再生できません')); }
  };
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(readAssemblyApiErrorMessage(e, '場面を変更できません')); }
    finally { setBusy(false); }
  };
  const put = (scene: ProcedureVideoSceneDto) => setScenes((rows) => [...rows.filter((row) => row.id !== scene.id), scene].sort((a, b) => a.startSeconds - b.startSeconds || a.id.localeCompare(b.id)));
  const percent = (seconds: number) => `${duration ? seconds / duration * 100 : 0}%`;
  const length = round(range.endSeconds - range.startSeconds);
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} closeOnBackdrop={!busy} title="動画の場面" size="full" className="flex !max-w-[1500px] flex-col overflow-hidden !bg-slate-900 !text-slate-100">
    <div className="mt-2 flex shrink-0 items-center gap-3"><span className="min-w-0 flex-1 truncate">{video.title} · {duration.toFixed(1)}秒 · 場面 {scenes.length}/20</span><Button className={buttonClass} disabled={busy} onClick={onClose}>閉じる</Button></div>
    <div className="mt-3 grid min-h-0 grid-cols-[minmax(0,1fr)_400px] gap-4">
      <div className="min-w-0">
        <ProcedureVideoPlayer video={video} videoRef={videoRef} comments={[]} controls={false} onTimeUpdate={(player) => { const selection = preview.current; if (selection && (player.currentTime < selection.startSeconds || player.currentTime >= selection.endSeconds)) { const ended = player.ended; player.currentTime = selection.startSeconds; if (ended) void player.play().catch(() => undefined); } }} />
        <fieldset disabled={busy || duration < 0.5} className="mt-3 select-none px-[22px]">
          <legend className="sr-only">場面の範囲</legend>
          <div aria-label="既存の場面" className="relative h-4">{scenes.map((scene, index) => <span key={scene.id} title={scene.title} className="absolute top-1 h-2 rounded" style={{ left: percent(scene.startSeconds), width: percent(scene.endSeconds - scene.startSeconds), background: colors[index % colors.length] }} />)}</div>
          <div ref={trackRef} className="relative h-11 touch-none">
            <div className="absolute inset-x-0 top-5 h-1.5 rounded bg-slate-700" />
            <div className="absolute top-4 h-3 rounded bg-amber-400" style={{ left: percent(range.startSeconds), width: percent(length) }} />
            {(['startSeconds', 'endSeconds'] as const).map((handle) => <button key={handle} type="button" role="slider" aria-label={handle === 'startSeconds' ? '開始秒' : '終了秒'} aria-valuemin={handle === 'startSeconds' ? 0 : round(range.startSeconds + 0.5)} aria-valuemax={handle === 'startSeconds' ? round(range.endSeconds - 0.5) : duration} aria-valuenow={range[handle]} aria-valuetext={`${range[handle].toFixed(1)}秒`}
              className="absolute top-0 -ml-[22px] flex h-11 w-11 touch-none items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ left: percent(range[handle]), zIndex: activeHandle === handle ? 2 : 1 }} onFocus={() => setActiveHandle(handle)}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag(handle, event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(handle, event); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} onKeyDown={(event) => key(handle, event)}><span className="h-9 w-3.5 rounded bg-amber-400 ring-2 ring-slate-900" /></button>)}
          </div>
          <div className="flex justify-between text-xs text-slate-400"><span>0</span><span>{(duration / 2).toFixed(1)}</span><span>{duration.toFixed(1)}秒</span></div>
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button className={buttonClass} disabled={duration < 0.5} onClick={() => playing ? stop() : void play(range)}>{playing ? '止める' : '範囲を再生'}</Button>
          <Button className="min-h-11 !bg-amber-400 !text-slate-950" disabled={busy || loading || length < 0.5 || (!editing && scenes.length >= 20)} onClick={() => void act(async () => {
            if (editing) { await updateProcedureVideoScene(video.id, editing, range); setEditing(null); }
            else await createProcedureVideoScene(video.id, range);
            setScenes(await getProcedureVideoScenes(video.id));
          })}>{editing ? '範囲を更新' : '＋ 場面に追加'}</Button>
          {editing ? <Button className={buttonClass} disabled={busy} onClick={() => { stop(); setEditing(null); }}>やめる</Button> : null}
          <span role="status" aria-label="選択長さ" className="ml-auto font-mono text-sm">{range.startSeconds.toFixed(1)} – {range.endSeconds.toFixed(1)} ｜ {length.toFixed(1)}秒</span>
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
      </div>
      <aside className="flex max-h-[72dvh] min-h-0 flex-col gap-2 rounded border border-slate-700 bg-slate-800 p-3">
        <h3 className="text-sm text-slate-400">場面{editing ? ' · 範囲を編集中' : ''}</h3>
        <div className="min-h-0 space-y-2 overflow-auto">
          {loading ? <p role="status">読込中…</p> : !scenes.length ? <p className="text-sm text-slate-400">場面がありません</p> : null}
          {scenes.map((scene, index) => <article key={scene.id} className={`flex gap-2 rounded border p-2 ${editing === scene.id ? 'border-amber-400' : 'border-slate-700'}`}>
            <span className="w-1.5 shrink-0 rounded" style={{ background: colors[index % colors.length] }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ProcedureVideoThumbnail key={`${scene.id}:${scene.startSeconds}:${scene.endSeconds}`} id={video.id} sceneId={scene.id} hasScenePoster={scene.hasScenePoster} title={scene.title} className="h-12 w-20" />
                <input aria-label={`${scene.title}の名前`} maxLength={80} defaultValue={scene.title} disabled={busy} className="min-h-11 w-full border-b border-transparent bg-transparent font-semibold focus:border-amber-400 focus:outline-none" onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={(event) => { const title = event.currentTarget.value.trim(); if (title && title !== scene.title) void act(async () => put(await updateProcedureVideoScene(video.id, scene.id, { title }))); }} />
              </div>
              <p className="font-mono text-xs text-slate-400">{scene.startSeconds.toFixed(1)} – {scene.endSeconds.toFixed(1)} · {round(scene.endSeconds - scene.startSeconds).toFixed(1)}秒{scene.linkCount ? ` · 紐づけ ${scene.linkCount}` : ''}</p>
              <div className="mt-1 flex gap-1">
                <Button className={buttonClass} aria-label={`${scene.title}を再生`} onClick={() => void play(scene)}>▶</Button>
                <Button className={buttonClass} aria-label={`${scene.title}の範囲を編集`} disabled={busy || scene.linkCount > 0} title={scene.linkCount ? locked : undefined} onClick={() => { stop(); setEditing(scene.id); setRange({ startSeconds: scene.startSeconds, endSeconds: scene.endSeconds }); if (videoRef.current) videoRef.current.currentTime = scene.startSeconds; }}>範囲</Button>
                <Button className={buttonClass} aria-label={`${scene.title}を削除`} disabled={busy || scene.linkCount > 0} title={scene.linkCount ? locked : undefined} onClick={() => void act(async () => { await deleteProcedureVideoScene(video.id, scene.id); setScenes((rows) => rows.filter((row) => row.id !== scene.id)); setRemoved(scene); if (editing === scene.id) setEditing(null); stop(); })}>削除</Button>
              </div>
            </div>
          </article>)}
        </div>
        {removed ? <div className="flex shrink-0 items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{removed.title}を削除</span><Button className={buttonClass} disabled={busy} onClick={() => void act(async () => { await createProcedureVideoScene(video.id, { title: removed.title, startSeconds: removed.startSeconds, endSeconds: removed.endSeconds }); setScenes(await getProcedureVideoScenes(video.id)); setRemoved(null); })}>元に戻す</Button></div> : null}
      </aside>
    </div>
  </Dialog>;
}
