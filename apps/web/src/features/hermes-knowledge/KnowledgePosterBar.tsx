import { KnowledgeTriageCard } from './KnowledgeTriageCard';


import type { PendingTriageItem } from './knowledgeTriageApi';
import type { KnowledgePoster } from './useKnowledgePoster';
import type { ReactNode } from 'react';

export type KnowledgePosterBarProps = {
  poster: KnowledgePoster | null;
  actions?: ReactNode;
  verifying: boolean;
  error: string | null;
  partNumber: string | null;
  pending: PendingTriageItem[];
  onClearPartNumber: () => void;
  onPendingDecided: (intakeId: string, title: string) => void;
};

const when = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Poster identification before each post, plus the poster's undecided earlier posts. */
export function KnowledgePosterBar(props: KnowledgePosterBarProps) {
  const { poster, pending } = props;
  if (!poster) {
    return (
      <><div className="m-3 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 px-3 py-4 text-center" role="status">
        <p className="text-3xl" aria-hidden="true">🪪</p>
        <p className="mt-1 font-semibold">{props.verifying ? '社員タグを確認しています…' : '社員タグをかざしてください'}</p>
        {props.error ? <p role="alert" className="mt-2 text-sm text-red-700">{props.error}</p> : null}
      </div><div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">{props.actions}</div></>
    );
  }
  return (
    <div className="space-y-2 border-b border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-green-800">👤 {poster.name}</span>
        {props.actions}
        {props.partNumber ? <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-blue-800">品番 {props.partNumber}
          <button type="button" aria-label="品番を外す" onClick={props.onClearPartNumber} className="px-1">✕</button></span> : null}
      </div>
      {pending.length ? (
        <div className="space-y-2">
          <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-amber-900">仕分けが済んでいない投稿が <strong>{pending.length}件</strong> あります</p>
          {pending.map(item => (
            <KnowledgeTriageCard key={item.intakeId} intakeId={item.intakeId} text={item.text} files={item.files} scannedPartNumber={item.scannedPartNumber}
              header={`${when(item.createdAt)} の投稿`} state={item.state} suggestions={item.suggestions} tagUid={poster.tagUid}
              onDecided={props.onPendingDecided} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
