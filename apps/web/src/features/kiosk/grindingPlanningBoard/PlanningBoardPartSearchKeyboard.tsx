import { katakanaToHiragana, normalizePartSearchQuery } from '@raspi-system/part-search-core';
import { useMemo, useState } from 'react';

const KANA_COLUMNS = ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'や ゆ よ', 'らりるれろ', 'わを ん '];
const KANA_KEYS = Array.from({ length: 5 }, (_, row) => KANA_COLUMNS.map((column) => column[row])).flat();
const ABC_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'];

// Normalize one kana at a time so small kana fold even inside yoon combinations.
const comparable = (value: string) => [...katakanaToHiragana(value.normalize('NFKC'))]
  .map((char) => normalizePartSearchQuery(char)).join('').toUpperCase();

export function usePlanningBoardPartSearch<Part extends { partName: string; partCode?: string }>(parts: readonly Part[] | undefined) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'kana' | 'abc'>('kana');
  const indexed = useMemo(() => (parts ?? []).map((part) => ({
    part, terms: [comparable(part.partName), comparable(part.partCode ?? '')]
  })), [parts]);
  const search = comparable(query);
  const { hits, nextChars } = useMemo(() => {
    const hits: Part[] = [];
    const nextChars = new Set<string>();
    for (const { part, terms } of indexed) {
      if (!terms.some((term) => term.includes(search))) continue;
      hits.push(part);
      for (const term of terms) {
        let at = term.indexOf(search);
        while (at >= 0 && at < term.length) {
          const next = term[at + search.length];
          if (next) nextChars.add(next);
          at = term.indexOf(search, at + 1);
        }
      }
    }
    return { hits, nextChars };
  }, [indexed, search]);
  return { query, setQuery, mode, setMode, hits, nextChars };
}

export function PlanningBoardPartSearchKeyboard({ search, disabled, largeButtons = false }: {
  search: ReturnType<typeof usePlanningBoardPartSearch>; disabled: boolean; largeButtons?: boolean;
}) {
  const { query, setQuery, mode, setMode, nextChars } = search;
  return <div className="min-w-0">
    <div className="flex h-12 items-center gap-1.5 rounded-[10px] border border-violet-400 bg-slate-800 px-1.5 pl-3">
      <input aria-label="部品検索" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-xl font-bold outline-none" />
      <button type="button" aria-label="1文字消す" disabled={disabled || !query} onClick={() => setQuery([...query].slice(0, -1).join(''))}
        className={`${largeButtons ? 'h-11' : 'h-9'} min-w-11 rounded-lg border border-slate-600 disabled:opacity-40`}>⌫</button>
      <button type="button" aria-label="全部消す" disabled={disabled || !query} onClick={() => setQuery('')}
        className={`${largeButtons ? 'h-11' : 'h-9'} min-w-11 rounded-lg border border-slate-600 disabled:opacity-40`}>×</button>
    </div>
    <div className={`mt-2 grid gap-1 ${largeButtons ? 'grid-cols-[repeat(10,minmax(44px,1fr))] overflow-x-auto' : 'grid-cols-10'}`}>
      {(mode === 'kana' ? KANA_KEYS : ABC_KEYS).map((key, index) => key === ' '
        ? <span key={`blank-${index}`} aria-hidden="true" />
        : <button key={key} type="button" disabled={disabled || !nextChars.has(comparable(key))} onClick={() => setQuery(query + key)}
          className="h-11 rounded-md border border-slate-600 bg-slate-800 p-0 text-lg font-bold disabled:cursor-default disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600">{key}</button>)}
    </div>
    <div className="mt-1.5 flex gap-1">
      {(['kana', 'abc'] as const).map((nextMode) => <button key={nextMode} type="button" aria-pressed={mode === nextMode} disabled={disabled} onClick={() => setMode(nextMode)}
        className={`${largeButtons ? 'h-11' : 'h-10'} flex-1 rounded-md border font-bold disabled:opacity-40 ${mode === nextMode ? 'border-slate-200 bg-slate-200 text-slate-900' : 'border-slate-600 text-slate-400'}`}>{nextMode === 'kana' ? 'かな' : '英数'}</button>)}
    </div>
  </div>;
}
