import { Fragment, useState, type ReactNode } from 'react';

import { Dialog } from '../../../components/ui/Dialog';
import { ShelfPhoto } from '../shelfPhoto/ShelfPhoto';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenHeader } from './HaizenHeader';
import { HaizenShelfPhotoViewer } from './HaizenShelfPhotoViewer';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

type ShelfPhotoListProps = {
  shelves: RegisteredShelfEntryDto[]; previousShelfCodes: string[]; selected: string;
  loading: boolean; error: boolean; onRetry: () => void; onSelect: (code: string) => void;
};

/** Machine chips and the scrollable photo grid; shared by the full-screen picker and the 配膳 tab. */
export function HaizenShelfPhotoList({ shelves, previousShelfCodes, selected, loading, error, onRetry, onSelect, compact = false, onView, disabled = false, onExpand, children }: ShelfPhotoListProps & {
  compact?: boolean; onView?: (shelf: RegisteredShelfEntryDto) => void;
  /** Dims the grid until the 移動票 is read. */ disabled?: boolean;
  /** Shows a button that opens the full-screen picker. */ onExpand?: () => void;
  /** Loading or retry state between the chips and the grid. */ children?: ReactNode;
}) {
  const [viewer, setViewer] = useState<RegisteredShelfEntryDto | null>(null);
  const [filter, setFilter] = useState(previousShelfCodes.length ? 'previous' : 'all');
  const machines = [...new Set(shelves.flatMap((s) => s.machineName ? [s.machineName] : []))].sort((a, b) => a.localeCompare(b, 'ja'));
  const filters = [...(previousShelfCodes.length ? [{ key: 'previous', label: '前回' }] : []), { key: 'all', label: '全部' },
    ...machines.map((name) => ({ key: `machine:${name}`, label: name }))];
  const filtered = filter === 'previous'
    ? previousShelfCodes.flatMap((code) => shelves.filter((s) => s.shelfCodeRaw === code))
    : shelves.filter((s) => filter === 'all' || `machine:${s.machineName}` === filter);
  const groups = new Map<string | null, RegisteredShelfEntryDto[]>();
  for (const shelf of filtered) {
    const name = shelf.machineName ?? null;
    const group = groups.get(name) ?? [];
    group.push(shelf);
    groups.set(name, group);
  }
  const pad = compact ? '' : 'px-3.5';
  return <>
    <div className={`flex shrink-0 items-center gap-1.5 pb-2 ${pad} ${disabled ? 'opacity-35' : ''}`}>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {filters.map((f) => <button key={f.key} type="button" className={hp.chip} aria-pressed={filter === f.key} disabled={disabled} onClick={() => setFilter(f.key)}>{f.label}</button>)}
      </div>
      {onExpand && <button type="button" aria-label="大きい画面で選ぶ" className={`${hp.chip} !h-[52px] w-[52px] shrink-0 !px-0 !text-2xl`} disabled={disabled} onClick={onExpand}>⤢</button>}
    </div>
    {children}
    {loading ? <p className={hp.empty}>読込中…</p> : error ? <div role="alert" className={hp.empty}>棚を取得できませんでした <button className={hp.mini} onClick={onRetry}>再試行</button></div>
      : <div aria-disabled={disabled || undefined} className={`grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto ${disabled ? 'pointer-events-none opacity-35' : ''} ${compact ? 'grid-cols-3 pb-2' : `grid-cols-2 ${pad} ${hp.hermesBottomPadding}`}`}>
        {[...groups].map(([machineName, group]) => <Fragment key={machineName === null ? 'other' : `machine:${machineName}`}>
          <h3 className={`flex items-baseline gap-2 pt-2 text-base font-bold ${compact ? 'col-span-3' : 'col-span-2'}`}>
            {machineName ?? 'その他'}<small className={`text-xs ${hp.muted}`}>{group.length}棚</small>
          </h3>
          {group.map((s) => <button key={s.shelfCodeRaw} type="button" aria-label={`棚 ${[s.machineName, s.direction, s.displayLabel].filter(Boolean).join(' ') || '写真'}`} aria-pressed={selected === s.shelfCodeRaw} disabled={disabled}
          className="relative overflow-hidden rounded-[14px] border-2 border-[var(--hp-line)] bg-[var(--hp-panel)] text-left aria-pressed:border-[var(--hp-shelf)]"
          onClick={() => selected === s.shelfCodeRaw ? (onView ?? setViewer)(s) : onSelect(s.shelfCodeRaw)}>
          <ShelfPhoto shelf={s} label={s.direction || s.displayLabel || '棚'} className="aspect-[4/3] w-full" />
          {s.shelfCodeRaw === previousShelfCodes[0] && <span className="absolute left-1.5 top-1.5 rounded-md bg-[var(--hp-shelf)] px-1.5 py-0.5 text-[11px] font-black text-[var(--hp-bg)]">前回</span>}
          <span className={`block pt-1.5 ${compact ? 'px-1.5 pb-1.5' : 'px-2 pb-2'}`}><b className={`block truncate font-mono text-[var(--hp-shelf)] ${compact ? 'text-sm' : 'text-lg'}`}>{s.direction || '　'}</b><span className={`block truncate text-xs ${hp.muted}`}>{s.displayLabel || '　'}</span></span>
          {selected === s.shelfCodeRaw && <span className="block px-1.5 pb-1 text-[11px] text-[var(--hp-shelf)]">もう一度で拡大</span>}
        </button>)}
        </Fragment>)}
        {!filtered.length && <p className={`${hp.empty} ${compact ? 'col-span-3' : 'col-span-2'}`}>棚がありません</p>}
      </div>}
    {viewer && <HaizenShelfPhotoViewer shelf={viewer} onClose={() => setViewer(null)} />}
  </>;
}

export function HaizenShelfPhotoPicker({ onClose, onScan, onMaster, ...list }: ShelfPhotoListProps & {
  onClose: () => void; onScan: () => void; onMaster: () => void;
}) {
  const [viewer, setViewer] = useState<RegisteredShelfEntryDto | null>(null);
  return <div style={haizenPhoneStyle}><Dialog isOpen onClose={onClose} ariaLabel="棚を選ぶ" overlayZIndex={60}
    closeOnEsc={!viewer} trapFocus={!viewer}
    className="!fixed !inset-0 !m-auto !flex !h-dvh !max-h-none !w-full !max-w-[480px] !flex-col !rounded-none !border-0 !bg-[#0d0f0e] !p-0 !text-[#f2f4f1]">
    <div style={haizenPhoneStyle} className="flex min-h-0 flex-1 flex-col">
      <HaizenHeader title="棚を選ぶ" onBack={onClose}><button type="button" className={`${hp.mini} ml-auto`} onClick={onScan}>QR</button></HaizenHeader>
      <HaizenShelfPhotoList {...list} onView={setViewer} />
      <footer className={hp.dock}><button type="button" className={hp.mini} onClick={onMaster}>棚マスタ</button></footer>
    </div>
  </Dialog>{viewer && <HaizenShelfPhotoViewer shelf={viewer} onClose={() => setViewer(null)} />}</div>;
}
