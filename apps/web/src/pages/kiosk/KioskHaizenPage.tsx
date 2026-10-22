import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useHaizenOverview, useHaizenShelves } from '../../api/hooks/haizen-overview';
import { matchesHaizenSearch, normalizeHaizenSearch, parseHaizenSpeech, searchKinds, timeSincePlaced } from '../../features/kiosk/haizen/haizenSearch';
import { HaizenSearchPad } from '../../features/kiosk/haizen/HaizenSearchPad';
import { HaizenShelfPhoto } from '../../features/kiosk/haizen/HaizenShelfPhoto';
import { useHaizenVoiceSearch } from '../../features/kiosk/haizen/useHaizenVoiceSearch';
import { MicIcon, SearchIcon } from '../../features/kiosk/inventory/InventoryIcons';
import { invButton, invButtonGhost, invCard, invPanel, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

import type { HaizenOverviewRow, MobilePlacementRegisteredShelfEntry } from '../../api/domains/mobile-placement';
import type { HaizenSearch } from '../../features/kiosk/haizen/haizenSearch';
import type { InventoryThumbnailSize } from '../../features/kiosk/inventory/InventoryItemGrid';

const emptyRows: HaizenOverviewRow[] = [];
const gridSizes = {
  small: 'grid-cols-[repeat(auto-fill,minmax(170px,1fr))]',
  medium: 'grid-cols-[repeat(auto-fill,minmax(250px,1fr))]',
  large: 'grid-cols-[repeat(auto-fill,minmax(360px,1fr))]'
};
const time = (value: number | string) => new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
const placedTime = (value: string) => `${new Date(value).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} ${time(value)}`;

export function KioskHaizenPage() {
  const overview = useHaizenOverview();
  const master = useHaizenShelves();
  const [size, setSize] = useState<InventoryThumbnailSize>('medium');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [query, setQuery] = useState<HaizenSearch | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [toast, setToast] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = overview.data?.rows ?? emptyRows;
  const shelves = useMemo(() => {
    const registered = new Map<string, MobilePlacementRegisteredShelfEntry>((master.data?.shelves ?? []).map(shelf => [shelf.shelfCodeRaw, shelf]));
    // Legacy branches can reference shelves absent from today's master; their location must remain reachable.
    for (const row of rows) if (!registered.has(row.shelfCodeRaw)) registered.set(row.shelfCodeRaw, { shelfCodeRaw: row.shelfCodeRaw, isStructured: false, displayLabel: '棚マスタ未登録' });
    return [...registered.values()].sort((a, b) => a.shelfCodeRaw.localeCompare(b.shelfCodeRaw, 'ja', { numeric: true }));
  }, [master.data, rows]);
  const grouped = useMemo(() => {
    const byShelf = new Map<string, HaizenOverviewRow[]>();
    const byOrder = new Map<string, HaizenOverviewRow[]>();
    for (const row of [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))) {
      if (!byShelf.has(row.shelfCodeRaw)) byShelf.set(row.shelfCodeRaw, []);
      byShelf.get(row.shelfCodeRaw)!.push(row);
      if (!byOrder.has(row.manufacturingOrderBarcodeRaw)) byOrder.set(row.manufacturingOrderBarcodeRaw, []);
      byOrder.get(row.manufacturingOrderBarcodeRaw)!.push(row);
    }
    return { byShelf, byOrder };
  }, [rows]);
  const hits = query ? rows.filter(row => matchesHaizenSearch(row, query)) : [];
  const hitIds = new Set(hits.map(row => row.id));
  const hitShelves = new Set(hits.map(row => row.shelfCodeRaw));
  const visibleShelves = shelves.filter(shelf => !query || hitShelves.has(shelf.shelfCodeRaw));
  const selected = shelves.find(shelf => shelf.shelfCodeRaw === selectedCode);
  const items = selected ? grouped.byShelf.get(selected.shelfCodeRaw) ?? [] : [];
  const index = visibleShelves.findIndex(shelf => shelf.shelfCodeRaw === selectedCode);
  const openShelf = (code: string | null) => { setSelectedCode(code); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const runSearch = (next: HaizenSearch) => {
    if (!normalizeHaizenSearch(next.text)) return;
    const matches = rows.filter(row => matchesHaizenSearch(row, next));
    const codes = new Set(matches.map(row => row.shelfCodeRaw));
    setQuery(next); setPadOpen(false);
    openShelf(codes.size === 1 ? matches[0].shelfCodeRaw : null);
  };
  const voice = useHaizenVoiceSearch(text => {
    const next = parseHaizenSpeech(text, rows);
    setToast(`聞き取り:「${text}」${next ? '' : ' — 一致する番号がありません'}`);
    if (next) runSearch(next);
  });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const updatedAt = Math.min(overview.dataUpdatedAt, master.dataUpdatedAt);
  const now = Date.now();
  const unavailable = !overview.data || !master.data;
  return <section className={`${invSurface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-inv-cyan`}>
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <Link to="/kiosk/inventory" className={invButtonGhost}>‹ 在庫へ</Link>
      {selected ? <>
        <button type="button" className={invButton} onClick={() => openShelf(null)}>棚の一覧へ</button>
        <nav aria-label="棚の移動" className="flex gap-2">
          <button type="button" className={invButton} disabled={index <= 0} onClick={() => openShelf(visibleShelves[index - 1].shelfCodeRaw)}>‹ 前の棚</button>
          <button type="button" className={invButton} disabled={index < 0 || index >= visibleShelves.length - 1} onClick={() => openShelf(visibleShelves[index + 1].shelfCodeRaw)}>次の棚 ›</button>
        </nav>
      </> : <h1 className={invTitle}>配膳の場所</h1>}
      <span className="flex-1" />
      <button type="button" className={invButton} disabled={unavailable || voice.status !== 'idle'} aria-expanded={padOpen} aria-haspopup="dialog" onClick={() => setPadOpen(true)}><SearchIcon />番号で探す</button>
      <button type="button" className={invButton} disabled={unavailable || voice.status === 'processing'} onClick={() => { setPadOpen(false); if (voice.status === 'recording') voice.stop(); else void voice.start(); }}>{voice.status === 'recording' ? '聞いています… 終了' : voice.status === 'processing' ? '認識中…' : <><MicIcon />声で探す</>}</button>
      {!selected && <div role="group" aria-label="写真の大きさ" className="inline-flex overflow-hidden rounded-xl border border-inv-line2">
        {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={size === value} className={`h-12 min-w-14 px-4 font-bold ${size === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'text-inv-muted'}`} onClick={() => setSize(value)}>{label}</button>)}
      </div>}
      <span className="text-sm tabular-nums text-inv-faint">{updatedAt ? `${time(updatedAt)} 更新` : '読込中…'}</span>
    </div>
    {voice.error && <p role="alert" className="text-inv-red">{voice.error}。番号で探すをご利用ください。</p>}
    {(overview.isError || master.isError) && <div role="alert" className="flex items-center gap-3 text-inv-red">配膳情報を更新できません。{!unavailable && '前回取得した情報を表示しています。'}<button type="button" className={invButton} onClick={() => { void overview.refetch(); void master.refetch(); }}>再読込</button></div>}
    {overview.data?.truncated && <p role="status" className="text-inv-muted">最新3,000件のみ表示しています。検索結果と空き表示は取得した範囲です。</p>}
    {query && <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 rounded-[14px] border border-inv-cyan bg-inv-cyan/10 px-4 py-2">
      <span className="text-sm text-inv-muted">{searchKinds[query.kind]}</span><strong className="font-mono text-2xl text-inv-cyan">{query.kind === 'machineName' ? normalizeMachineName(query.text) : query.text}</strong><span>{hits.length} 件 ・ {hitShelves.size} 棚</span><button type="button" className={`${invButton} ml-auto`} onClick={() => setQuery(null)}>やめる</button>
    </div>}
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-1">
      {unavailable ? <p className="py-12 text-center text-inv-muted">{overview.isError || master.isError ? '配膳情報を取得できません' : '配膳情報を読み込んでいます…'}</p> : selected ? <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className={`${invPanel} overflow-hidden lg:sticky lg:top-0`}>
          <HaizenShelfPhoto key={selected.shelfCodeRaw} shelf={selected} />
          <div className="space-y-1 px-5 py-4"><h1 className="text-3xl font-black">{selected.displayLabel || selected.shelfCodeRaw}</h1><p className="font-mono text-lg text-inv-muted">{selected.shelfCodeRaw}</p></div>
        </div>
        <div className={`${invPanel} flex min-w-0 flex-col gap-3 p-4`}>
          <div className="flex flex-wrap items-baseline gap-3"><h2 className="text-xl font-bold">この棚の部品</h2><span className="text-inv-muted">{items.length} 件 ・ 新しく置いた順</span></div>
          {items.length === 0 && <p className="py-12 text-center text-inv-muted">空き — この棚には何も置かれていません</p>}
          {items.map(row => {
            const siblings = [...new Set((grouped.byOrder.get(row.manufacturingOrderBarcodeRaw) ?? []).filter(other => other.branchNo !== row.branchNo && other.shelfCodeRaw !== row.shelfCodeRaw).map(other => other.shelfCodeRaw))];
            return <article key={row.id} aria-label={`${row.fhinmei || '品名未登録'} 枝${row.branchNo}`} className={`${invCard} grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 bg-inv-s2 px-4 py-3 ${hitIds.has(row.id) ? 'border-2 border-inv-cyan' : ''}`}>
              <h3 className="break-words text-[22px] font-black">{row.fhinmei || '品名未登録'}</h3>
              <div className="text-right text-sm tabular-nums text-inv-muted"><strong className="text-2xl text-inv-text">{timeSincePlaced(row.updatedAt, now)}</strong><br /><time dateTime={row.updatedAt}>{placedTime(row.updatedAt)}</time></div>
              <dl className="col-span-2 flex flex-wrap gap-x-5 gap-y-2">
                {([['fseiban', '製番', row.fseiban], ['fhincd', '品番', row.fhincd], ['machineName', '機種名', normalizeMachineName(row.machineName)], ['order', '製造オーダー', row.manufacturingOrderBarcodeRaw], ['branch', '枝', String(row.branchNo)]] as const).map(([kind, label, value]) => <div key={kind} className="flex items-baseline gap-2"><dt className="text-sm text-inv-muted">{label}</dt><dd className="break-all font-mono text-lg font-bold">{hitIds.has(row.id) && query?.kind === kind ? <mark className="rounded bg-inv-cyan px-1 text-inv-cyan-ink">{value || '—'}</mark> : value || '—'}</dd></div>)}
              </dl>
              {siblings.length > 0 && <div className="col-span-2 flex flex-wrap items-center gap-2 text-sm text-inv-muted">分けて置いた残りは{siblings.map(code => <button type="button" key={code} className={invButtonGhost} onClick={() => openShelf(code)}>{code} {shelves.find(shelf => shelf.shelfCodeRaw === code)?.displayLabel}</button>)}</div>}
            </article>;
          })}
        </div>
      </div> : visibleShelves.length === 0 ? <p className="py-12 text-center text-inv-muted">{query ? '一致する部品はどの棚にもありません' : '登録済みの棚はありません'}</p> : <div aria-label="棚の一覧" className={`grid auto-rows-max content-start gap-3 ${gridSizes[size]}`}>
        {visibleShelves.map(shelf => {
          const parts = grouped.byShelf.get(shelf.shelfCodeRaw) ?? [];
          const matching = parts.filter(row => hitIds.has(row.id));
          const preview = query ? [...matching, ...parts.filter(row => !hitIds.has(row.id))] : parts;
          const count = size === 'large' ? 5 : 3;
          return <button type="button" key={shelf.shelfCodeRaw} aria-label={`棚 ${shelf.shelfCodeRaw} ${shelf.displayLabel || ''}`} className={`${invCard} flex flex-col overflow-hidden text-left hover:border-inv-cyan ${matching.length ? 'border-2 border-inv-cyan' : ''}`} onClick={() => openShelf(shelf.shelfCodeRaw)}>
            <div className="relative w-full"><HaizenShelfPhoto shelf={shelf} dimmed={!parts.length} /><span className={`absolute left-2 top-2 rounded-lg px-3 py-1 text-2xl font-black ${matching.length ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-bg/90 text-inv-text'}`}>{query ? `${matching.length}件 一致` : `${parts.length}件`}</span><span className="absolute bottom-2 left-2 rounded-md bg-inv-bg/90 px-2 py-1 font-mono text-sm font-bold">{shelf.shelfCodeRaw}</span></div>
            <div className={`w-full space-y-1.5 px-3 py-3 ${parts.length ? '' : 'text-inv-faint'}`}><h2 className="text-lg font-black">{shelf.displayLabel || shelf.shelfCodeRaw}{!parts.length && ' ・ 空き'}</h2>
              {size !== 'small' && parts.length > 0 && <><ul className="space-y-1 text-sm">{preview.slice(0, count).map(row => <li key={row.id} className={`flex gap-2 ${hitIds.has(row.id) ? 'font-bold text-inv-cyan' : ''}`}><span className="shrink-0 font-mono">{row.fseiban || '—'}</span><span className="min-w-0 truncate">{row.fhinmei || '品名未登録'}</span></li>)}</ul>{parts.length > count && <p className="text-sm text-inv-faint">ほか {parts.length - count} 件</p>}</>}
            </div>
          </button>;
        })}
      </div>}
    </div>
    {padOpen && <HaizenSearchPad rows={rows} onSearch={runSearch} onClose={() => setPadOpen(false)} />}
    {toast && <div role="status" className={`${invPanel} fixed bottom-6 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 bg-inv-s3 px-5 py-3 text-lg font-bold`}>{toast}</div>}
  </section>;
}
