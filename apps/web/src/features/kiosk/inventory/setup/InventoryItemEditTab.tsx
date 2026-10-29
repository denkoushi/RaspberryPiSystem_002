import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { splitArea } from '@raspi-system/shelf-layout-core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { inventoryThumbnailUrl, resolveInventoryTag, type InventoryCompartment, type InventoryOptionField, type InventoryShelf } from '../../../../api/client';
import { useInventoryItems, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';
import { InventoryPhotoReadDialog } from '../../../../components/kiosk/InventoryPhotoReadDialog';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { compartmentLocationText, unitLabel } from '../inventoryDailyFlow';
import { ArrowLeftIcon, ArrowRightIcon, RotateRightIcon, CheckIcon, PinIcon, PlusIcon, TrashIcon } from '../InventoryIcons';
import {
  invSetupTargets,
  invButtonDanger,
  invButtonGhost,
  invButtonPrimary,
  invButtonSm,
  invButtonSmGhost,
  invError,
  invEyebrow,
  invField,
  invKey,
  invKeyUtil,
  invPanel,
  invLabelNumber,
  invSeg,
  invSuccess,
} from '../inventoryUi';

import { InventoryUnitPicker } from './InventoryUnitPicker';
import { NfcScanPanel } from './NfcScanPanel';
import { setupTagErrorText, setupErrorText as errorText } from './setupError';
import { touchSetupPin } from './setupPinSession';
import { isProvisionalInventoryName, TOOL_BOARD_COLUMNS, ToolValueBoard } from './ToolValueBoard';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

type Panel =
  | { kind: 'none' }
  | { kind: 'move'; compartment: InventoryCompartment }
  | { kind: 'add-place'; area: string | null; shelfId: string | null }
  | { kind: 'add-tag'; shelfId: string; drawerId: string }
  | { kind: 'add-quantity'; shelfId: string; drawerId: string; uid: string; quantity: string }
  | { kind: 'replace-tag'; compartment: InventoryCompartment }
  | { kind: 'delete-item' };

const DETAIL_LABEL = Object.fromEntries(TOOL_BOARD_COLUMNS.map((column) => [column.key, column.label])) as Record<InventoryOptionField, string>;
const provisionalTag = 'shrink-0 rounded-[5px] bg-inv-amber/[0.12] px-1.5 text-[10.5px] font-bold tracking-[0.08em] text-inv-amber';
const iconSm = `${invButtonSm} w-11 px-0`;

const tagTail = (uid: string | null) => uid ? `…${uid.slice(-5)}` : 'タグなし';
const placeText = (place: InventoryCompartment) => `${place.area}・棚${place.shelfNumber}・引き出し${place.drawerNumber}`;
function highlight(text: string, needle: string) {
  if (!needle) return text;
  const start = text.normalize('NFKC').toLowerCase().indexOf(needle);
  if (start < 0) return text;
  // Map normalized search positions back to the original spelling (e.g. half-width kana).
  let from = 0;
  let to = text.length;
  for (let index = 0; index <= text.length; index += 1) {
    const length = text.slice(0, index).normalize('NFKC').toLowerCase().length;
    if (length <= start) from = index;
    if (length >= start + needle.length) {
      to = index;
      while (to < text.length && text.slice(0, to + 1).normalize('NFKC').toLowerCase().length === length) to += 1;
      break;
    }
  }
  return <>{text.slice(0, from)}<mark className="rounded bg-inv-cyan/25 text-inherit">{text.slice(from, to)}</mark>{text.slice(to)}</>;
}

// 1つの引き出しに複数のアイテムを置けるので、移す先から外すのはいま入っている引き出しだけ。
function otherDrawers(shelf: InventoryShelf, compartmentId: string) {
  return shelf.drawers.filter((drawer) => !drawer.compartments.some((compartment) => compartment.id === compartmentId));
}

export function InventoryItemEditTab({ accessPassword }: { accessPassword: string }) {
  const itemsQuery = useInventoryItems();
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword, true);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const shelves = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const [itemId, setItemId] = useState<string | null>(null);
  const item = items.find((entry) => entry.id === itemId) ?? null;
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [photoIndex, setPhotoIndex] = useState(0);
  const [confirmPhotoId, setConfirmPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState('place');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanPending, setScanPending] = useState(false);
  const scanBusy = useRef(false);
  const [done, setDone] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const [swapped, setSwapped] = useState<{ id: string; oldUid: string | null; uid: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [provisionalOnly, setProvisionalOnly] = useState(false);
  // The last name or tool-information change, shown on the board with a way back.
  const [detailValues, setDetailValues] = useState<Partial<Record<InventoryOptionField, string>>>({});
  const [readDrafts, setReadDrafts] = useState<Partial<Record<InventoryOptionField, string>>>({});
  const detailQueue = useRef<Promise<void>>(Promise.resolve());
  const detailPending = useRef<Partial<Record<InventoryOptionField, number>>>({});
  // Keep successive taps together while the existing mutation refreshes the item list.
  useEffect(() => {
    if (!item) return;
    setDetailValues((current) => {
      const settled = TOOL_BOARD_COLUMNS.filter(({ key }) => !detailPending.current[key] && key in current && current[key] === (item[key] ?? ''));
      if (settled.length === 0) return current;
      const next = { ...current };
      for (const { key } of settled) delete next[key];
      return next;
    });
  }, [item, detailValues]);
  const [detail, setDetail] = useState<{ text: string; undo: { field: InventoryOptionField; value: string } | null; field: InventoryOptionField } | { error: string; field: InventoryOptionField } | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const scanMode = panel.kind === 'add-tag' ? 'add' : panel.kind === 'replace-tag' ? 'replace'
    : panel.kind === 'none' && !inputFocused && !selectedPhoto && !confirmPhotoId ? 'open' : null;
  const scanModeRef = useRef(scanMode);
  scanModeRef.current = scanMode;
  // Bumped on every open; a tag lookup that started before a manual pick must not replace it.
  const openCountRef = useRef(0);
  const read = useArmedNfcRead(scanMode !== null && !scanPending);
  const handledRef = useRef<NfcEvent | null>(null);
  const pending = scanPending || mutations.setItemUnit.isPending || mutations.move.isPending || mutations.bindCompartment.isPending || mutations.deleteItemPhoto.isPending
    || mutations.rotateItemPhoto.isPending || mutations.reorderItemPhotos.isPending || mutations.deleteItem.isPending;

  useEffect(() => {
    if (!read || !scanMode || handledRef.current === read || scanBusy.current) return;
    handledRef.current = read;
    touchSetupPin();
    if (scanMode === 'add' && panel.kind === 'add-tag') {
      setPanel({ kind: 'add-quantity', shelfId: panel.shelfId, drawerId: panel.drawerId, uid: read.uid, quantity: '' });
      return;
    }
    scanBusy.current = true;
    setScanPending(true);
    const scan = async () => {
      try {
        if (scanMode === 'replace' && panel.kind === 'replace-tag') {
          setError(null);
          setErrorAt('tag');
          await replaceTag(panel.compartment, read.uid);
        } else if (scanMode === 'open') {
          const openCount = openCountRef.current;
          const tag = await resolveInventoryTag(read.uid);
          if (scanModeRef.current !== 'open' || openCountRef.current !== openCount) return;
          if (tag?.kind === 'ITEM' && tag.compartment) {
            if (!itemsQuery.isLoading && !items.some((entry) => entry.id === tag.compartment?.item.id)) await itemsQuery.refetch({ throwOnError: true });
            if (scanModeRef.current !== 'open' || openCountRef.current !== openCount) return;
            open(tag.compartment.item.id);
            setFilter('');
            setProvisionalOnly(false);
            setDepartment(null);
            setScanMessage('品物を開きました');
          } else setScanMessage(!tag ? '未登録のタグです' : tag.kind === 'QUANTITY' ? '数量タグです' : tag.kind === 'RESTOCK' ? '補充タグです' : '品物が見つかりません');
        }
      } catch (caught) {
        if (panel.kind === 'replace-tag') setError(setupTagErrorText(caught));
        else setScanMessage(errorText(caught));
      } finally {
        scanBusy.current = false;
        setScanPending(false);
      }
    };
    void scan();
    // A read is the trigger; mode changes must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);

  const replaceTag = async (compartment: InventoryCompartment, uid: string) => {
    await mutations.replaceTag.mutateAsync({ id: compartment.id, uid });
    setSwapped({ id: compartment.id, oldUid: compartment.itemTagUid, uid });
    setDone(`${placeText(compartment)} のタグを交換しました`);
    setPanel({ kind: 'none' });
  };

  const run = async (work: () => Promise<unknown>, message: string, next: Panel = { kind: 'none' }, target = 'place') => {
    setError(null);
    setErrorAt(target);
    setDone(null);
    try {
      await work();
      setDone(message);
      setPanel(next);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const open = (id: string | null) => {
    openCountRef.current += 1;
    setItemId(id);
    setPhotoIndex(0);
    setSwapped(null);
    setPanel({ kind: 'none' });
    setConfirmPhotoId(null);
    setError(null);
    setDone(null);
    setDetail(null);
    setDetailValues({});
    setReadDrafts({});
    setSelectedPhoto(null);
    detailPending.current = {};
  };

  const needle = filter.normalize('NFKC').trim().toLowerCase();
  const provisionalCount = items.filter((entry) => isProvisionalInventoryName(entry.name)).length;
  const departments = [...new Set([...shelves.map(shelf => splitArea(shelf.area).machine), ...items.flatMap(entry => entry.compartments.map(place => splitArea(place.area).machine))])].sort((a, b) => a.localeCompare(b, 'ja'));
  const base = items.filter((entry) => {
    // The open item stays listed after it gets a real name.
    if (provisionalOnly && !isProvisionalInventoryName(entry.name) && entry.id !== itemId) return false;
    return !needle || [entry.name, entry.itemCode, entry.model ?? '', ...entry.compartments.map(place => formatInventoryLabelNumber(place.labelNumber))].some(text => text.normalize('NFKC').toLowerCase().includes(needle));
  }).map(entry => ({ entry, place: entry.compartments.find(place => needle && formatInventoryLabelNumber(place.labelNumber).includes(needle)) ?? entry.compartments[0] }));
  const shown = base.filter(({ place }) => department === null || splitArea(place?.area ?? '').machine === department);
  const groups = new Map<string, typeof shown>();
  for (const row of shown) {
    const key = row.place ? `${row.place.area}・棚${row.place.shelfNumber}` : '置き場所なし';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const sortedGroups = [...groups].sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }));
  const banner = (
    <div className="flex h-12 shrink-0 items-center gap-3 overflow-hidden">
        {done ? <p className={`rounded-xl border px-3 py-2 text-base font-bold ${invSuccess}`} role="status">{done}</p> : null}

    </div>
  );
  const localError = (target: string) => error && errorAt === target ? <p role="alert" className="text-sm text-[#ffd0d0]">{error}</p> : null;
  const list = (
    <nav className="flex min-h-0 flex-col gap-1.5" aria-label="アイテム一覧">
      <div className="mb-1 flex shrink-0 gap-1.5">
        <input aria-label="品名・型式・番号で探す" placeholder="品名・型式・番号で探す" className={`${invField} h-11 min-w-0 flex-1`} value={filter} onChange={(event) => setFilter(event.target.value)} />
        <button type="button" aria-pressed={provisionalOnly} aria-label={`仮名だけ ${provisionalCount}件`} className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-bold ${provisionalOnly ? 'border-inv-amber bg-inv-amber/[0.12] text-[#ffe8bf]' : 'border-inv-line2 bg-inv-s2 text-inv-muted hover:bg-inv-s3'}`} onClick={() => setProvisionalOnly((on) => !on)}>
            仮名 <b className="tabular-nums text-inv-amber">{provisionalCount}</b>
        </button>
      </div>
      <div className="grid shrink-0 gap-1 overflow-x-auto rounded-xl bg-inv-s2 p-[3px]" style={{ gridTemplateColumns: `repeat(${departments.length + 1}, minmax(76px, 1fr))` }} role="group" aria-label="課">
        {[null, ...departments].map(machine => <button key={machine ?? 'all'} type="button" aria-pressed={department === machine} className={`flex h-11 min-w-0 flex-col items-center justify-center rounded-[9px] text-[13px] font-bold leading-tight ${department === machine ? `bg-inv-s3 text-inv-text ring-1 ring-inset ${machine === '生産技術課' ? 'ring-[#a99bff]' : 'ring-inv-cyan'}` : 'text-inv-muted'}`} onClick={() => setDepartment(machine)}>
          {machine ?? 'すべて'}<small className="text-[11px] font-normal tabular-nums text-inv-faint">{base.filter(({ place }) => machine === null || splitArea(place?.area ?? '').machine === machine).length}件</small>
        </button>)}
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto pb-0.5" aria-label="棚へ移動">
        {sortedGroups.map(([key]) => <button key={key} type="button" className="h-9 shrink-0 whitespace-nowrap rounded-lg border border-inv-line bg-inv-s1 px-2.5 text-[12.5px] font-bold text-inv-muted hover:bg-inv-s2" onClick={() => groupRefs.current.get(key)?.scrollIntoView({ block: 'start' })}>{key}</button>)}
      </div>
      <div className="h-8 shrink-0 overflow-hidden text-sm leading-4"><p role={scanMessage || scanPending ? 'status' : undefined} className="line-clamp-2 text-inv-muted">{scanPending ? 'タグを確認中…' : scanMessage ?? '品物タグでも開けます'}</p></div>
      {itemsQuery.isLoading ? <p className="text-inv-faint">読み込み中…</p> : null}
      {!itemsQuery.isLoading && items.length === 0 ? <p className="text-inv-faint">登録済みのアイテムはありません</p> : null}
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {sortedGroups.map(([key, rows]) => <div key={key} className="contents">
          <div ref={node => { if (node) groupRefs.current.set(key, node); else groupRefs.current.delete(key); }} className="sticky top-0 z-10 flex h-[30px] shrink-0 items-center gap-2 border-b border-inv-line bg-inv-bg px-2 text-[12.5px] font-black text-inv-muted">
            <span className={`h-2 w-2 rounded-sm ${splitArea(rows[0].place?.area ?? '').machine === '生産技術課' ? 'bg-[#a99bff]' : 'bg-inv-cyan'}`} aria-hidden="true" />
            <span>{key}</span><span className="ml-auto font-normal tabular-nums text-inv-faint">{rows.length}件</span>
          </div>
          {rows.map(({ entry, place }) => {
            const on = entry.id === item?.id;
            return <button key={entry.id} type="button" aria-pressed={on} className={`flex h-14 shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm font-bold ${on ? 'border-2 border-inv-cyan bg-inv-cyan/[0.12]' : 'border border-inv-line bg-inv-s1 hover:bg-inv-s2'}`} onClick={() => open(entry.id)}>
              {entry.photos[0] ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(entry.photos[0].photoUrl)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-lg bg-inv-s3" aria-hidden="true" />}
              <span className="min-w-0 flex-1 line-clamp-2 break-all">{highlight(entry.name, needle)}</span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                {place ? <span className={invLabelNumber}>{highlight(formatInventoryLabelNumber(place.labelNumber), needle)}</span> : null}
                {isProvisionalInventoryName(entry.name) ? <span className={provisionalTag}>仮名</span> : <span className="text-xs font-normal tabular-nums text-inv-faint">{place ? `引${place.drawerNumber} ・ ${place.stockQuantity}${unitLabel(entry)}` : '置き場所なし'}</span>}
              </span>
            </button>;
          })}
        </div>)}
        {shown.length === 0 && items.length > 0 ? <p className="py-4 text-inv-faint">見つかりません</p> : null}
      </div>
    </nav>
  );

  if (!item) {
    return (
      <div className={`${invSetupTargets} flex min-h-0 flex-1 flex-col gap-3 pt-4`}
        onFocusCapture={(event) => { if (event.target instanceof HTMLInputElement) setInputFocused(true); }}
        onBlurCapture={(event) => { if (event.target instanceof HTMLInputElement) setInputFocused(false); }}
      >
        {done ? banner : null}
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-5">
          {list}
          <p className="self-center justify-self-center text-inv-faint">左の一覧からアイテムを選んでください</p>
        </div>
      </div>
    );
  }

  const movePhoto = (index: number, offset: -1 | 1) => {
    const ids = item.photos.map((photo) => photo.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => mutations.reorderItemPhotos.mutateAsync({ itemId: item.id, photoIds: ids }), '写真の順番を変えました', { kind: 'none' }, 'photos');
  };

  const areas = [...new Set(shelves.map((shelf) => shelf.area))].sort((a, b) => a.localeCompare(b, 'ja'));
  const details = Object.fromEntries(TOOL_BOARD_COLUMNS.map((column) => [column.key, detailValues[column.key] ?? item[column.key] ?? ''])) as Record<InventoryOptionField, string>;
  const changeDetail = async (field: InventoryOptionField, value: string, undoable = true) => {
    setReadDrafts(current => { const next = { ...current }; delete next[field]; return next; });
    const previous = details[field];
    const generation = openCountRef.current;
    const pendingCounts = detailPending.current;
    pendingCounts[field] = (pendingCounts[field] ?? 0) + 1;
    const before = detailQueue.current;
    let finish!: () => void;
    detailQueue.current = new Promise<void>((resolve) => { finish = resolve; });
    setDetailValues((current) => ({ ...current, [field]: value }));
    setDetail(null);
    await before;
    try {
      await mutations.updateItemDetails.mutateAsync({ itemId: item.id, details: { [field]: value } });
      if (openCountRef.current !== generation) return;
      setDetail({ field, text: value ? `${DETAIL_LABEL[field]}を「${value}」にしました` : `${DETAIL_LABEL[field]}を空にしました`, undo: undoable ? { field, value: previous } : null });
    } catch (caught) {
      if (openCountRef.current !== generation) return;
      setDetailValues((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
      setDetail({ field, error: errorText(caught) });
    } finally {
      pendingCounts[field] = (pendingCounts[field] ?? 1) - 1;
      // Reconcile even if the final refetch already matched before the promise settled.
      if (openCountRef.current === generation) setDetailValues((current) => ({ ...current }));
      finish();
    }
  };
  const detailStatus = !detail ? null : 'error' in detail
    ? <p className={`min-w-0 truncate rounded-lg border px-2.5 py-1 text-[13px] ${invError}`} role="alert">{detail.error}</p>
    : (
      <p className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-[#d7fbe9]" role="status">
        <span className="text-inv-green"><CheckIcon /></span>
        <span className="truncate">{detail.text}</span>
        {detail.undo ? <button type="button" className="inline-flex h-11 min-w-11 shrink-0 items-center rounded-lg border border-inv-line2 px-2.5 text-xs font-bold text-inv-muted hover:bg-inv-s2 hover:text-inv-text" onClick={() => void changeDetail(detail.undo!.field, detail.undo!.value, false)}>元に戻す</button> : null}
      </p>
    );
  const subPanel = 'flex flex-col gap-2.5 rounded-xl border border-inv-cyan/40 bg-inv-bg p-3';
  const index = photoIndex % (item.photos.length || 1);
  const photo = item.photos[index];

  return (
    <div className={`${invSetupTargets} flex min-h-0 flex-1 flex-col gap-3 pt-4`}
        onFocusCapture={(event) => { if (event.target instanceof HTMLInputElement) setInputFocused(true); }}
        onBlurCapture={(event) => { if (event.target instanceof HTMLInputElement) setInputFocused(false); }}
      >
      {done ? banner : null}
      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-5">
        {list}

        <div className="flex min-h-0 min-w-0 flex-col gap-3.5">
        <div className="relative grid h-[250px] shrink-0 grid-cols-[400px_minmax(0,1fr)] gap-3.5">
          <section className={`${invPanel} relative min-h-0 overflow-hidden`} aria-label="写真">
            {photo ? <button type="button" className="block h-full w-full" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto(photo.id)}>
              <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-full w-full object-cover" />
            </button> : <p className="p-4 text-inv-faint">写真はありません</p>}
            {item.photos.length > 1 ? <>
              {([-1, 1] as const).map((offset) => <button key={offset} type="button" aria-label={offset === -1 ? '前の写真' : '次の写真'} className={`absolute bottom-2 flex h-11 w-11 items-center justify-center rounded-lg border border-inv-line2 bg-inv-bg/75 text-xl ${offset === -1 ? 'left-2' : 'left-[60px]'}`} onClick={() => { setPhotoIndex((index + offset + item.photos.length) % item.photos.length); setConfirmPhotoId(null); }}>{offset === -1 ? '＜' : '＞'}</button>)}
              <span className="absolute bottom-2 right-2 rounded-md bg-inv-bg/75 px-2 text-sm font-bold tabular-nums">{index + 1}/{item.photos.length}</span>
            </> : null}
          </section>
          <div className={`${invPanel} flex min-h-0 min-w-0 flex-col gap-2 p-3`}>
            <div className="flex h-11 shrink-0 items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-[22px] font-black">{item.name}</h2>
              {isProvisionalInventoryName(item.name) ? <span className={provisionalTag}>仮名</span> : null}
              <span className="font-mono text-[13px] text-inv-faint">{item.itemCode}</span>
          <section className="shrink-0" aria-label="アイテムの削除">
            {panel.kind === 'delete-item' ? (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-xl border border-inv-red/40 bg-inv-bg p-6">
                <div className="flex items-center gap-3">
                <p className="text-[15px] text-[#ffd0d0]">「{item.name}」を削除しますか？ 履歴は残ります。</p>
                <button type="button" className={`${invButtonDanger} border-inv-red bg-inv-red/15`} disabled={pending} onClick={() => void run(async () => { await mutations.deleteItem.mutateAsync(item.id); setItemId(null); }, `「${item.name}」を削除しました`, { kind: 'none' }, 'delete')}>削除する</button>
                <button type="button" className={invButtonGhost} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
                </div>
                {localError('delete')}
              </div>
            ) : (
              <button type="button" className={invButtonDanger} disabled={pending} onClick={() => setPanel({ kind: 'delete-item' })}><TrashIcon />アイテムを削除</button>
            )}
            {panel.kind !== 'delete-item' ? localError('delete') : null}
          </section>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <section className="flex min-w-0 flex-1 items-center gap-2 [&_[role=group]]:flex-nowrap [&_[role=group]]:overflow-x-auto [&_[role=group]>div:empty]:hidden" aria-label="単位の設定">
                <h3 className={invEyebrow}>単位</h3>
                <InventoryUnitPicker value={item.unit} accessPassword={accessPassword} disabled={mutations.setItemUnit.isPending} onChange={(unit) => { if (unit !== unitLabel(item)) void run(() => mutations.setItemUnit.mutateAsync({ itemId: item.id, unit }), `単位を「${unit}」にしました`, { kind: 'none' }, 'unit'); }} />
                {localError('unit')}
              </section>
              <form key={`${item.id}:${item.unitPrice}`} className="flex shrink-0 items-center gap-2" onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem('unitPrice') as HTMLInputElement;
                const unitPrice = input.value === '' ? null : Number(input.value);
                if (unitPrice !== (item.unitPrice ?? null)) void run(() => mutations.updateItemDetails.mutateAsync({ itemId: item.id, details: { unitPrice } }), '単価を保存しました', { kind: 'none' }, 'price');
              }}>
                <label htmlFor="inventory-unit-price" className={invEyebrow}>単価</label>
                <input id="inventory-unit-price" name="unitPrice" type="number" inputMode="numeric" min="0" max="10000000" step="1" defaultValue={item.unitPrice ?? ''} placeholder="未設定" className={`${invField} h-11 w-28`} />
                <span className="text-sm text-inv-muted">円 / {unitLabel(item)}</span>
                <button type="submit" className={invButtonSm} disabled={mutations.updateItemDetails.isPending}>保存</button>
                {localError('price')}
              </form>
              {photo ? <div className="flex shrink-0 items-center gap-1.5" aria-label="写真の操作">
                <span className={invEyebrow}>写真</span>
                <button type="button" className={iconSm} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || pending} onClick={() => movePhoto(index, -1)}><ArrowLeftIcon /></button>
                <button type="button" className={iconSm} aria-label={`写真${index + 1}を後ろへ`} disabled={index === item.photos.length - 1 || pending} onClick={() => movePhoto(index, 1)}><ArrowRightIcon size={16} /></button>
                <button type="button" className={iconSm} aria-label={`写真${index + 1}を右に回す`} title={`写真${index + 1}を右に回す`} disabled={pending} onClick={() => void run(() => mutations.rotateItemPhoto.mutateAsync({ itemId: item.id, photoId: photo.id }), '写真を回しました', { kind: 'none' }, 'photos')}><RotateRightIcon /></button>
                <button type="button" className={`${iconSm} border-inv-red/45 text-[#ffb3b3]`} aria-label={`写真${index + 1}を削除`} disabled={pending} onClick={() => setConfirmPhotoId(photo.id)}><TrashIcon /></button>
                {confirmPhotoId === photo.id ? <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-xl border border-inv-red/40 bg-inv-bg p-6">
                  <div className="flex items-center gap-3">
                  <span>この写真を削除しますか？</span>
                  <button type="button" className={invButtonDanger} disabled={pending} onClick={() => { setConfirmPhotoId(null); void run(() => mutations.deleteItemPhoto.mutateAsync({ itemId: item.id, photoId: photo.id }), '写真を削除しました', { kind: 'none' }, 'photos'); }}>削除</button>
                  <button type="button" className={invButtonGhost} onClick={() => setConfirmPhotoId(null)}>やめる</button>
                  </div>
                  {localError('photos')}
                </div> : null}
                {confirmPhotoId !== photo.id ? localError('photos') : null}
              </div> : null}
            </div>
            <section className="flex min-h-0 flex-1 flex-col gap-1" aria-label="置き場所">
              <div className="flex shrink-0 items-center gap-2">
                <h3 className={`${invEyebrow} flex-1`}>置き場所</h3>
                <button type="button" className={invButtonSmGhost} disabled={pending} onClick={() => setPanel({ kind: 'add-place', area: item.compartments[0]?.area ?? null, shelfId: null })}><PlusIcon />別の引き出しにも置く</button>
              </div>
              {item.compartments.length === 0 ? <p className="text-inv-faint">置き場所がありません</p> : null}
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {item.compartments.map((compartment) => <div key={compartment.id} className={`flex shrink-0 items-center gap-2 rounded-lg border px-2 ${swapped?.id === compartment.id ? 'flex-wrap border-inv-green/[0.55] bg-inv-green/10' : 'border-transparent bg-inv-s2'}`}>
                  <PinIcon /><span className="min-w-0 flex-1 truncate font-bold"><span className={invLabelNumber}>{formatInventoryLabelNumber(compartment.labelNumber)}</span> {compartment.area}・棚{compartment.shelfNumber}・引き出し{compartment.drawerNumber}</span>
                  <span className="text-[13px] tabular-nums text-inv-faint">{compartment.stockQuantity}{unitLabel(item)}</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-md border px-1.5 text-[12.5px] ${compartment.itemTagUid ? 'border-inv-line2 font-mono text-inv-muted' : 'border-inv-amber/45 text-inv-amber'}`} title={compartment.itemTagUid ?? undefined}>{tagTail(compartment.itemTagUid)}</span>
                  <button type="button" className={invButtonSmGhost} disabled={pending} onClick={() => { setError(null); setPanel({ kind: 'replace-tag', compartment }); }}>タグを交換</button>
                  <button type="button" className={invButtonSm} aria-label="別の引き出しへ移す" disabled={pending} onClick={() => setPanel({ kind: 'move', compartment })}>移す</button>
                  {swapped?.id === compartment.id ? <p role="status" className="flex basis-full flex-wrap items-center gap-2 py-1 pl-6 text-[13.5px] font-bold text-[#d7fbe9]">
                    <CheckIcon />タグを交換しました <span className="font-mono text-inv-faint line-through">{tagTail(swapped.oldUid)}</span><span className="text-inv-green">→</span><span className="font-mono">{tagTail(swapped.uid)}</span><span className="font-normal text-inv-muted">{swapped.oldUid && swapped.oldUid !== swapped.uid ? '古いタグは使えなくなりました' : null}</span>
                  </p> : null}
                </div>)}
              </div>
              {panel.kind !== 'none' && panel.kind !== 'delete-item' ? <div className={panel.kind === 'replace-tag' ? 'absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-inv-amber/50 bg-inv-bg p-4' : 'absolute left-0 right-0 top-0 z-20 flex min-h-full items-center justify-center rounded-xl bg-inv-bg p-4'}>
                <div className="max-h-[500px] w-full overflow-y-auto">
            {panel.kind === 'replace-tag' ? <NfcScanPanel large currentTag={tagTail(panel.compartment.itemTagUid)} label="新しい品物タグをかざす" sub={`${placeText(panel.compartment)} ／ ${item.name}`} pending={scanPending} error={errorAt === 'tag' ? error : null} onManualUid={(uid) => {
              if (scanBusy.current) return;
              scanBusy.current = true;
              setScanPending(true);
              setError(null);
              setErrorAt('tag');
              void replaceTag(panel.compartment, uid).catch(caught => setError(setupTagErrorText(caught))).finally(() => { scanBusy.current = false; setScanPending(false); });
            }} onCancel={() => { setError(null); setPanel({ kind: 'none' }); }} /> : null}

            {panel.kind === 'move' ? (
              <div className={subPanel} aria-label="移動先">
                <p className="text-sm text-inv-muted">{compartmentLocationText(panel.compartment).replace('引出し', '引き出し')} から移す先</p>
                {shelves.filter((shelf) => shelf.area === panel.compartment.area).map((shelf) => (
                  <div key={shelf.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 text-[13px] text-inv-muted">棚{shelf.shelfNumber}</span>
                    {otherDrawers(shelf, panel.compartment.id).map((drawer) => (
                      <button key={drawer.id} type="button" aria-label={`棚${shelf.shelfNumber} 引き出し${drawer.drawerNumber}`} className={invSeg(false)} disabled={pending} onClick={() => void run(() => mutations.move.mutateAsync({ id: panel.compartment.id, drawerId: drawer.id }), `棚${shelf.shelfNumber} / 引き出し${drawer.drawerNumber} へ移しました`)}>
                        {drawer.drawerNumber}
                      </button>
                    ))}
                  </div>
                ))}
                <button type="button" className={`${invButtonSmGhost} self-start`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
              </div>
            ) : null}

            {panel.kind === 'add-place' ? (
              <div className={subPanel} aria-label="追加する引き出し">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="エリア">
                  {areas.map((area) => (
                    <button key={area} type="button" aria-pressed={area === panel.area} className={`${invSeg(area === panel.area)} h-11 text-sm`} onClick={() => setPanel({ kind: 'add-place', area, shelfId: null })}>{area}</button>
                  ))}
                </div>
                {shelves.filter((shelf) => shelf.area === panel.area).map((shelf) => (
                  <div key={shelf.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 text-[13px] text-inv-muted">棚{shelf.shelfNumber}</span>
                    {shelf.drawers.map((drawer) => (
                      <button key={drawer.id} type="button" aria-label={`引き出し${drawer.drawerNumber}`} className={invSeg(false)} onClick={() => setPanel({ kind: 'add-tag', shelfId: shelf.id, drawerId: drawer.id })}>{drawer.drawerNumber}</button>
                    ))}
                  </div>
                ))}
                <button type="button" className={`${invButtonSmGhost} self-start`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
              </div>
            ) : null}

            {panel.kind === 'add-tag' ? (
              <NfcScanPanel
                label="アイテムタグ"
                sub="新しい引き出し"
                pending={false}
                error={null}
                onManualUid={(uid) => setPanel({ kind: 'add-quantity', shelfId: panel.shelfId, drawerId: panel.drawerId, uid, quantity: '' })}
                onCancel={() => setPanel({ kind: 'none' })}
              />
            ) : null}

            {panel.kind === 'add-quantity' ? (
              <div className={`${subPanel} grid grid-cols-[minmax(0,1fr)_14rem] gap-3`}>
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-inv-muted">タグ <span className="font-mono text-inv-text">{panel.uid}</span> を読み取りました。いま入っている数は？</p>
                  <output className="rounded-xl bg-inv-s2 px-4 py-2 text-right text-[40px] font-black tabular-nums" aria-label="入っている数">{panel.quantity || '0'}</output>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button type="button" className={invButtonGhost} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
                    <button
                      type="button"
                      className={`${invButtonPrimary} flex-1`}
                      disabled={pending}
                      onClick={() => void run(() => mutations.bindCompartment.mutateAsync({ itemId: item.id, shelfId: panel.shelfId, drawerId: panel.drawerId, itemTagUid: panel.uid, initialQuantity: Number(panel.quantity || '0') }), '引き出しを追加しました')}
                    >
                      この引き出しを追加する
                    </button>
                  </div>
                </div>
                <KioskDigitTenkey value={panel.quantity} onChange={(next) => setPanel({ ...panel, quantity: next.replace(/^0+(?=\d)/, '') })} maxLength={6} ariaLabel="入っている数のテンキー" className="grid grid-cols-3 gap-2 [&>button:nth-child(10)]:col-start-2" keyClassName={`${invKey} h-12 text-xl`} resetClassName={`${invKeyUtil} h-12`} />
              </div>
            ) : null}

                  {localError('place')}
                </div>
              </div> : localError('place')}
            </section>
          </div>
        </div>
        {/* Keyed by item so typed text and the mode never carry over to another item. */}
        <ToolValueBoard key={`${item.id}:${splitArea(item.compartments[0]?.area ?? '').machine}`} scope={splitArea(item.compartments[0]?.area ?? '').machine === '生産技術課' ? 'seigi' : 'default'} accessPassword={accessPassword} current={details} draftValues={readDrafts} onChange={(field, value) => void changeDetail(field, value)} status={detailStatus} statusField={detail?.field} className="flex-1" />
        </div>
      </div>
      {selectedPhoto ? <InventoryPhotoReadDialog key={item.id} photos={item.photos.map(photo => ({ ...photo, alt: photo.originalFilename }))} initialPhotoId={selectedPhoto} source={{ source: 'item', itemId: item.id }} accessPassword={accessPassword} values={{ ...details, ...readDrafts }} onApply={(field, value) => setReadDrafts(current => ({ ...current, [field]: value }))} onClose={() => setSelectedPhoto(null)} /> : null}
    </div>
  );
}
