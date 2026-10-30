import { useLayoutEffect, useRef } from 'react';

import { hp } from '../../ui/haizenPhoneTokens';

import { PART_SEARCH_FIELD_LABELS, PartSearchFieldIcon } from './PartSearchFieldIcon';

import type { PartSearchFacet, PartSearchFilter, PartSearchQuery } from '@raspi-system/part-search-core';

export const ONEHAND_KANA_KEYS = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'];
export const ONEHAND_ABC_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'];

export function PartSearchOneHandDock({ count, query, facets, keysVisible, mode, availableKeys, speechAvailable, listening, onSpeech, onFilter, onRemoveFilter, onField, onTyped, onClear, onKeysVisible, onMode, onBackspace }: {
  count: number; query: PartSearchQuery; facets: PartSearchFacet[]; keysVisible: boolean; mode: 'kana' | 'abc'; availableKeys: ReadonlySet<string>;
  speechAvailable: boolean; listening: boolean; onSpeech: () => void;
  onFilter: (filter: PartSearchFilter) => void; onRemoveFilter: (index: number) => void;
  onField: (field: PartSearchQuery['field']) => void; onTyped: (typed: string) => void; onClear: () => void;
  onKeysVisible: (visible: boolean) => void; onMode: (mode: 'kana' | 'abc') => void; onBackspace: () => void;
}) {
  const flow = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (flow.current) flow.current.scrollLeft = flow.current.scrollWidth;
  }, [query.typed, query.filters, keysVisible]);
  const chips = facets.filter((facet) => !query.filters.some((filter) => filter.field === facet.field)).slice(0, 12);
  return <div className="flex shrink-0 flex-col gap-[7px] border-t border-[var(--hp-line)] bg-[var(--hp-panel)] px-2.5 pt-2">
    <div className="flex min-h-11 gap-1.5 overflow-x-auto" aria-label="絞り込み候補">
      {(chips.length > 1 || Boolean(query.typed)) && chips.map((facet) => <button type="button" key={`${facet.field}:${facet.value}`} onClick={() => onFilter(facet)}
        aria-label={`${PART_SEARCH_FIELD_LABELS[facet.field]} ${facet.value} ${facet.count}件でしぼる`}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--hp-line)] bg-[var(--hp-bg)] px-3.5 font-mono text-base font-extrabold">
        <PartSearchFieldIcon field={facet.field} />{facet.value}<small className="text-xs text-[var(--hp-ink3)]">{facet.count}</small>
      </button>)}
    </div>
    <div onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) onKeysVisible(true); }}
      className="flex min-h-[58px] items-center gap-1.5 rounded-2xl border-[1.5px] border-[var(--hp-shelf)] bg-[var(--hp-panel2)] py-1 pl-2.5 pr-1.5">
      <span className="shrink-0 text-sm font-extrabold text-[var(--hp-shelf)]">{PART_SEARCH_FIELD_LABELS[query.field]}</span>
      <div ref={flow} className="flex min-w-0 flex-1 items-center gap-[5px] overflow-x-auto">
        {query.filters.map((filter, i) => <button type="button" key={filter.field} onClick={() => onRemoveFilter(i)} aria-label={`${PART_SEARCH_FIELD_LABELS[filter.field]} ${filter.value} を外す`}
          className="inline-flex h-[34px] shrink-0 items-center gap-1 rounded-[10px] bg-[var(--hp-ink)] px-2 font-mono text-sm font-black text-[var(--hp-bg)]">
          <PartSearchFieldIcon field={filter.field} />{filter.value}<span aria-hidden="true">×</span>
        </button>)}
        <input aria-label="検索文字" value={query.typed} onChange={(event) => onTyped(event.target.value)} onFocus={() => onKeysVisible(true)} inputMode="none"
          placeholder=""
          className="min-w-[4ch] flex-1 bg-transparent text-[22px] font-black caret-[var(--hp-shelf)] outline-none placeholder:text-base placeholder:text-[var(--hp-ink3)]" />
      </div>
      <span className="shrink-0 px-1 text-sm font-extrabold tabular-nums text-[var(--hp-ink3)]">{count}件</span>
      {(query.typed || query.filters.length > 0) && <button type="button" aria-label="全部消す" className={`${hp.iconButton} !h-[46px] !w-[46px]`} onClick={onClear}>×</button>}
      {speechAvailable && <button type="button" aria-label="音声で探す" aria-pressed={listening} onClick={onSpeech}
        className={`${hp.iconButton} !h-[46px] !w-[46px] aria-pressed:bg-[var(--hp-shelf)] aria-pressed:text-[var(--hp-bg)]`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </svg>
      </button>}
      <button type="button" aria-label={keysVisible ? 'キーをしまう' : 'キーを出す'} aria-expanded={keysVisible} className={`${hp.iconButton} !h-[46px] !w-[46px]`} onClick={() => onKeysVisible(!keysVisible)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          {keysVisible ? <path d="M6 9l6 6 6-6" /> : <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h1M11 10h2M16 10h1M8 14h8" /></>}
        </svg>
      </button>
    </div>
    <div className="flex items-center gap-1.5">
      <div role="group" aria-label="文字種" className="flex shrink-0 overflow-hidden rounded-xl border border-[var(--hp-line)]">
        {(['kana', 'abc'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => onMode(value)}
          className="h-[46px] bg-[var(--hp-bg)] px-3.5 text-base font-black text-[var(--hp-ink3)] aria-pressed:bg-[var(--hp-ink)] aria-pressed:text-[var(--hp-bg)]">{value === 'kana' ? 'かな' : '英数'}</button>)}
      </div>
      <div role="group" aria-label="さがす項目" className="grid min-w-0 flex-1 grid-cols-5 gap-0.5 rounded-xl border border-[var(--hp-line)] bg-[var(--hp-bg)] p-0.5">
        {(Object.keys(PART_SEARCH_FIELD_LABELS) as PartSearchQuery['field'][]).map((field) => <button key={field} type="button" onClick={() => onField(field)} aria-pressed={query.field === field}
          className="h-11 whitespace-nowrap rounded-[11px] text-base font-black text-[var(--hp-ink3)] aria-pressed:bg-[var(--hp-ink)] aria-pressed:text-[var(--hp-bg)]">{PART_SEARCH_FIELD_LABELS[field]}</button>)}
      </div>
    </div>
    {keysVisible && <div aria-label="文字キー" className="grid h-[154px] grid-cols-7 content-start gap-[5px] overflow-y-auto">
      {(mode === 'kana' ? ONEHAND_KANA_KEYS : ONEHAND_ABC_KEYS).map((key) => <button type="button" key={key} disabled={!availableKeys.has(key)} onClick={() => onTyped(query.typed + key)}
        className="h-12 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-bg)] text-[21px] font-black disabled:cursor-default disabled:opacity-[.18]">{key}</button>)}
      <button type="button" aria-label="1文字消す" onClick={onBackspace}
        className="h-12 whitespace-nowrap rounded-[10px] border border-[color-mix(in_srgb,var(--hp-ng)_45%,var(--hp-line))] bg-[var(--hp-bg)] text-[13px] font-black text-[var(--hp-ng)]">1字消す</button>
    </div>}
  </div>;
}
