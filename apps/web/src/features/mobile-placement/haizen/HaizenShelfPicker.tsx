import { useState } from 'react';

import { filterStructuredShelvesByAreaLine, listUnstructuredShelves } from '../registeredShelves';
import { SHELF_AREA_OPTIONS, SHELF_LINE_OPTIONS } from '../shelfSelection/defaultShelfRegisterCatalog';
import { hp } from '../ui/haizenPhoneTokens';
import { splitShelfCodeForDisplay } from '../ui/splitShelfCodeForDisplay';

import { HaizenIcon } from './HaizenIcon';

import type { RegisteredShelfEntryDto } from '../registeredShelves';
import type { ShelfAreaId, ShelfLineId } from '../shelfSelection/shelfSelectionTypes';

export function HaizenShelfPicker({ shelves, loading, error, onRetry, selected, onSelect, onMaster }: {
  shelves: RegisteredShelfEntryDto[]; loading: boolean; error: boolean; onRetry: () => void;
  selected: string; onSelect: (code: string) => void; onMaster: () => void;
}) {
  const [area, setArea] = useState<ShelfAreaId | null>(null);
  const [line, setLine] = useState<ShelfLineId | null>(null);
  const structured = area && line
    ? [...filterStructuredShelvesByAreaLine(shelves, area, line)].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)) : [];
  const visible = [...structured, ...listUnstructuredShelves(shelves)];
  return <>
    <div className="flex items-center justify-between">
      <h2 className="font-bold">棚を選ぶ</h2>
      <button type="button" className={hp.mini} onClick={onMaster}><HaizenIcon name="grid" className="h-4 w-4" />棚マスタ</button>
    </div>
    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_12px_repeat(3,minmax(0,1fr))] gap-1.5">
      {SHELF_AREA_OPTIONS.map((o) => <button key={o.id} type="button" className={`${hp.segment} !h-12 !px-0`} aria-pressed={area === o.id} onClick={() => setArea(o.id)}>{o.label}</button>)}
      <span />
      {SHELF_LINE_OPTIONS.map((o) => <button key={o.id} type="button" className={`${hp.segment} !h-12 !px-0`} aria-pressed={line === o.id} onClick={() => setLine(o.id)}>{o.label}</button>)}
    </div>
    {loading ? <p role="status" className={hp.muted}>読み込み中…</p> : error ? <div role="alert">登録済み棚の取得に失敗しました <button type="button" className={hp.mini} onClick={onRetry}>再試行</button></div> : <>
      {(!area || !line) && <p className={`text-[13px] ${hp.muted}`}>エリアと列を選ぶ</p>}
      {area && line && !structured.length && <p className={`text-[13px] ${hp.muted}`}>この組み合わせの登録棚はありません</p>}
      <div className="grid max-h-[45dvh] grid-cols-4 gap-1.5 overflow-y-auto">
        {visible.map((s) => {
          const { prefix, num } = splitShelfCodeForDisplay(s.shelfCodeRaw);
          return <button key={s.shelfCodeRaw} type="button" aria-label={`棚 ${s.shelfCodeRaw}`} aria-pressed={selected === s.shelfCodeRaw}
            className="min-h-14 rounded-xl border border-[var(--hp-line)] bg-[var(--hp-bg)] px-1 py-1 font-mono text-[22px] font-bold tabular-nums aria-pressed:border-[var(--hp-shelf)] aria-pressed:text-[var(--hp-shelf)]"
            onClick={() => onSelect(s.shelfCodeRaw)}>
            {num ? <><span className={`block font-sans text-[11px] ${hp.faint}`}>{prefix}</span>{num}</> : <span className="break-all text-base">{prefix}</span>}
          </button>;
        })}
      </div>
    </>}
  </>;
}
