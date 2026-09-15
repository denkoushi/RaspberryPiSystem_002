import { useState } from 'react';

import { KnowledgeReportDialog } from './KnowledgeReportDialog';

import type { KnowledgeIntakeView } from './useKnowledgeIntake';
import type { KnowledgeReport } from '@raspi-system/shared-types';

export function KnowledgeIntakePanel({ items, error, busy, onChoose, onDelegate }: {
  items: KnowledgeIntakeView[]; error: string | null; busy: boolean;
  onChoose: (item: KnowledgeIntakeView, action: string) => void; onDelegate: (text: string) => void;
}) {
  const [report, setReport] = useState<KnowledgeReport | null>(null);
  return <>
    {(items.length > 0 || error) && <div className="max-h-64 space-y-3 overflow-y-auto border-b border-slate-200 p-3" aria-label="記録と資料の処理状況">
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {items.map(item => <div key={item.id} className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-900">
        <p className="whitespace-pre-wrap break-words">{item.text}</p>
        {item.files.length ? <p className="break-words text-xs text-slate-600">{item.files.map(file => file.filename).join('・')}</p> : null}
        <p className="mt-2 whitespace-pre-wrap" role={['working', 'pending'].includes(item.state) ? 'status' : undefined}>
          {item.state === 'failed' ? '整理に失敗しました。元の入力は保存されています。添付内容を確認し、再処理または修正して再送してください。'
            : item.state === 'superseded' ? 'この確認は古くなりました。最新の入力から選択してください。'
              : ['pending', 'working'].includes(item.state) ? (item.errorCode ? '処理待ちです。入力は保存済みで、自動的に再試行します。' : '内容を確認・整理しています。画面を閉じても処理は続きます。') : item.message}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {item.choices.map(choice => <button key={choice.id} type="button" disabled={busy} onClick={() => onChoose(item, choice.id)} className="rounded border border-slate-400 px-3 py-2 disabled:opacity-50">{choice.label}</button>)}
          {item.state === 'failed' ? <button type="button" disabled={busy} onClick={() => onChoose(item, 'retry')} className="rounded border border-slate-400 px-3 py-2">再処理する</button> : null}
          {item.report ? <button type="button" onClick={() => setReport(item.report!)} className="rounded bg-blue-700 px-3 py-2 text-white">写真付きレポートを見る</button> : null}
          {item.state === 'delegated' && item.text.trim() ? <button type="button" disabled={busy} onClick={() => onDelegate(item.text)} className="rounded border border-slate-400 px-3 py-2">通常の相談で続ける</button> : null}
        </div>
      </div>)}
    </div>}
    {report ? <KnowledgeReportDialog report={report} isOpen onClose={() => setReport(null)} imagePathFor={(source, image) => `/api/hermes-knowledge/sources/${encodeURIComponent(source)}/images/${encodeURIComponent(image)}`} /> : null}
  </>;
}

export function KnowledgeAttachments({ files, onChange, disabled, onSend }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean; onSend: () => void }) {
  return <div className="border-t border-slate-200 px-3 py-2 text-sm text-slate-700">
    <label className="block">写真・PDFを添付
      <input aria-label="写真・PDFを添付" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={disabled}
        onChange={event => { onChange(Array.from(event.target.files ?? [])); event.target.value = ''; }} className="mt-1 block w-full text-xs" />
    </label>
    <p className="mt-1 text-xs">写真4枚まで（各10 MB）／PDF1件（20 MB・20ページまで）。試行中の記録は合計20件／ページまで。</p>
    {files.length ? <div className="mt-2"><p className="break-words">{files.map(file => file.name).join('・')}</p>
      <button type="button" disabled={disabled} onClick={onSend} className="mr-3 rounded bg-blue-700 px-3 py-2 text-white">添付を送信</button>
      <button type="button" disabled={disabled} onClick={() => onChange([])} className="underline">添付を取り消す</button>
    </div> : null}
  </div>;
}
