import { useRef, useState, type KeyboardEvent } from 'react';

import { trimProcedureVideo } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Dialog } from '../../../components/ui/Dialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureVideoPlayer } from './ProcedureVideoPlayer';

import type { ProcedureVideoSummaryDto } from './procedure-video-types';

export function ProcedureVideoTrimDialog({ video, onClose, onSaved }: { video: ProcedureVideoSummaryDto; onClose: () => void; onSaved: () => void }) {
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const [activeHandle, setActiveHandle] = useState<'start' | 'end'>('start');
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = Math.floor((video.durationSeconds ?? 0) * 10) / 10;
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(duration, 10));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = Math.round((end - start) * 10) / 10;
  const move = (handle: 'start' | 'end', value: number) => {
    setActiveHandle(handle);
    const rounded = Math.round(value * 10) / 10;
    if (handle === 'start') setStart(Math.max(0, Math.min(rounded, end - 0.5)));
    else setEnd(Math.min(duration, Math.max(rounded, start + 0.5)));
  };
  const key = (handle: 'start' | 'end', event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    move(handle, (handle === 'start' ? start : end) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
  };
  const submit = async () => {
    setConfirming(false); setBusy(true); setError(null);
    try { await trimProcedureVideo(video.id, start, end); onSaved(); }
    catch (e) { setError(readAssemblyApiErrorMessage(e, 'トリミングを開始できません')); }
    finally { setBusy(false); }
  };
  const rangeClass = 'pointer-events-none absolute left-0 top-0 h-11 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-11 [&::-webkit-slider-thumb]:w-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:bg-blue-700 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-11 [&::-moz-range-thumb]:w-11 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:bg-blue-700';
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} closeOnEsc={!confirming} trapFocus={!confirming} closeOnBackdrop={!confirming && !busy} title="動画のトリミング" size="lg" className="overflow-y-auto">
    <ProcedureVideoPlayer video={video} videoRef={videoRef} />
    <fieldset disabled={busy || duration < 0.5} className="mt-3">
      <legend className="text-sm">切り出す範囲（← →: 0.1秒、Shift: 1秒）</legend>
      <div className="relative my-2 h-11">
        <div className="absolute left-0 right-0 top-5 h-2 rounded bg-slate-300"><div className="absolute h-full bg-blue-600" style={{ left: `${duration ? start / duration * 100 : 0}%`, width: `${duration ? length / duration * 100 : 0}%` }} /></div>
        <input ref={startRef} aria-label="開始秒" aria-valuenow={start} onFocus={() => setActiveHandle('start')} onPointerDown={() => setActiveHandle('start')} type="range" min={0} max={Math.max(0, end - 0.5)} step={0.1} value={start} style={{ zIndex: activeHandle === 'start' ? 2 : 1, width: `${duration ? Math.max(0, end - 0.5) / duration * 100 : 0}%` }} onChange={(e) => move('start', Number(e.target.value))} onKeyDown={(e) => key('start', e)} className={rangeClass} />
        <input ref={endRef} aria-label="終了秒" aria-valuenow={end} onFocus={() => setActiveHandle('end')} onPointerDown={() => setActiveHandle('end')} type="range" min={Math.min(duration, start + 0.5)} max={duration} step={0.1} value={end} style={{ zIndex: activeHandle === 'end' ? 2 : 1, left: `${duration ? Math.min(duration, start + 0.5) / duration * 100 : 0}%`, width: `${duration ? Math.max(0, duration - start - 0.5) / duration * 100 : 0}%` }} onChange={(e) => move('end', Number(e.target.value))} onKeyDown={(e) => key('end', e)} className={rangeClass} />
      </div>
      <div className="flex gap-2">
        <Button className="min-h-11" aria-pressed={activeHandle === 'start'} onClick={() => startRef.current?.focus()}>開始つまみを操作</Button>
        <Button className="min-h-11" aria-pressed={activeHandle === 'end'} onClick={() => endRef.current?.focus()}>終了つまみを操作</Button>
      </div>
      <p className="text-sm">開始 {start.toFixed(1)}秒 / 終了 {end.toFixed(1)}秒</p>
      <p role="status" aria-label="選択長さ" className={length > 10 ? 'font-semibold text-red-700' : 'font-semibold'}>選択長さ {length.toFixed(1)}秒{length > 10 ? '（10 秒以内にしてください）' : ''}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={() => move('start', videoRef.current?.currentTime ?? start)}>開始を現在位置に</Button>
        <Button className="min-h-11" onClick={() => move('end', videoRef.current?.currentTime ?? end)}>終了を現在位置に</Button>
        <Button className="min-h-11" disabled={length < 0.5} onClick={() => setConfirming(true)}>この範囲で切り出す</Button>
      </div>
    </fieldset>
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
    {busy ? <p role="status">トリミングを依頼中…</p> : null}
    <Button className="mt-3 min-h-11" disabled={busy} onClick={onClose}>閉じる</Button>
    <ConfirmDialog isOpen={confirming} onCancel={() => setConfirming(false)} onConfirm={() => void submit()} title="この範囲で切り出しますか" description={`${start.toFixed(1)}〜${end.toFixed(1)}秒を残します。切り出し後に元に戻す機能はありません。`} confirmLabel="切り出す" />
  </Dialog>;
}
