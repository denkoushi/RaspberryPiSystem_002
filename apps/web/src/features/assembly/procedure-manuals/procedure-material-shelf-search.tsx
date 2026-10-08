import { isAxiosError } from 'axios';
import { useEffect, useMemo, useState } from 'react';

import { listProcedureKnowledgeCandidates, listProcedureMaterials, listProcedureWorkInstructionCandidates } from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { materialSource } from './procedure-material-grouping';

import type { ProcedureKnowledgeCandidate, ProcedureKnowledgeCandidatesResult, ProcedureMaterialDto, ProcedureMaterialState, ProcedureWorkInstructionCandidate, ProcedureWorkInstructionCandidatesResult } from './procedure-material-types';

export type ShelfTab = ProcedureMaterialState | 'knowledge' | 'workInstruction';
export const shelfTabs = [['unplaced', '未配置'], ['placed', '配置済み'], ['knowledge', 'ナレッジから'], ['workInstruction', '加工の写真']] as const;
type ShelfData = { materials?: ProcedureMaterialDto[]; knowledge?: ProcedureKnowledgeCandidatesResult; workInstructions?: ProcedureWorkInstructionCandidatesResult };
type ShelfEntry = { data?: ShelfData; error?: string; promise: Promise<void> };
export type ShelfFilters = { sources: string[]; kinds: string[]; days: number | null };
export const emptyShelfFilters: ShelfFilters = { sources: [], kinds: [], days: null };
export const normalizeShelfQuery = (value: string) => value.normalize('NFKC').toLowerCase().trim();

export function ShelfHighlight({ text, query }: { text: string; query: string }) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const needle = normalizeShelfQuery(query);
  if (!needle || normalized.length !== text.length) return <>{text}</>;
  const parts = [];
  let start = 0;
  let index = normalized.indexOf(needle);
  while (index !== -1) {
    parts.push(text.slice(start, index), <mark key={index} className="bg-transparent font-bold text-[#e9c46a]">{text.slice(index, index + needle.length)}</mark>);
    start = index + needle.length;
    index = normalized.indexOf(needle, start);
  }
  return <>{parts}{text.slice(start)}</>;
}

export function useShelfLists(tab: ShelfTab, query: string, filtered: boolean, version: number) {
  const { entries: cache } = useMemo(() => ({ version, entries: new Map<string, ShelfEntry>() }), [version]);
  const [, update] = useState(0);
  const key = (value: ShelfTab) => JSON.stringify([value, query]);
  useEffect(() => {
    let cancelled = false;
    const tabs: ShelfTab[] = filtered ? [...shelfTabs.map(([value]) => value), ...(tab === 'discarded' ? [tab] : [])] : [tab];
    for (const value of tabs) {
      const entryKey = JSON.stringify([value, query]);
      let entry = cache.get(entryKey);
      if (!entry) {
        const next: ShelfEntry = { promise: Promise.resolve() };
        next.promise = (value === 'knowledge' ? listProcedureKnowledgeCandidates({ q: query, limit: 100 }).then((knowledge) => ({ knowledge }))
          : value === 'workInstruction' ? listProcedureWorkInstructionCandidates({ q: query, limit: 1000 }).then((workInstructions) => ({ workInstructions }))
            : listProcedureMaterials({ state: value, q: query, limit: 500 }).then((materials) => ({ materials })))
          .then((data) => { next.data = data; }).catch((e: unknown) => { next.error = isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, value === 'knowledge' || value === 'workInstruction' ? '候補を取得できません' : '素材を取得できません'); });
        cache.set(entryKey, next); entry = next;
      }
      void entry.promise.then(() => { if (!cancelled) update((n) => n + 1); });
    }
    return () => { cancelled = true; };
  }, [cache, filtered, query, tab]);
  const current = cache.get(key(tab));
  return { data: current?.data, loading: !current?.data && !current?.error, error: current?.error, getData: (value: ShelfTab) => cache.get(key(value))?.data, removeUnplaced: (id: string) => {
    for (const [entryKey, entry] of cache) {
      if (JSON.parse(entryKey)[0] === 'unplaced' && entry.data?.materials) entry.data.materials = entry.data.materials.filter((item) => item.id !== id);
    }
    update((n) => n + 1);
  } };
}

