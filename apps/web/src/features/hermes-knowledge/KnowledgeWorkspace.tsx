import { useState } from 'react';

import { knowledgeProcedureImagePath } from './knowledgeProcedureApi';
import { KnowledgeProcedureView } from './KnowledgeProcedureView';
import { knowledgeReviewImagePath } from './knowledgeReviewApi';

import type { KnowledgeWorkspaceState } from './useKnowledgeWorkspace';

const button = 'h-11 shrink-0 rounded-lg border px-3 text-sm disabled:opacity-40';
const date = (iso: string) => new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });

export function KnowledgeWorkspaceChips({ workspace }: { workspace: KnowledgeWorkspaceState }) {
  return <>
    {workspace.reviews !== null ? <button type="button" onClick={workspace.showReviews}
      className={`h-11 rounded-full border px-3 text-sm ${workspace.reviews.length ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      ✅ 承認待ち {workspace.reviews.length}
    </button> : null}
    <button type="button" onClick={workspace.showProcedures} className="h-11 rounded-full border border-blue-300 bg-blue-50 px-3 text-sm text-blue-800">📖 手順書</button>
    {workspace.notice ? <span role="status" className="text-sm text-red-700">{workspace.notice}</span> : null}
  </>;
}

function CommentForm({ kind, busy, posterName, onCancel, onSubmit }: {
  kind: 'return' | 'report'; busy: boolean; posterName: string | null; onCancel: () => void; onSubmit: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const label = kind === 'return' ? '差し戻しの理由' : 'どこが違うか';
  return <form className="space-y-2" onSubmit={event => { event.preventDefault(); onSubmit(comment); }}>
    {kind === 'report' ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>📶 社員タグ</span>
      {posterName ? <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-green-800">👤 {posterName}</span> : null}
    </div> : null}
    <textarea aria-label={label} placeholder={label} required maxLength={500} value={comment} onChange={event => setComment(event.target.value)}
      disabled={busy} rows={3} className="block max-w-full rounded-lg border border-slate-300 p-2 text-sm" cols={36} />
    <div className="flex gap-2">
      <button type="button" className={`${button} border-slate-300 bg-white`} disabled={busy} onClick={onCancel}>やめる</button>
      <button type="submit" disabled={busy || !comment.trim() || !posterName}
        className={`${button} ${kind === 'return' ? 'border-red-300 text-red-700' : 'border-blue-700 bg-blue-700 text-white'}`}>
        {kind === 'return' ? '差し戻す' : '報告する'}
      </button>
    </div>
  </form>;
}

export function KnowledgeWorkspace({ workspace: w, posterName }: { workspace: KnowledgeWorkspaceState; posterName: string | null }) {
  const reviewing = w.view === 'review' || w.view === 'return';
  const reading = w.view === 'read' || w.view === 'report';
  return <div className="flex min-h-0 flex-1 flex-col break-words text-slate-900" aria-label="ナレッジ画面">
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {w.notice ? <p role="status" className="mb-2 text-sm text-red-700">{w.notice}</p> : null}
      {w.busy ? <p role="status" className="mb-2 text-sm text-slate-600">読み込み中…</p> : null}
      {w.view === 'reviews' ? <>
        <div className="mb-2 flex items-center justify-between gap-2"><strong>承認待ち {w.reviews?.length ?? 0}件</strong>
          <button type="button" className={`${button} border-slate-300 bg-white`} disabled={w.busy} onClick={() => w.navigate('home')}>戻る</button></div>
        <div className="space-y-2">{w.reviews?.map(item => <button key={item.revisionId} type="button" disabled={w.busy} onClick={() => w.openReview(item.revisionId)}
          className="block max-w-full rounded-lg border border-slate-200 p-2.5 text-left disabled:opacity-40">
          <span className="block break-words text-sm font-semibold">{item.title}</span>
          <span className="text-xs text-slate-600">{item.stepCount}手順・{date(item.createdAt)} </span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${item.reportComment !== null ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
            {item.reportComment !== null ? `誤り報告: ${item.reportComment}` : item.publishedRevisionNumber !== null ? `改版 ${item.publishedRevisionNumber}→${item.revisionNumber}` : '新規'}
          </span>
        </button>)}</div>
      </> : null}
      {w.view === 'procedures' ? <>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input aria-label="名前・品番・図番" placeholder="🔍 名前・品番" value={w.query} onChange={event => w.setQuery(event.target.value)}
            className="h-11 w-52 max-w-full rounded-lg border border-slate-300 px-2 text-sm" />
          <button type="button" className={`${button} border-slate-300 bg-white`} disabled={w.busy} onClick={() => w.navigate('home')}>戻る</button>
        </div>
        <div className="space-y-2">{w.procedures.map(item => <button key={item.procedureId} type="button" disabled={w.busy} onClick={() => w.openProcedure(item.procedureId)}
          className="block max-w-full rounded-lg border border-slate-200 p-2.5 text-left disabled:opacity-40">
          <span className="block break-words text-sm font-semibold">{item.title}</span>
          <span className="text-xs text-slate-600">{[item.identifiers.partNumber, item.identifiers.drawingNumber].filter(Boolean).join('・')} {date(item.publishedAt)} 公開 </span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${item.reviewTier === 'auto_publish' ? 'bg-violet-100 text-violet-700' : 'bg-green-100 text-green-700'}`}>
            {item.reviewTier === 'auto_publish' ? 'AI作成' : '承認済み'}
          </span>
        </button>)}</div>
      </> : null}
      {(reviewing || reading) && w.procedure ? <>
        {reading ? <button type="button" className={`${button} mb-2 border-slate-300 bg-white`} disabled={w.busy} onClick={() => w.navigate('procedures')}>戻る</button> : null}
        <KnowledgeProcedureView key={w.procedure.revisionId} procedure={w.procedure} singleStep={reading}
          imagePathFor={imageId => reviewing ? knowledgeReviewImagePath(w.procedure!.revisionId, imageId) : knowledgeProcedureImagePath(w.procedure!.procedureId, imageId)}
          onReportError={w.view === 'read' ? () => w.navigate('report') : undefined} />
      </> : null}
    </div>
    {w.view === 'review' ? <div className="flex flex-wrap gap-2 border-t border-slate-200 p-3">
      <button type="button" className={`${button} border-slate-300 bg-white`} disabled={w.busy} onClick={() => w.navigate('reviews')}>戻る</button>
      <button type="button" className={`${button} border-red-300 text-red-700`} disabled={w.busy} onClick={() => w.navigate('return')}>差し戻し</button>
      <button type="button" className={`${button} border-green-700 bg-green-700 text-white`} disabled={w.busy} onClick={w.approve}>承認して公開</button>
    </div> : null}
    {w.view === 'return' || w.view === 'report' ? <div className="border-t border-slate-200 p-3">
      <CommentForm key={`${w.view}:${w.procedure?.revisionId}`} kind={w.view} busy={w.busy} posterName={posterName}
        onCancel={() => w.navigate(w.view === 'return' ? 'review' : 'read')} onSubmit={w.view === 'return' ? w.returnReview : w.reportError} />
    </div> : null}
  </div>;
}
