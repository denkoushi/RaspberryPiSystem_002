import { useState } from 'react';

import { Dialog } from '../../../components/ui/Dialog';
import { ShelfPhoto } from '../shelfPhoto/ShelfPhoto';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenHeader } from './HaizenHeader';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

const filters = ['前回の棚から', '全部', '西', '中央', '東'] as const;
type ShelfPhotoListProps = {
  shelves: RegisteredShelfEntryDto[]; previousShelfCodes: string[]; selected: string;
  loading: boolean; error: boolean; onRetry: () => void; onSelect: (code: string) => void;
};

/** Area chips and the scrollable photo grid; shared by the full-screen picker and the 配膳 tab. */
export function HaizenShelfPhotoList({ shelves, previousShelfCodes, selected, loading, error, onRetry, onSelect, compact = false }: ShelfPhotoListProps & { compact?: boolean }) {
  const [filter, setFilter] = useState<typeof filters[number]>(previousShelfCodes.length ? '前回の棚から' : '全部');
  const filtered = filter === '前回の棚から'
    ? previousShelfCodes.flatMap((code) => shelves.filter((s) => s.shelfCodeRaw === code))
    : shelves.filter((s) => filter === '全部' || s.areaId === ({ 西: 'west', 中央: 'central', 東: 'east' } as const)[filter]);
  const pad = compact ? '' : 'px-3.5';
  return <>
    <div className={`flex shrink-0 gap-1.5 overflow-x-auto pb-2 ${pad}`}>
      {filters.map((f) => <button key={f} type="button" className={hp.chip} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
    </div>
    {loading ? <p className={hp.empty}>読込中…</p> : error ? <div role="alert" className={hp.empty}>棚を取得できませんでした <button className={hp.mini} onClick={onRetry}>再試行</button></div>
      : <div className={`grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto ${compact ? 'grid-cols-3 pb-2' : `grid-cols-2 ${pad} ${hp.hermesBottomPadding}`}`}>
        {filtered.map((s, i) => <button key={s.shelfCodeRaw} type="button" aria-label={`棚 ${s.shelfCodeRaw}`} aria-pressed={selected === s.shelfCodeRaw}
          className="relative overflow-hidden rounded-[14px] border-2 border-[var(--hp-line)] bg-[var(--hp-panel)] text-left aria-pressed:border-[var(--hp-shelf)]" onClick={() => onSelect(s.shelfCodeRaw)}>
          <ShelfPhoto shelf={s} className="aspect-[4/3] w-full" />
          {i === 0 && previousShelfCodes.includes(s.shelfCodeRaw) && <span className="absolute left-1.5 top-1.5 rounded-md bg-[var(--hp-shelf)] px-1.5 py-0.5 text-[11px] font-black text-[var(--hp-bg)]">前回</span>}
          <span className={`block pt-1.5 ${compact ? 'px-1.5 pb-1.5' : 'px-2 pb-2'}`}><b className={`block truncate font-mono text-[var(--hp-shelf)] ${compact ? 'text-sm' : 'text-lg'}`}>{s.shelfCodeRaw}</b><span className={`block truncate text-xs ${hp.muted}`}>{s.displayLabel || '　'}</span></span>
        </button>)}
        {!filtered.length && <p className={`${hp.empty} ${compact ? 'col-span-3' : 'col-span-2'}`}>棚がありません</p>}
      </div>}
  </>;
}

export function HaizenShelfPhotoPicker({ onClose, onScan, onMaster, ...list }: ShelfPhotoListProps & {
  onClose: () => void; onScan: () => void; onMaster: () => void;
}) {
  return <div style={haizenPhoneStyle}><Dialog isOpen onClose={onClose} ariaLabel="棚を選ぶ" overlayZIndex={60}
    className="!fixed !inset-0 !m-auto !flex !h-dvh !max-h-none !w-full !max-w-[480px] !flex-col !rounded-none !border-0 !bg-[#0d0f0e] !p-0 !text-[#f2f4f1]">
    <div style={haizenPhoneStyle} className="flex min-h-0 flex-1 flex-col">
      <HaizenHeader title="棚を選ぶ" onBack={onClose}><button type="button" className={`${hp.mini} ml-auto`} onClick={onScan}>QR</button></HaizenHeader>
      <HaizenShelfPhotoList {...list} />
      <footer className={hp.dock}><button type="button" className={hp.mini} onClick={onMaster}>棚マスタ</button></footer>
    </div>
  </Dialog></div>;
}
