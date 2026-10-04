import { useEffect, useState } from 'react';

import { getApiErrorMessage } from '../../api/errors';

import { KnowledgeFieldPicker } from './KnowledgeFieldPicker';
import {
  decideTriage, searchProcedureTopics,
  type ProcedureTopicView, type TriageDestination, type TriageSuggestionsView, type TriageView,
} from './knowledgeTriageApi';

export type KnowledgeTriageCardProps = {
  intakeId: string;
  text: string;
  files: { filename: string; kind: 'image' | 'pdf' }[];
  scannedPartNumber: string | null;
  header: string;
  state: TriageView['state'];
  suggestions: TriageSuggestionsView | null;
  /** The poster's tag from this session; without it the card only explains how to triage later. */
  tagUid: string | null;
  onDecided: (intakeId: string, title: string) => void;
  onLater?: (intakeId: string) => void;
};

type View = 'choose' | 'new' | 'search';
const button = 'h-11 max-w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-left disabled:opacity-50';

export function KnowledgeTriageCard(props: KnowledgeTriageCardProps) {
  const { intakeId, suggestions, tagUid } = props;
  const [view, setView] = useState<View>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (destination: TriageDestination, title: string) => {
    if (!tagUid || busy) return;
    setBusy(true); setError(null);
    try {
      await decideTriage(intakeId, tagUid, destination);
      props.onDecided(intakeId, title);
    } catch (failure) {
      setError(getApiErrorMessage(failure, '追加先を保存できませんでした。もう一度選んでください。'));
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900" aria-label="投稿の仕分け">
      <p className="text-xs text-slate-600">{props.header}</p>
      {props.text.trim() ? <p className="line-clamp-3 whitespace-pre-wrap break-words">{props.text}</p> : null}
      {props.files.length ? <p className="break-words text-xs text-slate-600">{props.files.map(file => file.filename).join('・')}</p> : null}
      {props.scannedPartNumber ? <p className="inline-block rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-800">品番 {props.scannedPartNumber}（バーコード）</p> : null}
      {!tagUid ? <p className="text-slate-700">仕分けるには、投稿した人が社員タグをかざしてください。</p>
        : view === 'new' ? <NewTopicForm suggestions={suggestions} scannedPartNumber={props.scannedPartNumber} busy={busy}
          onBack={() => setView('choose')} onSubmit={(topic, title) => void decide({ newTopic: topic }, title)} />
          : view === 'search' ? <TopicSearch busy={busy} onBack={() => setView('choose')} onPick={topic => void decide({ procedureId: topic.procedureId }, topic.title)} />
            : <Choices {...props} busy={busy} onPick={(procedureId, title) => void decide({ procedureId }, title)} onNew={() => setView('new')} onSearch={() => setView('search')} />}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </section>
  );
}

function Choices(props: KnowledgeTriageCardProps & { busy: boolean; onPick: (procedureId: string, title: string) => void; onNew: () => void; onSearch: () => void }) {
  const { suggestions, state, busy } = props;
  return (
    <div className="space-y-2" role="group" aria-label="追加先">
      <p className="font-semibold">どの案件に追加しますか？</p>
      {state === 'suggesting' ? <p role="status" className="text-slate-600">AIが候補を考えています。先に探すこともできます。</p> : null}
      {suggestions?.candidates.map((candidate, index) => (
        <button key={candidate.procedureId} type="button" disabled={busy} className={button} onClick={() => props.onPick(candidate.procedureId, candidate.title)}>
          <span className="block font-semibold">{candidate.title}{index === 0 ? <span className="ml-1.5 rounded bg-violet-100 px-1.5 text-[11px] text-violet-700">AIのおすすめ</span> : null}</span>
          {candidate.reason ? <span className="block text-xs text-slate-600">{candidate.reason}</span> : null}
        </button>
      ))}
      <button type="button" disabled={busy} className={button} onClick={props.onNew}>
        <span className="block font-semibold">＋ 新しい案件として追加</span>
        {suggestions?.proposal ? <span className="block text-xs text-slate-600">AIの案：{suggestions.proposal.title}</span> : null}
      </button>
      <div className="flex justify-between gap-2">
        <button type="button" disabled={busy} className="rounded-lg border border-slate-400 bg-white px-3 py-2" onClick={props.onSearch}>🔍 他の案件を探す</button>
        {props.onLater ? <button type="button" disabled={busy} className="rounded-lg border border-slate-400 bg-white px-3 py-2" onClick={() => props.onLater?.(props.intakeId)}>あとで仕分ける</button> : null}
      </div>
    </div>
  );
}

function NewTopicForm({ suggestions, scannedPartNumber, busy, onBack, onSubmit }: {
  suggestions: TriageSuggestionsView | null; scannedPartNumber: string | null; busy: boolean; onBack: () => void;
  onSubmit: (topic: Extract<TriageDestination, { newTopic: unknown }>['newTopic'], title: string) => void;
}) {
  const proposal = suggestions?.proposal;
  const [target, setTarget] = useState(proposal?.parts.target ?? '');
  const [workType, setWorkType] = useState(proposal?.parts.workType ?? '');
  const [detail, setDetail] = useState(proposal?.parts.detail ?? '');
  const title = [target.trim(), workType, detail.trim()].filter(Boolean).join('｜');
  const partNumber = proposal?.identifiers.partNumber ?? scannedPartNumber ?? undefined;
  return (
    <form className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" onSubmit={event => {
      event.preventDefault();
      if (target.trim() && workType) onSubmit({ target: target.trim(), workType, ...(detail.trim() ? { detail: detail.trim() } : {}), ...(partNumber ? { partNumber } : {}) }, title);
    }}>
      <p className="font-semibold">新しい案件{proposal ? <span className="ml-1.5 rounded bg-violet-100 px-1.5 text-[11px] text-violet-700">AIの案を修正できます</span> : null}</p>
      <label className="flex flex-col items-start gap-1 text-xs text-slate-600">対象（品番・部品名、または事柄）
        <input value={target} onChange={event => setTarget(event.target.value)} maxLength={80} required className="h-11 w-52 max-w-full rounded border border-slate-300 px-2 text-sm text-slate-900" />
      </label>
      <KnowledgeFieldPicker requiresApproval={Boolean(partNumber || proposal?.reviewTier === 'approval_required')} value={workType} disabled={busy} onChange={name => setWorkType(name)} />
      <label className="flex flex-col items-start gap-1 text-xs text-slate-600">補足（任意）
        <input value={detail} onChange={event => setDetail(event.target.value)} maxLength={40} className="h-11 w-52 max-w-full rounded border border-slate-300 px-2 text-sm text-slate-900" />
      </label>
      <p className="rounded border border-dashed border-slate-400 bg-white px-2 py-1.5">タイトル：{title || '（対象と作業の種類を入れてください）'}</p>
      <div className="flex justify-between gap-2">
        <button type="button" onClick={onBack} disabled={busy} className="rounded-lg border border-slate-400 bg-white px-3 py-2">戻る</button>
        <button type="submit" disabled={busy || !target.trim() || !workType} className="rounded-lg bg-blue-700 px-3 py-2 text-white disabled:opacity-50">この案件を作って追加</button>
      </div>
    </form>
  );
}

