import { useRef } from 'react';

import { Button } from '../../../components/ui/Button';

import { moveSceneBoundary, sceneColors } from './procedure-video-timeline';

import type { ProcedureVideoAutoEditScene } from '@raspi-system/shared-types';

export function ProcedureVideoTimeline({ scenes, duration, position, editable, playing, onSeek, onChange, onPlay, onSplit }: {
  scenes: ProcedureVideoAutoEditScene[]; duration: number; position: number; editable: boolean; playing: boolean;
  onSeek: (seconds: number) => void; onChange: (scenes: ProcedureVideoAutoEditScene[]) => void; onPlay: () => void; onSplit: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const secondsAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    return rect?.width ? Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration)) : 0;
  };
  // 境目を動かしている間は、動画をその境目のコマに合わせて止める
  const moveBoundary = (index: number, seconds: number) => {
    const next = moveSceneBoundary(scenes, index, seconds);
    onChange(next);
    onSeek(next[index].startSeconds);
  };
  const percent = (seconds: number) => duration > 0 ? seconds / duration * 100 : 0;
  const ticks = Array.from({ length: Math.floor(duration / (duration > 20 ? 5 : 2)) + 1 }, (_, i) => i * (duration > 20 ? 5 : 2));
  return <div className="shrink-0 space-y-2">
    <div ref={track} className={`relative select-none ${scenes.length ? 'h-[104px]' : 'h-[60px]'}`} aria-label="時間軸">
      <div className="absolute inset-x-0 top-0 h-4 font-mono text-[10px] text-slate-400">{ticks.map((time) => <span key={time} className="absolute" style={{ left: `${percent(time)}%`, transform: time ? 'translateX(-100%)' : undefined }}>{time}s</span>)}</div>
      <input type="range" min="0" max={duration || 0.1} step="0.1" value={position} aria-label="再生位置" onChange={(e) => onSeek(Number(e.target.value))} className="absolute inset-x-0 top-4 h-11 w-full cursor-pointer accent-amber-400" />
      {scenes.length ? <div className="absolute inset-x-0 bottom-0 h-11 rounded bg-slate-800">{scenes.map((scene, index) => <Button key={index} variant="ghostOnDark" aria-label={`${scene.title || `場面 ${index + 1}`}の頭へ移動`} className="absolute min-h-11 overflow-hidden !border-0 !px-2 text-xs !text-slate-950" style={{ left: `${percent(scene.startSeconds)}%`, width: `${percent(scene.endSeconds - scene.startSeconds)}%`, backgroundColor: sceneColors[index] }} onClick={() => onSeek(scene.startSeconds)}>{scene.title || `場面 ${index + 1}`}</Button>)}</div> : null}
      {editable ? scenes.slice(1).map((scene, index) => <button key={index} type="button" role="slider" tabIndex={0} aria-label={`場面${index + 1}と${index + 2}の境目`} aria-valuemin={scenes[index].startSeconds + 0.5} aria-valuemax={scene.endSeconds - 0.5} aria-valuenow={scene.startSeconds}
        className="absolute top-[58px] z-10 flex h-11 w-5 -translate-x-1/2 touch-none cursor-ew-resize items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" style={{ left: `${percent(scene.startSeconds)}%` }}
        onPointerDown={(e) => { if (playing) onPlay(); dragging.current = index + 1; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
        onPointerMove={(e) => { if (dragging.current === index + 1) moveBoundary(index + 1, secondsAt(e.clientX)); }}
        onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); moveBoundary(index + 1, scene.startSeconds + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1)); } }}>
        <span className="h-10 w-1 rounded bg-slate-100 shadow" /><span className="absolute h-6 w-3 rounded bg-slate-100 shadow" />
      </button>) : null}
      <div className={`pointer-events-none absolute top-3 w-0.5 bg-amber-400 ${scenes.length ? 'h-[92px]' : 'h-12'}`} style={{ left: `${percent(position)}%` }}><span className="absolute -left-1 -top-1 text-xs text-amber-400">▼</span></div>
    </div>
    <div className="flex min-h-11 items-center gap-2">
      <Button variant="ghostOnDark" className="min-h-11 min-w-11 !bg-slate-100 !px-2 !text-slate-950" aria-label={playing ? '一時停止' : '再生'} onClick={onPlay}>{playing ? 'Ⅱ' : '▶'}</Button>
      <span className="whitespace-nowrap font-mono text-sm tabular-nums">{position.toFixed(1)} <span className="text-slate-400">/ {duration.toFixed(1)}s</span></span>
      {editable ? <Button variant="ghostOnDark" className="ml-auto min-h-11 whitespace-nowrap !px-2 text-sm" disabled={scenes.length >= 5} onClick={onSplit}>ここで分ける <kbd className="text-xs text-slate-400">S</kbd></Button> : null}
    </div>
  </div>;
}
