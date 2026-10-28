import { buildPartSearchIndex, nextKeyAvailability, searchPartIndex } from '@raspi-system/part-search-core';
import { useMemo, useState } from 'react';

import { haizenPhoneStyle, hp } from '../../ui/haizenPhoneTokens';

import { ONEHAND_ABC_KEYS, ONEHAND_KANA_KEYS, PartSearchOneHandDock } from './PartSearchOneHandDock';
import { PartSearchOneHandHit } from './PartSearchOneHandHit';

import type { PartSearchField, PartSearchFilter, PartSearchQuery, PartSearchRow } from '@raspi-system/part-search-core';
import type { ReactNode } from 'react';

const nextFields: PartSearchField[] = ['machine', 'seiban', 'name', 'hinban'];

export function PartSearchOneHandView({ rows, offline, topLeftChip, onDelete }: {
  rows: PartSearchRow[]; offline: boolean; topLeftChip?: ReactNode; onDelete: (row: PartSearchRow) => Promise<void>;
}) {
  const [query, setQuery] = useState<PartSearchQuery>({ field: 'all', typed: '', filters: [] });
  const [mode, setMode] = useState<'kana' | 'abc'>('kana');
  const [keysVisible, setKeysVisible] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  const index = useMemo(() => buildPartSearchIndex(rows.filter((row) => !deleted.has(row.id))), [rows, deleted]);
  const result = useMemo(() => searchPartIndex(index, query), [index, query]);
  const availableKeys = useMemo(() => keysVisible
    ? nextKeyAvailability(index, query, mode === 'kana' ? ONEHAND_KANA_KEYS : ONEHAND_ABC_KEYS)
    : new Set<string>(), [index, query, mode, keysVisible]);

  const fieldMode = (field: PartSearchQuery['field']) => {
    if (field === 'name') setMode('kana');
    else if (field !== 'all') setMode('abc');
  };
  const addFilter = (filter: PartSearchFilter) => {
    const filters = [...query.filters.filter((item) => item.field !== filter.field), { field: filter.field, value: filter.value }];
    const field = nextFields.find((candidate) => !filters.some((item) => item.field === candidate)) ?? 'all';
    setQuery({ field, filters, typed: '' });
    fieldMode(field);
    setSelected(null);
  };
  const removeFilter = (index: number) => {
    const field = query.filters[index].field;
    setQuery({ field, typed: '', filters: query.filters.filter((_, i) => i !== index) });
    fieldMode(field);
    setSelected(null);
  };
  const setTyped = (typed: string) => { setQuery({ ...query, typed }); setSelected(null); };
  const deleteRow = async (row: PartSearchRow) => {
    await onDelete(row);
    setDeleted((previous) => new Set([...previous, row.id]));
    setSelected((current) => current === row.id ? null : current);
  };

  return <div style={haizenPhoneStyle} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--hp-bg)] text-[var(--hp-ink)] [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--hp-ink)]">
    <div className="flex min-h-7 items-center gap-2 px-3.5 pb-1.5 pt-3">
      {topLeftChip ?? (offline && <span className="inline-flex h-[26px] items-center rounded-full border border-[color-mix(in_srgb,var(--hp-shelf)_45%,var(--hp-line))] px-2.5 text-xs font-extrabold text-[var(--hp-shelf)]">圏外</span>)}
      <span className="ml-auto text-[13px] font-extrabold tabular-nums text-[var(--hp-ink3)]">{result.total}件</span>
    </div>
    <section aria-label="検索結果" aria-live="polite" className={hp.list} onScroll={() => setKeysVisible(false)}>
      {result.total === 0 && <p className={hp.empty}>見つかりません</p>}
      {result.hits.slice(0, 40).map((row) => <PartSearchOneHandHit key={row.id} row={row} selected={selected === row.id} filters={query.filters}
        onSelect={() => { const next = selected === row.id ? null : row.id; setSelected(next); if (next !== null) setKeysVisible(false); }}
        onFilter={addFilter} onDelete={deleteRow} />)}
    </section>
    <PartSearchOneHandDock query={query} facets={result.facets} keysVisible={keysVisible} mode={mode} availableKeys={availableKeys}
      onFilter={addFilter} onRemoveFilter={removeFilter} onTyped={setTyped} onKeysVisible={setKeysVisible} onMode={setMode}
      onField={(field) => { setQuery({ ...query, field, typed: '' }); fieldMode(field); setKeysVisible(true); }}
      onClear={() => { setQuery({ field: 'all', typed: '', filters: [] }); setSelected(null); }}
      onBackspace={() => { if (query.typed) setTyped([...query.typed].slice(0, -1).join('')); else if (query.filters.length) removeFilter(query.filters.length - 1); }} />
  </div>;
}
