import { useState } from 'react';

import { KnowledgeReportDialog } from './KnowledgeReportDialog';
import { KnowledgeTriageCard } from './KnowledgeTriageCard';

import type { KnowledgeIntakeView } from './useKnowledgeIntake';
import type { KnowledgeReport } from '@raspi-system/shared-types';

export type KnowledgeTriageControls = {
  tagFor: (intakeId: string) => string | null;
  decided: Record<string, string>;
  later: string[];
  onDecided: (intakeId: string, title: string) => void;
  onLater: (intakeId: string) => void;
};

function TriageFor({ item, triage }: { item: KnowledgeIntakeView; triage: KnowledgeTriageControls }) {
  const title = triage.decided[item.id];
  if (title) return <p role="status" className="mt-2 rounded bg-green-50 px-2 py-1.5 text-green-800">「{title}」に追加しました。手順書を作り直しています。</p>;
  if (!item.triage) return null;
  if (item.triage.state === 'decided') return null;
  if (triage.later.includes(item.id)) return <p className="mt-2 text-slate-600">あとで仕分けます。次に社員タグをかざしたときにお知らせします。</p>;
  return <div className="mt-2"><KnowledgeTriageCard intakeId={item.id} text="" files={[]} scannedPartNumber={item.scannedPartNumber ?? null}
    header={item.posterName ? `${item.posterName}さんの投稿` : '投稿'} state={item.triage.state} suggestions={item.triage.suggestions}
    tagUid={triage.tagFor(item.id)} onDecided={triage.onDecided} onLater={triage.onLater} /></div>;
}

export function KnowledgeIntakePanel({ items, error, busy, onChoose, onDelegate, triage }: {
  items: KnowledgeIntakeView[]; error: string | null; busy: boolean;
  onChoose: (item: KnowledgeIntakeView, action: string) => void; onDelegate: (text: string) => void;
  triage?: KnowledgeTriageControls;
}) {
  const [report, setReport] = useState<KnowledgeReport | null>(null);
  return <>
    {(items.length > 0 || error) && <div className="max-h-[60%] space-y-3 overflow-y-auto border-b border-slate-200 p-3" aria-label="記録と資料の処理状況">
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {items.map(item => <div key={item.id} className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-900">
        <p className="whitespace-pre-wrap break-words">{item.text}</p>
        {item.files.length ? <p className="break-words text-xs text-slate-600">{item.files.map(file => file.filename).join('・')}</p> : null}
        <p className="mt-2 whitespace-pre-wrap" role={['working', 'pending'].includes(item.state) ? 'status' : undefined}>
          {item.state === 'failed' ? '整理に失敗しました。元の入力は保存されています。添付内容を確認し、再処理または修正して再送してください。'
            : item.state === 'superseded' ? 'この確認は古くなりました。最新の入力から選択してください。'
              : item.triage?.state === 'decided' ? '追加しました' : ['pending', 'working'].includes(item.state) ? (item.errorCode ? '処理待ちです。入力は保存済みで、自動的に再試行します。' : '内容を確認・整理しています。画面を閉じても処理は続きます。') : item.message}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {item.choices.map(choice => <button key={choice.id} type="button" disabled={busy} onClick={() => onChoose(item, choice.id)} className="rounded border border-slate-400 px-3 py-2 disabled:opacity-50">{choice.label}</button>)}
          {item.state === 'failed' ? <button type="button" disabled={busy} onClick={() => onChoose(item, 'retry')} className="rounded border border-slate-400 px-3 py-2">再処理する</button> : null}
          {item.report ? <button type="button" onClick={() => setReport(item.report!)} className="rounded bg-blue-700 px-3 py-2 text-white">写真付きレポートを見る</button> : null}
          {item.state === 'delegated' && item.text.trim() ? <button type="button" disabled={busy} onClick={() => onDelegate(item.text)} className="rounded border border-slate-400 px-3 py-2">通常の相談で続ける</button> : null}
        </div>
        {triage ? <TriageFor item={item} triage={triage} /> : null}
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
    <p className="mt-1 text-xs">写真4枚まで（各10 MB）／PDF1件（20 MB・20ページまで）。</p>
    {files.length ? <div className="mt-2"><p className="break-words">{files.map(file => file.name).join('・')}</p>
      <button type="button" disabled={disabled} onClick={onSend} className="mr-3 rounded bg-blue-700 px-3 py-2 text-white">添付を送信</button>
      <button type="button" disabled={disabled} onClick={() => onChange([])} className="underline">添付を取り消す</button>
    </div> : null}
  </div>;
}