export function shelfPeriodMatches(date: string | undefined, days: number | null, now = Date.now()) {
  if (!days) return true;
  const since = days === 1 ? new Date(now).setHours(0, 0, 0, 0) : now - days * 86400000;
  const time = date ? Date.parse(date) : NaN;
  return time >= since && time <= now;
}
const matches = (values: string[], value: string) => !values.length || values.includes(value);
export const filterShelfMaterials = (items: ProcedureMaterialDto[], filters: ShelfFilters) => items.filter((item) => matches(filters.sources, materialSource(item)) && matches(filters.kinds, item.kind) && shelfPeriodMatches(item.receivedAt, filters.days));
export const filterShelfKnowledge = (items: ProcedureKnowledgeCandidate[], filters: ShelfFilters) => items.filter((item) => matches(filters.sources, 'ナレッジ') && matches(filters.kinds, item.kind));
export const workHasDates = (items: ProcedureWorkInstructionCandidate[]) => items.some((item) => item.sourceModified && Number.isFinite(Date.parse(item.sourceModified)));
export const filterShelfWorkInstructions = (items: ProcedureWorkInstructionCandidate[], filters: ShelfFilters) => {
  const hasDates = workHasDates(items);
  return items.filter((item) => matches(filters.sources, '加工') && matches(filters.kinds, 'PHOTO') && (!hasDates || shelfPeriodMatches(item.sourceModified, filters.days)));
};

export function ShelfFilterChips({ tab, hasWorkDates, filters, disabled, onChange }: { tab: ShelfTab; hasWorkDates: boolean; filters: ShelfFilters; disabled: boolean; onChange: (next: ShelfFilters) => void }) {
  const sources = tab === 'knowledge' ? ['ナレッジ'] : tab === 'workInstruction' ? ['加工'] : ['メール', '加工', 'ナレッジ'];
  const kinds = tab === 'workInstruction' ? [['PHOTO', '写真']] : tab === 'knowledge' ? [['PHOTO', '写真'], ['TEXT', '文章']] : [['PHOTO', '写真'], ['PDF', 'PDF'], ['TEXT', '文章']];
  const chipClass = 'h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[17px] disabled:opacity-40';
  const chip = (label: string, active: boolean, action: () => void) => <button key={label} disabled={disabled} aria-pressed={active} className={`${chipClass} ${active ? 'border-[#3ba776] bg-[#1f3a2e] text-[#eef3f6]' : 'border-[#344252] text-[#9fadb9]'}`} onClick={action}>{label}</button>;
  const toggle = (group: 'sources' | 'kinds', value: string) => onChange({ ...filters, [group]: filters[group].includes(value) ? filters[group].filter((item) => item !== value) : [...filters[group], value] });
  return <div aria-label="素材の絞り込み" className="flex shrink-0 items-center gap-2 overflow-x-auto">
    {sources.length > 1 ? <><span className="shrink-0 text-[15px] text-[#9fadb9]">出どころ</span>{sources.map((source) => chip(source, filters.sources.includes(source), () => toggle('sources', source)))}</> : null}
    {kinds.length > 1 ? <><span className="ml-2 shrink-0 text-[15px] text-[#9fadb9]">種類</span>{kinds.map(([kind, label]) => chip(label, filters.kinds.includes(kind), () => toggle('kinds', kind)))}</> : null}
    {tab !== 'knowledge' && (tab !== 'workInstruction' || hasWorkDates) ? <><span className="ml-2 shrink-0 text-[15px] text-[#9fadb9]">期間</span>{[[1, '今日'], [7, '7日'], [30, '30日']].map(([days, label]) => chip(String(label), filters.days === days, () => onChange({ ...filters, days: filters.days === days ? null : Number(days) })))}</> : null}
    {filters.sources.length || filters.kinds.length || filters.days ? <button disabled={disabled} className="h-11 shrink-0 whitespace-nowrap px-3 text-sm text-[#9fadb9] underline disabled:opacity-40" onClick={() => onChange(emptyShelfFilters)}>絞り込みを外す</button> : null}
  </div>;
}
