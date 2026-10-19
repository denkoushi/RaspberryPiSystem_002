import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';

import { splitScene } from './procedure-video-timeline';
import { ProcedureVideoAutoEditPanel } from './ProcedureVideoAutoEditPanel';
import { ProcedureVideoPlayer } from './ProcedureVideoPlayer';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';
import { ProcedureVideoTimeline } from './ProcedureVideoTimeline';
import { useProcedureVideoAutoEdit } from './useProcedureVideoAutoEdit';

import type { ProcedureVideoDto, ProcedureVideoState } from './procedure-video-types';
import type { ReactNode } from 'react';

function aiLabel(video: ProcedureVideoDto) {
  const ai = video.autoEdit;
  if (ai?.decision === 'APPLIED') return ['採用済み', 'bg-blue-400 text-blue-200'];
  if (ai?.decision === 'DISMISSED' || !ai) return ['AI案なし', 'bg-slate-400 text-slate-400'];
  if (ai.status === 'READY') return ['AI案あり', 'bg-emerald-400 text-emerald-200'];
  if (ai.status === 'PENDING' || ai.status === 'RUNNING') return ['AI案を作成中', 'bg-amber-400 text-slate-400'];
  return ['AI案を作れませんでした', 'bg-red-400 text-red-300'];
}
const length = (seconds: number | null) => seconds == null ? '長さ未確認' : `${seconds.toFixed(1)}秒`;

