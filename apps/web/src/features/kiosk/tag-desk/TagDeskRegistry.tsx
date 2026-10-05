

import { KindIcon, NfcIcon, PlusIcon, SearchIcon } from './TagDeskIcons';
import { KIND_META, TAG_DESK_KINDS, shortUid, statusLabel, statusTone } from './tagDeskModel';
import { tagDesk } from './tagDeskTheme';

import type { TagDeskState } from './useTagDesk';
import type { TagDeskKind, TagDeskRow } from '../../../api/domains/tag-desk';
import type { Ref } from 'react';

const COLUMNS = 'grid grid-cols-[210px_130px_minmax(0,1.2fr)_minmax(0,1fr)_110px] items-center gap-4 px-[22px]';
const EMPLOYEE_COLUMNS = 'grid grid-cols-[210px_130px_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_110px] items-center gap-4 px-[22px]';

type Props = {
  state: TagDeskState;
  /** Kinds (tabs) where the scanned tag is bound, marked with a dot. */
  hitKinds: Set<TagDeskKind>;
  /** Rows bound to the scanned tag. */
  hitIds: Set<string>;
  releasing: boolean;
  listRef: Ref<HTMLDivElement>;
};

export function TagDeskRegistry({ state, hitKinds, hitIds, releasing, listRef }: Props) {
  const meta = KIND_META[state.kind];
  const tagged = state.rows.filter((row) => row.tags.length > 0).length;
  const untagged = state.rows.length - tagged;

  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${tagDesk.panel}`} aria-label="紐づけ先の一覧">
      <div className="flex flex-wrap items-center gap-3.5 border-b border-[#223043] px-[18px] py-4">
        <div className="flex gap-1 rounded-xl bg-[#070b12] p-1" role="tablist" aria-label="種類">
          {TAG_DESK_KINDS.map((kind) => {
            const selected = kind === state.kind;
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => state.setKind(kind)}
                className={`inline-flex h-11 items-center gap-2.5 rounded-[9px] px-4 text-base ${selected ? 'bg-[#131c29] font-bold text-white shadow-[inset_0_0_0_1px_#223043]' : 'text-[#8494a8] hover:text-white'}`}
              >
                <KindIcon kind={kind} />
                {KIND_META[kind].label}
                {hitKinds.has(kind) ? <span className="h-2 w-2 rounded-full bg-[#4cc9f0] shadow-[0_0_0_3px_#173847]" aria-label="このタグの紐づけ先あり" /> : null}
              </button>
            );
          })}
        </div>
        <label className="flex h-11 w-[300px] items-center gap-2 rounded-[10px] border border-[#223043] bg-[#070b12] px-3 text-[#8494a8] focus-within:border-[#4cc9f0]">
          <SearchIcon className="h-[18px] w-[18px] flex-none" />
          <input
            id="tag-desk-search"
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            placeholder="名前・コード"
            aria-label="名前・コードで探す"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-[#5c6d83] focus:outline-none"
          />
        </label>
        <button
          type="button"
          aria-pressed={state.untaggedOnly}
          onClick={() => state.setUntaggedOnly(!state.untaggedOnly)}
          className={`inline-flex h-11 items-center gap-2 rounded-[10px] border px-3.5 text-[15px] ${state.untaggedOnly ? 'border-[#4cc9f0] bg-[#173847] text-[#4cc9f0]' : 'border-dashed border-[#3a4b62] text-[#8494a8]'}`}
        >
          タグなし
          <span className="font-mono text-[13px]">{untagged}</span>
        </button>
        <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost} ml-auto`} onClick={() => state.openForm({ kind: state.kind, id: null })}>
          <PlusIcon />
          {meta.label}を追加
        </button>
      </div>
      <div className={`${state.kind === 'employee' ? EMPLOYEE_COLUMNS : COLUMNS} h-10 border-b border-[#223043] text-xs font-bold tracking-[0.1em] text-[#5c6d83]`}>
        <span>タグ</span>
        <span>{meta.codeLabel}</span>
        <span>{state.kind === 'employee' ? '氏名' : '名称'}</span>
        <span>{meta.subLabel}</span>
        {state.kind === 'employee' ? <span>{meta.sub2Label}</span> : null}
        <span>状態</span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" data-tag-desk-list>
        {state.registryLoading ? <p className="px-[22px] py-4 text-base text-[#8494a8]">読み込んでいます…</p> : null}
        {state.visibleRows.map((row) => (
          <RegistryRow
            key={row.id}
            row={row}
            hit={hitIds.has(row.id)}
            selected={state.selectedRow?.id === row.id}
            releasing={releasing}
            onSelect={() => state.select(state.selectedRow?.id === row.id ? null : { kind: row.kind, id: row.id })}
          />
        ))}
        {!state.registryLoading && state.visibleRows.length === 0 ? (
          <p className="px-[22px] py-4 text-base text-[#8494a8]">該当なし</p>
        ) : null}
      </div>
      <div className="flex h-12 flex-none items-center gap-4 border-t border-[#223043] px-[22px] text-sm text-[#8494a8]">
        <span>{meta.label} {state.rows.length}件</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#152032]" />タグあり {tagged}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-[#334359]" />タグなし {untagged}</span>
        <span className="ml-auto">在庫の棚・数量タグは「在庫の準備」で付けます</span>
      </div>
    </section>
  );
}

function RegistryRow({ row, hit, selected, releasing, onSelect }: { row: TagDeskRow; hit: boolean; selected: boolean; releasing: boolean; onSelect: () => void }) {
  const first = row.tags[0];
  const marked = hit || selected;
  let tagCell;
  if (!first) {
    tagCell = <span className="inline-flex h-8 items-center rounded-lg border border-dashed border-[#334359] px-3 text-sm text-[#5c6d83]">タグなし</span>;
  } else {
    const tone = hit && releasing ? 'border border-dashed border-[#ff5d5d] text-[#ff5d5d]' : hit ? 'bg-[#4cc9f0] text-[#04131a]' : 'bg-[#152032] text-[#aebbd0]';
    tagCell = (
      <span className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 font-mono text-sm ${tone}`}>
        <NfcIcon className={`h-4 w-4 ${hit ? '' : 'text-[#4cc9f0]'}`} />
        {shortUid(first.uid)}
        {row.tags.length > 1 ? <span className="text-xs">+{row.tags.length - 1}</span> : null}
      </span>
    );
  }
  const tone = statusTone(row.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`${row.kind === 'employee' ? EMPLOYEE_COLUMNS : COLUMNS} relative h-14 w-full border-b border-[#172131] text-left text-[17px] hover:bg-[#101824] ${marked ? 'bg-[linear-gradient(90deg,rgba(76,201,240,0.12),rgba(76,201,240,0.03)_60%,transparent)]' : ''}`}
    >
      {marked ? <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-[3px] bg-[#4cc9f0]" aria-hidden /> : null}
      <span data-tether={hit ? 'hit' : selected ? 'selected' : undefined} className="justify-self-start">{tagCell}</span>
      <span className="font-mono text-[15px] text-[#aebbd0]">{row.code}</span>
      <span className="truncate font-medium text-white">{row.name}</span>
      <span className="truncate text-[15px] text-[#8494a8]">{row.sub ?? ''}</span>
      {row.kind === 'employee' ? <span className="truncate text-[15px] text-[#8494a8]">{row.sub2 ?? ''}</span> : null}
      <span className="text-sm">
        {tone ? <span className={tagDesk.chipWarn}>{statusLabel(row.kind, row.status)}</span> : <span className="text-white">{statusLabel(row.kind, row.status)}</span>}
      </span>
    </button>
  );
}
