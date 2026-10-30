import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

import { Dialog } from '../../../components/ui/Dialog';
import { isHaizenSpeechAvailable, recognizeSpeechNative, stopSpeechNative } from '../haizenNative';
import { ShelfPhoto } from '../shelfPhoto/ShelfPhoto';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenHeader } from './HaizenHeader';
import { HaizenShelfPhotoViewer } from './HaizenShelfPhotoViewer';
import { matchShelfBySpeech } from './matchShelfBySpeech';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

/** Only one list may hold the native recognizer; the compact list stays mounted under the full-screen picker. */
let speechActive = false;

type ShelfPhotoListProps = {
  shelves: RegisteredShelfEntryDto[]; previousShelfCodes: string[]; selected: string;
  loading: boolean; error: boolean; onRetry: () => void; onSelect: (code: string) => void;
};

/** Machine chips and the scrollable photo grid; shared by the full-screen picker and the 配膳 tab. */
export function HaizenShelfPhotoList({ shelves, previousShelfCodes, selected, loading, error, onRetry, onSelect, compact = false, onView, disabled = false, onExpand, onScan, children, renderHeader }: ShelfPhotoListProps & {
  onScan?: () => void; compact?: boolean; onView?: (shelf: RegisteredShelfEntryDto) => void;
  /** Dims the grid until the 移動票 is read. */ disabled?: boolean;
  /** Shows a button that opens the full-screen picker. */ onExpand?: () => void;
  /** Loading or retry state between the chips and the grid. */ children?: ReactNode;
  renderHeader?: (speechButton: ReactNode) => ReactNode;
}) {
  const [viewer, setViewer] = useState<RegisteredShelfEntryDto | null>(null);
  const [filter, setFilter] = useState(previousShelfCodes.length && (!selected || previousShelfCodes.includes(selected)) ? 'previous' : 'all');
  const [speechAvailable] = useState(isHaizenSpeechAvailable);
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  const mounted = useRef(true);
  const [speechFilter, setSpeechFilter] = useState<{ text: string; codes: string[] } | null>(null);
  const latest = useRef({ shelves, previousShelfCodes, onSelect, disabled });
  useEffect(() => { latest.current = { shelves, previousShelfCodes, onSelect, disabled }; }, [shelves, previousShelfCodes, onSelect, disabled]);
  const shelfKey = shelves.map((s) => s.shelfCodeRaw).join('\n');
  useEffect(() => { setSpeechFilter(null); }, [shelfKey]);
  useEffect(() => {
    mounted.current = true;
    if (!compact && speechActive) stopSpeechNative();
    return () => {
      mounted.current = false;
      if (listeningRef.current) stopSpeechNative();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- compact never changes for a mounted list
  useEffect(() => { if (disabled && listeningRef.current) stopSpeechNative(); }, [disabled]);
  const speech = async () => {
    setSpeechFilter(null);
    if (listeningRef.current) { stopSpeechNative(); return; }
    if (speechActive) return;
    listeningRef.current = true;
    speechActive = true;
    setListening(true);
    try {
      const spoken = await recognizeSpeechNative();
      const current = latest.current;
      if (!mounted.current || current.disabled || spoken.status !== 'ok') return;
      const match = matchShelfBySpeech(spoken.texts, current.shelves, current.previousShelfCodes);
      if (match?.shelves.length === 1) {
        setFilter('all');
        current.onSelect(match.shelves[0].shelfCodeRaw);
      } else if (match) {
        setFilter('all');
        setSpeechFilter({ text: match.text, codes: match.shelves.map((s) => s.shelfCodeRaw) });
      }
    } catch {
      // Keep the selection unchanged when native recognition fails or is cancelled.
    } finally {
      listeningRef.current = false;
      speechActive = false;
      if (mounted.current) setListening(false);
    }
  };
  const speechButton = speechAvailable && <button type="button" aria-label="声で棚を選ぶ" aria-pressed={listening} disabled={disabled} onClick={speech}
    className={`${hp.iconButton} ${compact ? '!h-12 !w-12' : ''} aria-pressed:bg-[var(--hp-shelf)] aria-pressed:text-[var(--hp-bg)]`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  </button>;
  const machines = [...new Set(shelves.flatMap((s) => s.machineName ? [s.machineName] : []))].sort((a, b) => a.localeCompare(b, 'ja'));
  const filters = [...(previousShelfCodes.length ? [{ key: 'previous', label: '前回' }] : []), { key: 'all', label: '全部' },
    ...machines.map((name) => ({ key: `machine:${name}`, label: name }))];
  const filtered = speechFilter ? shelves.filter((s) => speechFilter.codes.includes(s.shelfCodeRaw)) : (compact ? shelves : filter === 'previous'
    ? previousShelfCodes.flatMap((code) => shelves.filter((s) => s.shelfCodeRaw === code))
    : shelves.filter((s) => filter === 'all' || `machine:${s.machineName}` === filter));
  const groups = new Map<string | null, RegisteredShelfEntryDto[]>();
  for (const shelf of filtered) {
    const name = shelf.machineName ?? null;
    const group = groups.get(name) ?? [];
    group.push(shelf);
    groups.set(name, group);
  }
  const pad = compact ? '' : 'px-3.5';
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tile = grid.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!grid.current || !tile) return;
    const box = grid.current.getBoundingClientRect();
    const rect = tile.getBoundingClientRect();
    if (rect.top < box.top || rect.bottom > box.bottom) grid.current.scrollTop += rect.top - box.top - 8;
  }, [selected, loading, error, shelves, filter, speechFilter]);
  return <>
    {renderHeader?.(speechButton)}
    {!compact && <div className={`flex shrink-0 items-center gap-1.5 pb-2 ${pad} ${disabled ? 'opacity-35' : ''}`}>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {filters.map((f) => <button key={f.key} type="button" className={hp.chip} aria-pressed={filter === f.key} disabled={disabled} onClick={() => { setSpeechFilter(null); setFilter(f.key); }}>{f.label}</button>)}
      </div>
      {!renderHeader && speechButton}
      {onExpand && <button type="button" aria-label="大きい画面で選ぶ" className={`${hp.chip} !h-[52px] w-[52px] shrink-0 !px-0 !text-2xl`} disabled={disabled} onClick={onExpand}>⤢</button>}
    </div>}
    <div className="relative flex min-h-0 flex-1 flex-col">
    {speechFilter && <div className={`shrink-0 pb-2 ${pad} ${compact ? 'pr-24' : ''}`}>
      <button type="button" className={hp.chip} aria-label={`${speechFilter.text} の絞り込みを解除`} disabled={disabled} onClick={() => setSpeechFilter(null)}>{speechFilter.text} ×</button>
    </div>}
    {children}
    {loading ? <p className={hp.empty}>読込中…</p> : error ? <div role="alert" className={hp.empty}>棚を取得できませんでした <button className={hp.mini} onClick={onRetry}>再試行</button></div>
      : <div ref={grid} aria-disabled={disabled || undefined} className={`grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto ${disabled ? 'pointer-events-none opacity-35' : ''} ${compact ? 'grid-cols-2 pb-2' : `grid-cols-2 ${pad} ${hp.hermesBottomPadding}`}`}>
        {[...groups].map(([machineName, group]) => <Fragment key={machineName === null ? 'other' : `machine:${machineName}`}>
          {!compact && <h3 className={`flex items-baseline gap-2 pt-2 text-base font-bold ${compact ? `col-span-3 ${speechAvailable ? 'pr-24' : 'pr-10'}` : 'col-span-2'}`}>
            {machineName ?? 'その他'}<small className={`text-xs ${hp.muted}`}>{group.length}棚</small>
          </h3>}
          {group.map((s) => <button key={s.shelfCodeRaw} type="button" aria-label={`棚 ${[s.machineName, s.direction, s.displayLabel].filter(Boolean).join(' ') || '写真'}`} aria-pressed={selected === s.shelfCodeRaw} disabled={disabled}
          data-machine={s.machineName} className={`relative overflow-hidden rounded-[14px] ${compact ? "border-[3px] border-[var(--hp-panel)]" : "border-2 border-[var(--hp-line)]"} bg-[var(--hp-panel)] text-left aria-pressed:border-[var(--hp-shelf)]`}
          onClick={() => { setSpeechFilter(null); selected === s.shelfCodeRaw ? (onView ?? setViewer)(s) : onSelect(s.shelfCodeRaw); }}>
          <span className="relative block">
            <ShelfPhoto shelf={s} label={s.direction || s.displayLabel || '棚'} className="aspect-[4/3] w-full" />
            {compact ? <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_bottom,transparent,rgba(0,0,0,.85)_50%)] px-2 pb-[5px] pt-[22px] leading-[1.15]"><span className={`block truncate font-mono text-xs font-bold ${hp.muted}`}>{s.machineName}</span><b className="block truncate text-xl font-black text-[var(--hp-shelf)]">{[s.direction, s.displayLabel].filter(Boolean).join(" ") || s.shelfCodeRaw}</b></span> : s.direction && <span className={`absolute inset-x-0 block bottom-0 bg-[linear-gradient(to_bottom,transparent,rgba(0,0,0,0.78))] pt-4 ${compact ? 'px-1.5 pb-1' : 'px-2 pb-1.5'}`}>
              <b className={`block truncate font-mono text-[var(--hp-shelf)] ${compact ? 'text-sm' : 'text-lg'}`}>{s.direction}</b>
            </span>}
          </span>
          {s.shelfCodeRaw === previousShelfCodes[0] && <span className="absolute left-1.5 top-1.5 rounded-md bg-[var(--hp-shelf)] px-1.5 py-0.5 text-[11px] font-black text-[var(--hp-bg)]">前回</span>}
          {compact && selected === s.shelfCodeRaw && <span aria-hidden className="absolute right-1.5 top-1.5 grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--hp-shelf)] text-xl font-black text-[var(--hp-bg)]">✓</span>}
          {!compact && <span className={`block pt-1.5 ${compact ? 'px-1.5 pb-1.5' : 'px-2 pb-2'}`}><span className={`block truncate text-xs ${hp.muted}`}>{s.displayLabel || '　'}</span></span>}
        </button>)}
        </Fragment>)}
        {!filtered.length && <p className={`${hp.empty} col-span-2`}>棚がありません</p>}
      </div>}
    </div>
    {compact && <div aria-label="棚の操作" className={`flex shrink-0 items-center gap-1.5 pt-2 ${disabled ? 'opacity-35' : ''}`}>
      {speechButton}
      {onScan && <button type="button" className={`${hp.iconButton} !h-12 !w-12 font-black`} disabled={disabled} onClick={onScan}>QR</button>}
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {machines.map((name) => <button key={name} type="button" disabled={disabled} className={`${hp.chip} !h-12 !px-4 !font-mono !text-base`} onClick={() => {
          const tile = [...(grid.current?.querySelectorAll<HTMLElement>('[data-machine]') ?? [])].find((tile) => tile.dataset.machine === name);
          if (grid.current && tile) grid.current.scrollTo({ top: grid.current.scrollTop + tile.getBoundingClientRect().top - grid.current.getBoundingClientRect().top, behavior: 'auto' });
        }}>{name}</button>)}
      </div>
      {onExpand && <button type="button" aria-label="大きい画面で選ぶ" className={`${hp.iconButton} !h-12 !w-12 text-2xl`} disabled={disabled} onClick={onExpand}>⤢</button>}
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
      <HaizenShelfPhotoList {...list} onView={setViewer} renderHeader={(speechButton) => <HaizenHeader title="棚を選ぶ" onBack={onClose}>
        <div className="ml-auto flex items-center gap-2.5">{speechButton}<button type="button" className={hp.mini} onClick={onScan}>QR</button></div>
      </HaizenHeader>} />
      <footer className={hp.dock}><button type="button" className={hp.mini} onClick={onMaster}>棚マスタ</button></footer>
    </div>
  </Dialog>{viewer && <HaizenShelfPhotoViewer shelf={viewer} onClose={() => setViewer(null)} />}</div>;
}