function TopicSearch({ busy, onBack, onPick }: { busy: boolean; onBack: () => void; onPick: (topic: ProcedureTopicView) => void }) {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<ProcedureTopicView[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchProcedureTopics(query, controller.signal).then(found => { if (!controller.signal.aborted) setTopics(found); }).catch(() => undefined);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const groups = new Map<string, ProcedureTopicView[]>();
  for (const topic of topics ?? []) {
    const key = topic.parts?.target ?? 'そのほか';
    groups.set(key, [...(groups.get(key) ?? []), topic]);
  }
  return (
    <div className="space-y-2">
      <input value={query} onChange={event => setQuery(event.target.value)} aria-label="案件を探す" placeholder="品番・部品名・作業で探す"
        className="w-full rounded-lg border border-slate-300 px-2 py-2" />
      {topics && !topics.length ? <p className="text-slate-600">見つかりません。新しい案件として追加できます。</p> : null}
      {[...groups].map(([target, list]) => (
        <div key={target} className="space-y-1.5">
          <p className="text-xs text-slate-600">{target}（{list.length}件）</p>
          {list.map(topic => <button key={topic.procedureId} type="button" disabled={busy} className={button} onClick={() => onPick(topic)}>{topic.title}</button>)}
        </div>
      ))}
      <button type="button" onClick={onBack} disabled={busy} className="rounded-lg border border-slate-400 bg-white px-3 py-2">戻る</button>
    </div>
  );
}
