import { useState } from 'react';

import { KnowledgeFieldPicker } from './KnowledgeFieldPicker';

import type { KnowledgeDestinationState } from './useKnowledgeDestination';

const button = 'h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:opacity-40';

export function KnowledgeDestinationChip({ destination: d }: { destination: KnowledgeDestinationState }) {
  if (!d.title && !d.target) return null;
  return <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-sm ${d.ready && !d.destination ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-blue-300 bg-blue-50 text-blue-800'}`}>
    <span className="break-words">{d.title ?? d.target}</span><button type="button" aria-label="行き先を選び直す" className="px-1" onClick={d.reset}>✕</button>
  </span>;
}

function NewDestination({ destination: d, partNumber }: { destination: KnowledgeDestinationState; partNumber: string | null }) {
  const [target, setTarget] = useState(d.target);
  const [workType, setWorkType] = useState('');
  const [detail, setDetail] = useState('');
  return <form className="space-y-2" onSubmit={event => {
    event.preventDefault(); if (!workType || !target.trim()) return;
    const newTopic = { target: target.trim(), workType, ...(detail.trim() ? { detail: detail.trim() } : {}), ...d.identifiers, ...(partNumber ? { partNumber } : {}) };
    d.choose({ newTopic }, [target.trim(), workType, detail.trim()].filter(Boolean).join('｜'));
  }}>
    {!d.target ? <input aria-label="対象" placeholder="品番・設備・事柄" maxLength={80} value={target} onChange={event => setTarget(event.target.value)}
      className="h-11 w-52 max-w-full rounded-lg border border-slate-300 px-2 text-sm" /> : null}
    <KnowledgeFieldPicker requiresApproval={Boolean(partNumber || d.identifiers.partNumber || d.identifiers.drawingNumber)} value={workType} onChange={name => setWorkType(name)} />
    <div className="flex flex-wrap items-center gap-1.5">
      <input aria-label="補足(任意)" placeholder="補足(任意)" value={detail} maxLength={40} onChange={event => setDetail(event.target.value)}
        className="h-11 w-44 max-w-full rounded-lg border border-slate-300 px-2 text-sm" />
      <button type="submit" disabled={!workType || !target.trim()} className={`${button} border-blue-700 bg-blue-700 text-white`}>決定</button>
    </div>
  </form>;
}

export function KnowledgeDestinationPicker({ destination: d, partNumber, onScan }: {
  destination: KnowledgeDestinationState; partNumber: string | null; onScan: () => void;
}) {
  const [page, setPage] = useState(0);
  if (d.ready) return null;
  const candidates = d.query.trim() ? d.subjects : [...d.recent, ...d.subjects.filter(subject => !d.recent.some(recent => recent.target === subject.target))];
  const rows = d.view === 'subjects' ? candidates : d.topics;
  return <section className="space-y-2 border-b border-slate-200 px-3 py-2 text-slate-900" aria-label="行き先">
    {d.view === 'subjects' ? <>
      <div className="flex flex-wrap items-center gap-1.5">
        <input aria-label="品番・設備・事柄" placeholder="🔍 品番・設備・事柄" maxLength={80} value={d.query} onChange={event => { d.setQuery(event.target.value); setPage(0); }}
          className="h-11 w-52 max-w-full rounded-lg border border-slate-300 px-2 text-sm" />
        <button type="button" className={button} onClick={onScan}>▮▯ 読取</button>
      </div>
      <p className="text-xs text-slate-600">この画面・最近</p>
      <div className="flex flex-wrap gap-1.5">
        {d.contextTarget ? <button type="button" className={button} onClick={() => { d.chooseSubject(d.contextTarget!); setPage(0); }}>{d.contextTarget}</button> : null}
        {candidates.slice(page * 6, page * 6 + 6).map(subject => <button type="button" key={subject.target} className={button} onClick={() => { d.chooseSubject(subject.target); setPage(0); }}>
          {subject.target}<small className="ml-1 text-slate-500">{subject.topicCount}</small>
        </button>)}
        <button type="button" className={`${button} border-dashed border-blue-300 text-blue-800`} onClick={d.newSubject}>＋ 新しい対象</button>
        <button type="button" className={`${button} border-violet-300 bg-violet-50 text-violet-800`} onClick={() => d.choose(undefined, 'おまかせ')}>おまかせ</button>
      </div>
    </> : d.view === 'topics' ? <>
      <input aria-label="案件を絞る" placeholder="🔍 案件" value={d.topicQuery} onChange={event => { d.setTopicQuery(event.target.value); setPage(0); }}
        className="h-11 w-44 max-w-full rounded-lg border border-slate-300 px-2 text-sm" />
      <div className="flex flex-wrap gap-1.5">{d.topics.slice(page * 6, page * 6 + 6).map(topic => <button type="button" key={topic.procedureId} className={button}
        onClick={() => d.choose({ procedureId: topic.procedureId }, topic.title)}>{topic.parts ? [topic.parts.workType, topic.parts.detail].filter(Boolean).join('｜') : topic.title}</button>)}
        <button type="button" className={`${button} border-dashed border-blue-300 text-blue-800`} onClick={d.newTopic}>＋ 新しい案件</button>
      </div>
      {d.loading ? <p role="status" className="text-xs text-slate-600">読み込み中…</p> : null}
    </> : <NewDestination key={d.target} destination={d} partNumber={partNumber} />}
    {d.view !== 'new' && rows.length > 6 ? <div className="flex gap-1.5">
      <button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>前</button>
      <button type="button" className={button} disabled={(page + 1) * 6 >= rows.length} onClick={() => setPage(page + 1)}>次</button>
    </div> : null}
    {d.error ? <p role="alert" className="text-sm text-red-700">{d.error}</p> : null}
  </section>;
}
