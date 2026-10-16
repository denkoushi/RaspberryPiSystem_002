import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import { sceneColors } from './procedure-video-timeline';

import type { useProcedureVideoAutoEdit } from './useProcedureVideoAutoEdit';

export function ProcedureVideoAutoEditPanel({ edit, position, canEdit, onSeek }: {
  edit: ReturnType<typeof useProcedureVideoAutoEdit>; position: number; canEdit: boolean; onSeek: (seconds: number, play?: boolean) => void;
}) {
  const { row, draft, busy, loading, dismissed, error } = edit;
  const ready = row?.status === 'READY' && !row.decision && !dismissed;
  const applied = row?.decision === 'APPLIED';
  const running = row?.status === 'PENDING' || row?.status === 'RUNNING';
  const failed = row?.status === 'FAILED' || row?.status === 'SKIPPED';
  const rejected = dismissed || row?.decision === 'DISMISSED';
  return <aside aria-label="AI案" className="flex min-h-0 flex-col rounded-xl border border-slate-700 bg-[#111827]">
    {ready || applied ? <div className="flex min-h-[52px] shrink-0 items-center gap-2 px-3">
      <h3 className="text-[15px] font-bold">{applied ? '字幕' : 'AIが分けた場面'}</h3>
      <span className="font-mono text-xs text-slate-400">{applied ? `${edit.comments.length}件` : `${draft.length}/5`}</span>
      {ready ? <Button variant="ghostOnDark" className="ml-auto min-h-11 !border-0 !px-2 text-sm" disabled={busy || loading || !canEdit} onClick={() => void edit.regenerate()}>↻ 作り直す</Button> : null}
    </div> : null}
    {ready ? <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto px-2 pb-2">{draft.map((scene, index) => <div key={index} className={`grid grid-cols-[4px_minmax(0,1fr)_44px] gap-2 rounded-lg border px-2 py-0.5 ${position >= scene.startSeconds && position < scene.endSeconds ? 'border-amber-400' : 'border-transparent'} bg-[#1a2333]`}>
      <span className="rounded" style={{ backgroundColor: sceneColors[index] }} />
      <div className="min-w-0">
        <div className="flex h-4 items-center gap-2 font-mono text-xs text-slate-400">{scene.startSeconds.toFixed(1)}–{scene.endSeconds.toFixed(1)}s {scene.needsReview ? <span className="rounded bg-[#3a2a0c] px-1 font-sans text-[11px] font-bold text-[#ffd27a]">要確認</span> : null}</div>
        <Input aria-label={`場面${index + 1}の名前`} placeholder="場面の名前" maxLength={20} value={scene.title} disabled={busy || loading || !canEdit} className="min-h-11 !rounded-none !border-0 !border-b !border-slate-700 !bg-transparent !px-0 !py-1 !text-[15px] font-bold !text-slate-100 focus:!border-amber-400" onChange={(e) => edit.changeDraft(draft.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} />
        <Input aria-label={`場面${index + 1}の字幕`} placeholder="字幕" maxLength={80} value={scene.caption} disabled={busy || loading || !canEdit} className="min-h-11 !rounded-none !border-0 !border-b !border-slate-700 !bg-transparent !px-0 !py-1 !text-sm !text-slate-200 focus:!border-amber-400" onChange={(e) => edit.changeDraft(draft.map((item, i) => i === index ? { ...item, caption: e.target.value } : item))} />
      </div>
      <div className="flex flex-col justify-center gap-1">
        <Button variant="ghostOnDark" className="min-h-11 !px-0" aria-label={`場面${index + 1}から再生`} onClick={() => onSeek(scene.startSeconds, true)}>▶</Button>
        {draft.length > 1 ? <Button variant="ghostOnDark" className="min-h-11 !px-0" aria-label={`場面${index + 1}をとなりとまとめる`} title="となりとまとめる" disabled={busy || loading || !canEdit} onClick={() => edit.merge(index)}>⇤</Button> : null}
      </div>
    </div>)}</div> : applied ? <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">{edit.comments.map((comment, index) => <div key={index} className={`flex items-center gap-3 rounded-lg border p-3 ${position >= comment.atSeconds && position < comment.atSeconds + 4 ? 'border-amber-400' : 'border-transparent'} bg-[#1a2333]`}>
      <span className="w-1 self-stretch rounded" style={{ backgroundColor: sceneColors[index] }} />
      <div className="min-w-0 flex-1 break-words text-sm"><span className="font-mono text-xs text-slate-400">{comment.atSeconds.toFixed(1)}s</span><b className="block">{row.confirmed?.scenes.find((scene) => scene.startSeconds === comment.atSeconds)?.title}</b>{comment.text}</div>
      <Button variant="ghostOnDark" className="min-h-11 min-w-11 !px-0" aria-label={`字幕${index + 1}から再生`} onClick={() => onSeek(comment.atSeconds, true)}>▶</Button>
    </div>)}</div> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-bold" role="status">{loading ? '読込中…' : rejected ? '使わないにしました' : running ? 'AI案を作成中' : failed ? 'AI案を作れませんでした' : 'AI案はまだありません'}</p>
      {!loading && !running ? <Button variant="ghostOnDark" className="min-h-11" disabled={busy || edit.pendingDismiss || !canEdit} onClick={() => void edit.regenerate()}>{rejected || failed ? '作り直す' : 'AI案を作る'}</Button> : null}
    </div>}
    {error || (!loading && failed && row.errorMessage) ? <p role="alert" className="shrink-0 px-3 py-1 text-sm text-red-300">{error || row?.errorMessage}</p> : null}
    {ready ? <div className="shrink-0 space-y-2 border-t border-slate-700 p-2">
      {edit.armed && edit.comments.length ? <p className="rounded-lg bg-[#3a2a0c] px-2 py-1 text-[13px] text-[#ffd27a]">今のコメント{edit.comments.length}件を、この字幕に置き換えます</p> : null}
      {/* Leave room for the floating Hermes button fixed at the bottom-right corner. */}
      <div className="flex items-center justify-between gap-2 pr-16"><Button variant="ghostOnDark" className="min-h-11" disabled={busy || loading || !canEdit} onClick={edit.dismiss}>使わない</Button><Button className="min-h-11 !bg-[#22c08a] !text-[#04140d]" disabled={busy || loading || !canEdit || !edit.commentsLoaded || !draft.length} onClick={() => void edit.apply()}>{edit.armed && edit.comments.length ? '置き換えて採用' : '採用'}</Button></div>
    </div> : null}
  </aside>;
}
