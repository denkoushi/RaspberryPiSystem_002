import { isAxiosError } from 'axios';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useDeleteHaizenPlacement, useHaizenOverview, useHaizenShelves } from '../../api/hooks/haizen-overview';
import { matchesHaizenSearch, normalizeHaizenSearch, parseHaizenSpeech, searchKinds, timeSincePlaced } from '../../features/kiosk/haizen/haizenSearch';
import { HaizenShelfHoverCard } from '../../features/kiosk/haizen/HaizenShelfHoverCard';
import { HaizenShelfPhoto } from '../../features/kiosk/haizen/HaizenShelfPhoto';
import { useHaizenVoiceSearch } from '../../features/kiosk/haizen/useHaizenVoiceSearch';
import { GridIcon, ListIcon, MicIcon } from '../../features/kiosk/inventory/InventoryIcons';
import { invButton, invButtonDanger, invButtonGhost, invCard, invPanel, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';
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

const UNREGISTERED_SHELF_LABEL = '棚マスタ未登録';

export function KioskHaizenPage() {
  const overview = useHaizenOverview();
  const master = useHaizenShelves();
  const [size, setSize] = useState<InventoryThumbnailSize>('medium');
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [listOrder, setListOrder] = useState<'shelf' | 'newest'>('shelf');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [search, setSearch] = useState<HaizenSearch>({ kind: 'fseiban', text: '' });
  const query = normalizeHaizenSearch(search.text) ? search : null;
  const deletion = useDeleteHaizenPlacement();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ shelf: MobilePlacementRegisteredShelfEntry; rect: DOMRect } | null>(null);
  const tooltipId = useId();
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTooltip = useCallback(() => { clearTimeout(tooltipTimer.current); setTooltip(null); }, []);
  const [toast, setToast] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = overview.data?.rows ?? emptyRows;
  useEffect(() => {
    hideTooltip();
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('pointerdown', hideTooltip, true);
    window.addEventListener('click', hideTooltip, true);
    return () => {
      clearTimeout(tooltipTimer.current);
      window.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('pointerdown', hideTooltip, true);
      window.removeEventListener('click', hideTooltip, true);
    };
  }, [hideTooltip, size, viewMode, selectedCode, search, rows, master.data]);
  const showTooltip = (shelf: MobilePlacementRegisteredShelfEntry, element: HTMLElement) => {
    hideTooltip();
    const rect = element.getBoundingClientRect();
    tooltipTimer.current = setTimeout(() => setTooltip({ shelf, rect }), 150);
  };
  const shelves = useMemo(() => {
    const registered = new Map<string, MobilePlacementRegisteredShelfEntry>((master.data?.shelves ?? []).map(shelf => [shelf.shelfCodeRaw, shelf]));
    // Legacy branches can reference shelves absent from today's master; their location must remain reachable.
    for (const row of rows) if (!registered.has(row.shelfCodeRaw)) registered.set(row.shelfCodeRaw, { shelfCodeRaw: row.shelfCodeRaw, isStructured: false, displayLabel: UNREGISTERED_SHELF_LABEL });
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
  const hitIds = new Set(hits.map(row => `${row.source}:${row.id}`));
  const hitShelves = new Set(hits.map(row => row.shelfCodeRaw));
  const visibleShelves = shelves.filter(shelf => !query || hitShelves.has(shelf.shelfCodeRaw));
  const listRows = (listOrder === 'shelf'
    ? shelves.flatMap(shelf => grouped.byShelf.get(shelf.shelfCodeRaw) ?? [])
    : [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
  ).filter(row => !query || hitIds.has(`${row.source}:${row.id}`));
  const selected = shelves.find(shelf => shelf.shelfCodeRaw === selectedCode);
  const items = selected ? grouped.byShelf.get(selected.shelfCodeRaw) ?? [] : [];
  const index = visibleShelves.findIndex(shelf => shelf.shelfCodeRaw === selectedCode);
  const openShelf = (code: string | null) => { hideTooltip(); setConfirmId(null); setSelectedCode(code); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const clearSearch = () => setSearch(current => ({ ...current, text: '' }));
  const deleteItem = async (row: HaizenOverviewRow) => {
    try {
      await deletion.mutateAsync(row);
      setConfirmId(null);
      setToast(`「${row.fhinmei || '品名未登録'}」を消しました`);
    } catch (error) {
      const message = isAxiosError<{ message?: string }>(error) ? error.response?.data?.message : undefined;
      setToast(message || (error instanceof Error ? error.message : '消せませんでした'));
    }
  };
  const voice = useHaizenVoiceSearch(text => {
    const next = parseHaizenSpeech(text, rows);
    setToast(`聞き取り:「${text}」${next ? '' : ' — 一致する番号がありません'}`);
    if (next) {
      setSearch(next);
      const matches = rows.filter(row => matchesHaizenSearch(row, next));
      openShelf(new Set(matches.map(row => row.shelfCodeRaw)).size === 1 ? matches[0].shelfCodeRaw : null);
    }
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
    <div className="flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap">
      <Link to="/kiosk/inventory" className={invButtonGhost}>‹ 在庫へ</Link>
      {selected ? <>
        <button type="button" className={invButton} onClick={() => openShelf(null)}>{viewMode === 'list' ? '一覧へ' : '棚の一覧へ'}</button>
        <nav aria-label="棚の移動" className="flex gap-2">
          <button type="button" className={invButton} disabled={index <= 0} onClick={() => openShelf(visibleShelves[index - 1].shelfCodeRaw)}>‹ 前の棚</button>
          <button type="button" className={invButton} disabled={index < 0 || index >= visibleShelves.length - 1} onClick={() => openShelf(visibleShelves[index + 1].shelfCodeRaw)}>次の棚 ›</button>
        </nav>
      </> : <h1 className={`${invTitle} shrink-0`}>配膳の場所</h1>}
      <span className="min-w-0 flex-1" />
      <div role="group" aria-label="探すもの" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
        {(Object.keys(searchKinds) as HaizenSearch['kind'][]).map(kind => <button key={kind} type="button" aria-pressed={search.kind === kind} className={`h-11 w-16 text-[15px] font-bold ${search.kind === kind ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-s2 text-inv-muted'}`} onClick={() => setSearch(current => ({ ...current, kind }))}>{searchKinds[kind]}</button>)}
      </div>
      <input aria-label="番号" placeholder="番号" value={search.text} maxLength={100} onChange={event => setSearch(current => ({ ...current, text: event.target.value }))} className={`h-11 w-[220px] shrink-0 rounded-xl border-2 bg-inv-bg px-2.5 font-mono text-2xl font-bold placeholder:text-base placeholder:text-inv-faint ${query ? 'border-inv-cyan' : 'border-inv-line2'}`} />
      <div role="group" aria-label="番号入力キー" className="flex shrink-0 flex-nowrap gap-1">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(key => <button key={key} type="button" className={`${invButton} w-[52px] px-0 font-mono text-[22px]`} onClick={() => setSearch(current => ({ ...current, text: (current.text + key).slice(0, 100) }))}>{key}</button>)}
        <button type="button" aria-label="1字消す" className={`${invButton} w-14 px-0 text-lg`} onClick={() => setSearch(current => ({ ...current, text: current.text.slice(0, -1) }))}>⌫</button>
        <button type="button" aria-label="全部消す" className={`${invButton} w-14 px-0 text-lg`} onClick={clearSearch}>C</button>
      </div>
      <button type="button" className={`${invButton} w-[124px] px-2`} disabled={unavailable || voice.status === 'processing'} onClick={() => { if (voice.status === 'recording') voice.stop(); else void voice.start(); }}>{voice.status === 'recording' ? '聞取終了' : voice.status === 'processing' ? '認識中…' : <><MicIcon />声で探す</>}</button>
      {!selected && <>
        {viewMode === 'card' ? <div role="group" aria-label="写真の大きさ" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
          {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={size === value} className={`h-11 w-14 font-bold ${size === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'text-inv-muted'}`} onClick={() => setSize(value)}>{label}</button>)}
        </div> : <div role="group" aria-label="並べ方" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
          {([['shelf', '棚順'], ['newest', '新しい順']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={listOrder === value} className={`h-11 w-24 font-bold ${listOrder === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'text-inv-muted'}`} onClick={() => setListOrder(value)}>{label}</button>)}
        </div>}
        <div role="group" aria-label="表示" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
          {([['card', 'カード表示', GridIcon], ['list', 'リスト表示', ListIcon]] as const).map(([view, label, ViewIcon]) => <button key={view} type="button" aria-label={label} title={label} aria-pressed={viewMode === view} className={`flex h-11 min-w-14 items-center justify-center px-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-inv-cyan ${viewMode === view ? 'bg-inv-cyan text-inv-cyan-ink' : 'text-inv-muted hover:bg-inv-s2'}`} onClick={() => setViewMode(view)}><ViewIcon size={24} /></button>)}
        </div>
      </>}
      <span className="w-[76px] shrink-0 text-[13px] tabular-nums text-inv-faint">{updatedAt ? `${time(updatedAt)} 更新` : '読込中…'}</span>
    </div>
    {voice.error && <p role="alert" className="text-inv-red">{voice.error}。番号を入力してください。</p>}
    {(overview.isError || master.isError) && <div role="alert" className="flex items-center gap-3 text-inv-red">配膳情報を更新できません。{!unavailable && '前回取得した情報を表示しています。'}<button type="button" className={invButton} onClick={() => { void overview.refetch(); void master.refetch(); }}>再読込</button></div>}
    {overview.data?.truncated && <p role="status" className="text-inv-muted">最新3,000件のみ表示しています。検索結果と空き表示は取得した範囲です。</p>}
    {query && <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 rounded-[14px] border border-inv-cyan bg-inv-cyan/10 px-4 py-2">
      <span className="text-sm text-inv-muted">{searchKinds[query.kind]}</span><strong className="font-mono text-2xl text-inv-cyan">{query.kind === 'machineName' ? normalizeMachineName(query.text) : query.text}</strong><span>を含む {hits.length} 件 ・ {hitShelves.size} 棚</span><button type="button" className={`${invButton} ml-auto`} onClick={clearSearch}>やめる</button>
    </div>}
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-1">
      {unavailable ? <p className="py-12 text-center text-inv-muted">{overview.isError || master.isError ? '配膳情報を取得できません' : '配膳情報を読み込んでいます…'}</p> : selected ? <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className={`${invPanel} overflow-hidden lg:sticky lg:top-0`}>
          <HaizenShelfPhoto key={selected.shelfCodeRaw} shelf={selected} />
          <div className="space-y-1 px-5 py-4"><h1 className="text-3xl font-black">{selected.displayLabel || selected.shelfCodeRaw}</h1>{selected.displayLabel === UNREGISTERED_SHELF_LABEL && <p className="font-mono text-lg text-inv-muted">{selected.shelfCodeRaw}</p>}</div>
        </div>
        <div className={`${invPanel} flex min-w-0 flex-col gap-3 p-4`}>
          <div className="flex flex-wrap items-baseline gap-3"><h2 className="text-xl font-bold">この棚の部品</h2><span className="text-inv-muted">{items.length} 件 ・ 新しく置いた順</span></div>
          {items.length === 0 && <p className="py-12 text-center text-inv-muted">空き — この棚には何も置かれていません</p>}
          {items.map(row => {
            const siblings = [...new Set((grouped.byOrder.get(row.manufacturingOrderBarcodeRaw) ?? []).filter(other => other.branchNo !== row.branchNo && other.shelfCodeRaw !== row.shelfCodeRaw).map(other => other.shelfCodeRaw))];
            return <article key={`${row.source}:${row.id}`} aria-label={`${row.fhinmei || '品名未登録'} 分配${row.branchNo === 0 ? 'なし' : row.branchNo ?? '—'}`} className={`${invCard} grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-2 bg-inv-s2 px-4 py-3 ${hitIds.has(`${row.source}:${row.id}`) ? 'border-2 border-inv-cyan' : ''}`}>
              <h3 className="break-words text-[22px] font-black">{row.fhinmei || '品名未登録'}</h3>
              <div className="text-right text-sm tabular-nums text-inv-muted"><strong className="text-2xl text-inv-text">{timeSincePlaced(row.updatedAt, now)}</strong><br /><time dateTime={row.updatedAt}>{placedTime(row.updatedAt)}</time></div>
              <button type="button" aria-label="消す" disabled={deletion.isPending} className="flex h-12 w-12 items-center justify-center rounded-xl border border-inv-line2 bg-inv-s1 text-xl text-inv-muted hover:border-inv-red hover:text-inv-red disabled:opacity-40" onClick={() => setConfirmId(`${row.source}:${row.id}`)}>🗑</button>
              <dl className="col-span-full flex flex-wrap gap-x-5 gap-y-2">
                {([['fseiban', '製番', row.fseiban], ['fhincd', '品番', row.fhincd], ['machineName', '機種名', normalizeMachineName(row.machineName)], ['order', '製造オーダー', row.manufacturingOrderBarcodeRaw], ['branch', '分配', row.branchNo === null ? '—' : row.branchNo === 0 ? 'なし' : String(row.branchNo)]] as const).map(([kind, label, value]) => <div key={kind} className="flex items-baseline gap-2"><dt className="text-sm text-inv-muted">{label}</dt><dd className="break-all font-mono text-lg font-bold">{hitIds.has(`${row.source}:${row.id}`) && query?.kind === kind ? <mark className="rounded bg-inv-cyan px-1 text-inv-cyan-ink">{value || '—'}</mark> : value || '—'}</dd></div>)}
              </dl>
              {siblings.length > 0 && <div className="col-span-full flex flex-wrap items-center gap-2 text-sm text-inv-muted">分けて置いた残りは{siblings.map(code => <button type="button" key={code} className={invButtonGhost} onClick={() => openShelf(code)}>{shelves.find(shelf => shelf.shelfCodeRaw === code)?.displayLabel || code}</button>)}</div>}
              {confirmId === `${row.source}:${row.id}` && <div className="col-span-full flex flex-wrap items-center gap-3 border-t border-inv-line pt-2">
                <strong className="mr-auto text-inv-red">この品物を消しますか？</strong>
                <button type="button" className={invButtonDanger} disabled={deletion.isPending} onClick={() => void deleteItem(row)}>🗑 消す</button>
                <button type="button" className={invButton} disabled={deletion.isPending} onClick={() => setConfirmId(null)}>やめる</button>
              </div>}
            </article>;
          })}
        </div>
      </div> : visibleShelves.length === 0 ? <p className="py-12 text-center text-inv-muted">{query ? '一致する部品はどの棚にもありません' : '登録済みの棚はありません'}</p> : viewMode === 'list' ? listRows.length === 0 ? <p className="py-12 text-center text-inv-muted">どの棚にも何も置かれていません</p> : <div className={`${invPanel} max-h-full overflow-x-auto`}>
        <table aria-label="配膳の一覧" className="w-full min-w-[1100px] border-collapse text-left tabular-nums">
          <thead className="sticky top-0 z-10 bg-inv-s2 text-[15px] text-inv-muted">
            <tr>{['棚', '品名', '製番', '品番', '機種名', '製造オーダー', '分配', '置いた日時'].map(label => <th key={label} scope="col" className={`whitespace-nowrap px-3.5 py-3 ${label === '置いた日時' ? 'text-right' : ''}`}>{label}</th>)}</tr>
          </thead>
          <tbody>{listRows.map((row, rowIndex) => {
            const shelf = shelves.find(entry => entry.shelfCodeRaw === row.shelfCodeRaw);
            const label = shelf?.displayLabel || row.shelfCodeRaw;
            const sameShelf = listOrder === 'shelf' && rowIndex > 0 && listRows[rowIndex - 1].shelfCodeRaw === row.shelfCodeRaw;
            const shelfBoundary = listOrder === 'shelf' && rowIndex > 0 && !sameShelf;
            return <tr key={`${row.source}:${row.id}`} onClick={() => openShelf(row.shelfCodeRaw)} className={`cursor-pointer border-inv-line hover:bg-inv-cyan/10 ${shelfBoundary ? 'border-t-2' : 'border-t'} ${query ? 'bg-inv-cyan/10' : ''}`}>
              <td className="px-3.5 py-3 font-mono text-[20px] font-bold">
                <button type="button" aria-label={`棚 ${row.shelfCodeRaw} ${label}`} className={`rounded text-left focus-visible:text-inv-text ${sameShelf ? 'text-transparent' : ''}`} onClick={event => { event.stopPropagation(); openShelf(row.shelfCodeRaw); }}>{label}</button>
              </td>
              <td className={`px-3.5 py-3 text-[22px] font-black ${query ? 'text-inv-cyan' : ''}`}>{row.fhinmei || '品名未登録'}</td>
              {([['fseiban', row.fseiban], ['fhincd', row.fhincd], ['machineName', normalizeMachineName(row.machineName)], ['order', row.manufacturingOrderBarcodeRaw], ['branch', row.branchNo === null ? '—' : row.branchNo === 0 ? 'なし' : String(row.branchNo)]] as const).map(([kind, value]) => <td key={kind} className="px-3.5 py-3 font-mono text-[19px] font-bold">{query?.kind === kind ? <mark className="rounded bg-inv-cyan px-1 text-inv-cyan-ink">{value || '—'}</mark> : value || '—'}</td>)}
              <td className="whitespace-nowrap px-3.5 py-3 text-right text-sm text-inv-muted"><strong className="text-2xl text-inv-text">{timeSincePlaced(row.updatedAt, now)}</strong><br /><time dateTime={row.updatedAt}>{placedTime(row.updatedAt)}</time></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div aria-label="棚の一覧" className={`grid auto-rows-max content-start gap-3 ${gridSizes[size]}`}>
        {visibleShelves.map(shelf => {
          const parts = grouped.byShelf.get(shelf.shelfCodeRaw) ?? [];
          const matching = parts.filter(row => hitIds.has(`${row.source}:${row.id}`));
          return <button type="button" key={shelf.shelfCodeRaw} aria-label={`棚 ${shelf.shelfCodeRaw} ${shelf.displayLabel || ''}`}
            aria-describedby={tooltip?.shelf.shelfCodeRaw === shelf.shelfCodeRaw ? tooltipId : undefined}
            onPointerEnter={event => { if (event.pointerType !== 'touch' && (window.matchMedia?.('(hover: hover)').matches ?? true)) showTooltip(shelf, event.currentTarget); }}
            onPointerLeave={hideTooltip}
            onFocus={event => { if (event.target.matches(':focus-visible')) showTooltip(shelf, event.currentTarget); }}
            onBlur={hideTooltip}
            className={`${invCard} flex flex-col overflow-hidden text-left transition-[transform,opacity,box-shadow] duration-150 motion-reduce:transition-none hover:border-inv-cyan ${matching.length ? 'border-2 border-inv-cyan' : ''} ${tooltip?.shelf.shelfCodeRaw === shelf.shelfCodeRaw ? '-translate-y-0.5 ring-2 ring-inv-cyan shadow-xl' : tooltip ? 'opacity-[.55]' : ''}`} onClick={() => openShelf(shelf.shelfCodeRaw)}>
            <div className="relative w-full"><HaizenShelfPhoto shelf={shelf} dimmed={!parts.length} /><span className={`absolute left-2 top-2 rounded-lg px-3 py-1 text-2xl font-black ${matching.length ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-bg/90 text-inv-text'}`}>{query ? `${matching.length}件 一致` : parts.length ? `${parts.length}件` : '空き'}</span></div>
            <h2 className={`w-full truncate px-3 py-3 font-mono text-lg font-bold ${parts.length ? '' : 'text-inv-faint'}`}>{shelf.displayLabel || shelf.shelfCodeRaw}</h2>
          </button>;
        })}
      </div>}
    </div>
    {tooltip && <HaizenShelfHoverCard key={tooltip.shelf.shelfCodeRaw} id={tooltipId} {...tooltip} rows={grouped.byShelf.get(tooltip.shelf.shelfCodeRaw) ?? []} hitIds={hitIds} />}
    {toast && <div role="status" className={`${invPanel} fixed bottom-6 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 bg-inv-s3 px-5 py-3 text-lg font-bold`}>{toast}</div>}
  </section>;
}