export function ProcedureVideoDesk({ videos, selectedId, onSelect, loading, busy, q, onSearch, state, onState, onRefresh, onClose, error, onError, autoEditDisabled, onAutoEditDisabled, onChanged, concatVideos, onConcatSelect, shelfActions, videoActions, confirmation, confirming }: {
  videos: ProcedureVideoDto[]; selectedId: string | null; onSelect: (id: string) => void; loading: boolean; busy: boolean;
  q: string; onSearch: (value: string) => void; state: ProcedureVideoState; onState: (state: ProcedureVideoState) => void;
  onRefresh: () => void; onClose: () => void; error: string | null; onError: (message: string) => void;
  autoEditDisabled: boolean; onAutoEditDisabled: () => void; onChanged: () => void;
  concatVideos: ProcedureVideoDto[]; onConcatSelect: (video: ProcedureVideoDto, selected: boolean) => void;
  shelfActions: ReactNode; videoActions: (video: ProcedureVideoDto) => ReactNode; confirmation: ReactNode; confirming: boolean;
}) {
  const video = videos.find((item) => item.id === selectedId) ?? videos[0];
  const [refreshVersion, setRefreshVersion] = useState(0);
  const edit = useProcedureVideoAutoEdit(video, autoEditDisabled, onAutoEditDisabled, onChanged, onError, refreshVersion);
  const player = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [splitMessage, setSplitMessage] = useState<string | null>(null);
  const duration = video?.durationSeconds ?? 0;
  const canEdit = video?.status === 'READY' && !video.discardedAt;
  const editable = Boolean(canEdit && !autoEditDisabled && edit.row?.status === 'READY' && !edit.row.decision && !edit.dismissed && !edit.loading && !edit.busy);
  const applied = edit.row?.decision === 'APPLIED';
  const scenes = editable ? edit.draft : applied ? (edit.row?.confirmed?.scenes ?? []).map((scene) => ({ ...scene, caption: '' })) : [];
  const draftCaption = editable ? edit.draft.find((scene) => position >= scene.startSeconds && position < scene.endSeconds)?.caption : null;
  const savedCaption = !editable ? [...edit.comments].reverse().find((comment) => position >= comment.atSeconds && position < comment.atSeconds + 4)?.text : null;
  const caption = draftCaption || savedCaption;
  useEffect(() => { setPosition(0); setPlaying(false); setSplitMessage(null); }, [video?.id]);
  useEffect(() => { if (!splitMessage) return; const timer = setTimeout(() => setSplitMessage(null), 4000); return () => clearTimeout(timer); }, [splitMessage]);
  const seek = (seconds: number, play = false) => {
    const at = Math.max(0, Math.min(duration, seconds));
    setPosition(at);
    if (player.current) {
      player.current.currentTime = at;
      if (play) void player.current.play().catch(() => onError('再生できません'));
    }
  };
  const togglePlay = () => {
    if (!player.current) return;
    if (!player.current.paused) player.current.pause();
    else { if (position >= duration) seek(0); void player.current.play().catch(() => onError('再生できません')); }
  };
  const split = () => {
    if (!editable) return;
    const next = splitScene(edit.draft, position);
    if (next === edit.draft) setSplitMessage(edit.draft.length >= 5 ? '場面は5つまでです' : '場面の端に近すぎます。少し動かしてください');
    else { edit.changeDraft(next); setSplitMessage('場面を分けました'); }
  };
  const leave = async (action: () => void) => { if (!busy && !edit.busy && await edit.flushDismiss()) action(); };
  return <Dialog isOpen ariaLabel="動画" onClose={() => void leave(onClose)} closeOnEsc={!confirming} trapFocus={!confirming} size="full" overlayClassName="!p-3 !overflow-hidden" className="!my-0 flex h-[calc(100dvh-24px)] !max-h-none !max-w-[1888px] flex-col gap-2.5 overflow-hidden !border-0 !bg-slate-900 !p-0 !text-slate-100">
    <div className="flex min-h-0 flex-1 flex-col gap-2.5" onKeyDown={(e) => {
      if (confirming || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="slider"]')) return;
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(position + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1)); }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); split(); }
    }}>
      <header className="flex h-11 shrink-0 items-center gap-2.5">
        <h2 className="mr-1 text-lg font-bold">動画</h2>
        <div className="flex rounded-lg border border-slate-700 bg-[#111827]">
          <Button variant="ghostOnDark" aria-pressed={state === 'active'} className={`min-h-11 !border-0 !px-3 text-sm ${state === 'active' ? '!bg-[#1a2333]' : '!text-slate-400'}`} onClick={() => void leave(() => onState('active'))}>素材</Button>
          <Button variant="ghostOnDark" aria-pressed={state === 'discarded'} className={`min-h-11 !border-0 !px-3 text-sm ${state === 'discarded' ? '!bg-[#1a2333]' : '!text-slate-400'}`} onClick={() => void leave(() => onState('discarded'))}>捨てた動画</Button>
        </div>
        <Input disabled={busy || edit.busy} aria-label="動画検索" placeholder="題名で探す" value={q} onChange={(e) => onSearch(e.target.value)} className="min-h-11 !w-[220px] !border !border-slate-700 !bg-[#111827] !text-slate-100" />
        <Button variant="ghostOnDark" className="ml-auto min-h-11 min-w-11 !px-0" aria-label="更新" disabled={busy || edit.busy || edit.pendingDismiss} onClick={() => { onRefresh(); setRefreshVersion((value) => value + 1); }}>↻</Button>
        <Button variant="ghostOnDark" className="min-h-11 min-w-11 !px-0" aria-label="閉じる" disabled={busy || edit.busy} onClick={() => void leave(onClose)}>✕</Button>
      </header>
      {error ? <p role="alert" className="shrink-0 text-sm text-red-300">{error}</p> : null}
      <div className={`grid min-h-0 flex-1 gap-2.5 ${autoEditDisabled ? 'grid-cols-[300px_minmax(0,1fr)]' : 'grid-cols-[300px_minmax(0,1fr)_420px]'}`}>
        <section aria-label="動画の棚" className="flex min-h-0 flex-col rounded-xl border border-slate-700 bg-[#111827]">
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {loading ? <p role="status" className="text-sm text-slate-400">読込中…</p> : !videos.length ? <p>動画がありません</p> : null}
            {videos.map((item) => {
              const [label, color] = aiLabel(item);
              const checked = concatVideos.some((v) => v.id === item.id);
              return <article key={item.id} className={`rounded-lg border ${video?.id === item.id ? 'border-amber-400 bg-[#1a2333]' : 'border-transparent'}`}>
                <button type="button" aria-label={item.title} aria-current={video?.id === item.id} disabled={busy || edit.busy} className="grid min-h-11 w-full grid-cols-[96px_minmax(0,1fr)] items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-slate-800 focus-visible:outline focus-visible:outline-amber-400" onClick={() => void leave(() => onSelect(item.id))}>
                  {item.hasPoster ? <ProcedureVideoThumbnail id={item.id} title={item.title} durationSeconds={item.durationSeconds} className="h-[54px] w-24" /> : <span className="flex h-[54px] w-24 items-center justify-center rounded bg-black text-xs text-slate-400">{item.status === 'READY' ? '画像なし' : item.status === 'FAILED' ? '失敗' : '処理中'}</span>}
                  <span className="min-w-0"><span className="line-clamp-2 text-sm font-medium">{item.title}</span><span className="block text-[11px] text-slate-400">{length(item.durationSeconds)}{item.status !== 'READY' ? ` · ${item.status === 'FAILED' ? `失敗: ${item.errorMessage || item.errorCode || '変換失敗'}` : '処理中'}` : ''}</span><span className={`flex items-center gap-1 text-xs ${autoEditDisabled ? 'text-slate-400' : color.split(' ')[1]}`}>{item.autoEdit && !autoEditDisabled ? <span className={`h-2 w-2 shrink-0 rounded-full ${color.split(' ')[0]}`} /> : null}{autoEditDisabled ? 'AI案なし' : label}</span></span>
                </button>
                <div className="flex items-center px-1.5 text-xs text-slate-400">
                  {item.status === 'READY' && !item.discardedAt ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" aria-label={`${item.title}を接続用に選択`} checked={checked} disabled={busy || edit.busy || (!checked && concatVideos.length >= 5)} onChange={(e) => onConcatSelect(item, e.target.checked)} className="h-5 w-5 accent-amber-400" />接続用</label> : null}
                  {item.origin === 'CONCAT' ? <span className="ml-auto rounded bg-blue-900 px-2 py-1 text-blue-100">接続</span> : null}
                </div>
              </article>;
            })}
          </div>
          <fieldset disabled={busy || edit.busy} className="min-w-0 shrink-0 border-t border-slate-700 p-2">{shelfActions}</fieldset>
        </section>
        <section aria-label="動画の編集台" className="flex min-h-0 min-w-0 flex-col gap-2.5 rounded-xl border border-slate-700 bg-[#111827] p-3">
          {video ? <>
            <div className="flex shrink-0 items-baseline gap-2"><h3 className="min-w-0 truncate text-[17px] font-bold">{video.title}</h3><span className="whitespace-nowrap font-mono text-[13px] text-slate-400">{length(video.durationSeconds)}</span></div>
            <div className="grid min-h-0 flex-1 justify-items-center [container-type:size]">
              {video.status === 'READY' ? <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] self-center overflow-hidden rounded-lg bg-black ring-1 ring-slate-700">
                <ProcedureVideoPlayer key={video.id} video={video} videoRef={player} controls={false} fitFrame comments={[]} onTimeUpdate={(element) => setPosition(element.currentTime)} onPlaybackChange={setPlaying} />
                {editable || applied ? <span className={`absolute left-3 top-3 rounded-full bg-slate-950/75 px-2.5 py-1 text-xs font-bold ${editable ? 'text-emerald-200' : 'text-blue-200'}`}>{editable ? 'AI案' : '採用済み'}</span> : null}
                {caption ? <div data-testid="video-caption" className="pointer-events-none absolute bottom-5 left-1/2 w-max max-w-[82%] -translate-x-1/2 rounded-lg bg-slate-950/80 px-4 py-2 text-center text-lg"><span className="line-clamp-3 whitespace-pre-wrap break-words">{editable ? <span className="block text-[11px] font-bold text-amber-400">字幕の案</span> : null}{caption}</span></div> : null}
              </div> : <p className="self-center text-sm text-slate-400">{video.status === 'FAILED' ? `失敗: ${video.errorMessage || video.errorCode || '変換失敗'}` : '処理中'}</p>}
            </div>
            {video.status === 'READY' ? <ProcedureVideoTimeline scenes={scenes} duration={duration} position={position} playing={playing} editable={editable} onSeek={seek} onChange={edit.changeDraft} onPlay={togglePlay} onSplit={split} /> : null}
            {video.errorCode === 'TRIM_FAILED' ? <p role="alert" className="text-sm text-red-300">トリミング失敗: {video.errorMessage}（元の動画を保持しています）</p> : null}
            <fieldset disabled={busy || edit.busy} className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-t border-slate-700 pt-2 text-xs"><span className="text-slate-400">紐づけ {video.linkCount}件</span>{videoActions(video)}</fieldset>
          </> : null}
          {autoEditDisabled && edit.error ? <p role="alert" className="text-sm text-red-300">{edit.error}</p> : null}
        </section>
        {!autoEditDisabled ? <ProcedureVideoAutoEditPanel edit={edit} position={position} canEdit={Boolean(canEdit)} onSeek={seek} /> : null}
      </div>
    </div>
    {edit.toast || splitMessage ? <div role="status" className="fixed bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-950 shadow-xl">{edit.toast || splitMessage}{edit.toast ? <Button variant="ghostOnDark" className="min-h-11 !bg-slate-950" onClick={edit.restore}>元に戻す</Button> : null}</div> : null}
    {confirmation}
  </Dialog>;
}
