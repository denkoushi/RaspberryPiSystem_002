import { useEffect, useMemo, useRef, useState } from 'react';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryOptionField, type InventoryShelf } from '../../../../api/client';
import { useInventoryItems, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';
import { InventoryPhotoDialog } from '../../../../components/kiosk/InventoryPhotoDialog';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { compartmentLocationText, unitLabel } from '../inventoryDailyFlow';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PinIcon, PlusIcon, TrashIcon } from '../InventoryIcons';
import {
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
  invSeg,
  invSuccess,
} from '../inventoryUi';

import { InventoryUnitPicker } from './InventoryUnitPicker';
import { NfcScanPanel } from './NfcScanPanel';
import { isProvisionalInventoryName, TOOL_BOARD_COLUMNS, ToolValueBoard } from './ToolValueBoard';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

type Panel =
  | { kind: 'none' }
  | { kind: 'move'; compartment: InventoryCompartment }
  | { kind: 'add-place'; area: string | null; shelfId: string | null }
  | { kind: 'add-tag'; shelfId: string; drawerId: string }
  | { kind: 'add-quantity'; shelfId: string; drawerId: string; uid: string; quantity: string }
  | { kind: 'delete-item' };

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '処理に失敗しました';
}

const DETAIL_LABEL = Object.fromEntries(TOOL_BOARD_COLUMNS.map((column) => [column.key, column.label])) as Record<InventoryOptionField, string>;
const provisionalTag = 'shrink-0 rounded-[5px] bg-inv-amber/[0.12] px-1.5 text-[10.5px] font-bold tracking-[0.08em] text-inv-amber';
const iconSm = `${invButtonSm} w-9 px-0`;

function freeDrawers(shelf: InventoryShelf) {
  return shelf.drawers.filter((drawer) => drawer.compartments.length === 0);
}

export function InventoryItemEditTab({ accessPassword }: { accessPassword: string }) {
  const itemsQuery = useInventoryItems();
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const shelves = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const [itemId, setItemId] = useState<string | null>(null);
  const item = items.find((entry) => entry.id === itemId) ?? null;
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [confirmPhotoId, setConfirmPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; alt: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [provisionalOnly, setProvisionalOnly] = useState(false);
  // The last name or tool-information change, shown on the board with a way back.
  const [detail, setDetail] = useState<{ text: string; undo: { field: InventoryOptionField; value: string } | null } | { error: string } | null>(null);
  const read = useArmedNfcRead(panel.kind === 'add-tag');
  const handledRef = useRef<NfcEvent | null>(null);
  const pending = mutations.setItemUnit.isPending || mutations.move.isPending || mutations.bindCompartment.isPending || mutations.deleteItemPhoto.isPending
    || mutations.reorderItemPhotos.isPending || mutations.deleteItem.isPending;

  useEffect(() => {
    if (!read || handledRef.current === read || panel.kind !== 'add-tag') return;
    handledRef.current = read;
    setPanel({ kind: 'add-quantity', shelfId: panel.shelfId, drawerId: panel.drawerId, uid: read.uid, quantity: '' });
  }, [panel, read]);

  const run = async (work: () => Promise<unknown>, message: string, next: Panel = { kind: 'none' }) => {
    setError(null);
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
    setItemId(id);
    setPanel({ kind: 'none' });
    setConfirmPhotoId(null);
    setError(null);
    setDone(null);
    setDetail(null);
  };

  const needle = filter.normalize('NFKC').trim().toLowerCase();
  const provisionalCount = items.filter((entry) => isProvisionalInventoryName(entry.name)).length;
  const shown = items.filter((entry) => {
    // The open item stays listed after it gets a real name.
    if (provisionalOnly && !isProvisionalInventoryName(entry.name) && entry.id !== itemId) return false;
    return !needle || [entry.name, entry.itemCode, entry.model ?? ''].some((text) => text.normalize('NFKC').toLowerCase().includes(needle));
  });
  const banner = (
    <div className="flex h-12 shrink-0 items-center gap-3 overflow-hidden">
        {done ? <p className={`rounded-xl border px-3 py-2 text-base font-bold ${invSuccess}`} role="status">{done}</p> : null}
        {error ? <p className={`rounded-xl border px-3 py-2 text-base ${invError}`} role="alert">{error}</p> : null}
    </div>
  );
  const list = (
    <nav className="flex min-h-0 flex-col gap-1.5" aria-label="アイテム一覧">
      <div className="mb-1 flex shrink-0 gap-1.5">
        <input aria-label="品名・型式で絞り込む" placeholder="品名・型式で絞り込む" className={`${invField} h-11 min-w-0 flex-1`} value={filter} onChange={(event) => setFilter(event.target.value)} />
        {provisionalCount > 0 || provisionalOnly ? (
          <button type="button" aria-pressed={provisionalOnly} aria-label={`仮名だけ ${provisionalCount}件`} className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-bold ${provisionalOnly ? 'border-inv-amber bg-inv-amber/[0.12] text-[#ffe8bf]' : 'border-inv-line2 bg-inv-s2 text-inv-muted hover:bg-inv-s3'}`} onClick={() => setProvisionalOnly((on) => !on)}>
            仮名 <b className="tabular-nums text-inv-amber">{provisionalCount}</b>
          </button>
        ) : null}
      </div>
      {itemsQuery.isLoading ? <p className="text-inv-faint">読み込み中…</p> : null}
      {!itemsQuery.isLoading && items.length === 0 ? <p className="text-inv-faint">登録済みのアイテムはありません</p> : null}
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {shown.map((entry) => {
          const stock = entry.compartments.reduce((sum, compartment) => sum + compartment.stockQuantity, 0);
          const on = entry.id === item?.id;
          return (
            <button key={entry.id} type="button" aria-pressed={on} className={`flex h-[60px] shrink-0 items-center gap-2.5 rounded-xl px-2.5 text-left text-sm font-bold ${on ? 'border-2 border-inv-cyan bg-inv-cyan/[0.12]' : 'border border-inv-line bg-inv-s1 hover:bg-inv-s2'}`} onClick={() => open(entry.id)}>
              {entry.photos[0] ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(entry.photos[0].photoUrl)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-lg bg-inv-s3" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {isProvisionalInventoryName(entry.name)
                ? <span className={provisionalTag}>仮名</span>
                : <span className="shrink-0 text-xs font-normal tabular-nums text-inv-faint">{entry.compartments.length === 0 ? '置き場所なし' : `${stock}${unitLabel(entry)}`}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );

  if (!item) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
        {banner}
        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-5">
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
    void run(() => mutations.reorderItemPhotos.mutateAsync({ itemId: item.id, photoIds: ids }), '写真の順番を変えました');
  };

  const areas = [...new Set(shelves.map((shelf) => shelf.area))].sort((a, b) => a.localeCompare(b, 'ja'));
  const details = Object.fromEntries(TOOL_BOARD_COLUMNS.map((column) => [column.key, item[column.key] ?? ''])) as Record<InventoryOptionField, string>;
  const changeDetail = async (field: InventoryOptionField, value: string, undoable = true) => {
    const previous = details[field];
    setDetail(null);
    try {
      await mutations.updateItemDetails.mutateAsync({ itemId: item.id, details: { [field]: value } });
      setDetail({ text: value ? `${DETAIL_LABEL[field]}を「${value}」にしました` : `${DETAIL_LABEL[field]}を空にしました`, undo: undoable ? { field, value: previous } : null });
    } catch (caught) {
      setDetail({ error: errorText(caught) });
    }
  };
  const detailStatus = !detail ? null : 'error' in detail
    ? <p className={`min-w-0 truncate rounded-lg border px-2.5 py-1 text-[13px] ${invError}`} role="alert">{detail.error}</p>
    : (
      <p className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-[#d7fbe9]" role="status">
        <span className="text-inv-green"><CheckIcon /></span>
        <span className="truncate">{detail.text}</span>
        {detail.undo ? <button type="button" className="inline-flex h-7 shrink-0 items-center rounded-lg border border-inv-line2 px-2.5 text-xs font-bold text-inv-muted hover:bg-inv-s2 hover:text-inv-text" onClick={() => void changeDetail(detail.undo!.field, detail.undo!.value, false)}>元に戻す</button> : null}
      </p>
    );
  const subPanel = 'flex flex-col gap-2.5 rounded-xl border border-inv-cyan/40 bg-inv-bg p-3';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
      {banner}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-5">
        {list}

        <div className="flex min-h-0 min-w-0 flex-col gap-3.5">
        <div className="grid h-[440px] shrink-0 grid-cols-[minmax(0,1fr)_560px] gap-3.5">
        <section className={`${invPanel} flex min-h-0 flex-col gap-3 p-[18px]`} aria-label="写真">
          <div className="flex items-baseline gap-3">
            <h2 className="min-w-0 flex-1 truncate text-[22px] font-black">{item.name}</h2>
            {isProvisionalInventoryName(item.name) ? <span className={provisionalTag}>仮名</span> : null}
            <span className="font-mono text-[13px] text-inv-faint">{item.itemCode}</span>
          </div>
          {item.photos.length === 0 ? <p className="text-inv-faint">写真はありません</p> : null}
          <div className="grid min-h-0 flex-1 auto-rows-[100%] grid-cols-3 gap-3 overflow-y-auto">
            {item.photos.map((photo, index) => (
              <figure key={photo.id} className="flex min-h-0 flex-col gap-2">
                <button type="button" className="block min-h-0 w-full flex-1" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.originalFilename })}>
                  <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-full w-full rounded-xl border border-inv-line object-cover" />
                </button>
                {confirmPhotoId === photo.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 text-sm text-[#ffb3b3]">この写真を消しますか？</span>
                    <button type="button" className={`${invButtonSm} border-inv-red/60 text-[#ffb3b3]`} disabled={pending} onClick={() => { setConfirmPhotoId(null); void run(() => mutations.deleteItemPhoto.mutateAsync({ itemId: item.id, photoId: photo.id }), '写真を消しました'); }}>消す</button>
                    <button type="button" className={invButtonSmGhost} onClick={() => setConfirmPhotoId(null)}>やめる</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button type="button" className={iconSm} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || pending} onClick={() => movePhoto(index, -1)}><ArrowLeftIcon /></button>
                    <button type="button" className={iconSm} aria-label={`写真${index + 1}を後ろへ`} disabled={index === item.photos.length - 1 || pending} onClick={() => movePhoto(index, 1)}><ArrowRightIcon size={16} /></button>
                    <span className="flex-1" />
                    <button type="button" className={`${iconSm} border-inv-red/45 bg-transparent text-[#ffb3b3] hover:bg-inv-red/10`} aria-label={`写真${index + 1}を削除`} disabled={pending} onClick={() => setConfirmPhotoId(photo.id)}><TrashIcon /></button>
                  </div>
                )}
              </figure>
            ))}
          </div>
        </section>

        <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
          <section className={`${invPanel} flex flex-col gap-2.5 p-[18px]`} aria-label="単位の設定">
            <h3 className={invEyebrow}>単位</h3>
            <InventoryUnitPicker
              value={item.unit}
              accessPassword={accessPassword}
              disabled={mutations.setItemUnit.isPending}
              onChange={(unit) => { if (unit !== unitLabel(item)) void run(() => mutations.setItemUnit.mutateAsync({ itemId: item.id, unit }), `単位を「${unit}」にしました`); }}
            />
          </section>

          <section className={`${invPanel} flex flex-col gap-2.5 p-[18px]`} aria-label="置き場所">
            <div className="flex items-center gap-2">
              <h3 className={`${invEyebrow} flex-1`}>置き場所</h3>
              <button type="button" className={invButtonSmGhost} disabled={pending} onClick={() => setPanel({ kind: 'add-place', area: item.compartments[0]?.area ?? null, shelfId: null })}><PlusIcon />別の引き出しにも置く</button>
            </div>
            {item.compartments.length === 0 ? <p className="text-inv-faint">置き場所がありません</p> : null}
            {item.compartments.map((compartment) => (
              <div key={compartment.id} className="flex flex-wrap items-center gap-2.5 rounded-[10px] bg-inv-s2 px-3 py-2.5">
                <PinIcon />
                <span className="font-bold">{compartment.area} ・ 棚{compartment.shelfNumber} ・ 引出し{compartment.drawerNumber}</span>
                <span className="text-[13px] tabular-nums text-inv-faint">{compartment.stockQuantity}{unitLabel(item)}{compartment.itemTagUid ? '' : ' ・ タグなし'}</span>
                <span className="flex-1" />
                <button type="button" className={invButtonSm} aria-label="別の引き出しへ移す" disabled={pending} onClick={() => setPanel({ kind: 'move', compartment })}>移す</button>
              </div>
            ))}

            {panel.kind === 'move' ? (
              <div className={subPanel} aria-label="移動先">
                <p className="text-sm text-inv-muted">{compartmentLocationText(panel.compartment)} から移す先</p>
                {shelves.filter((shelf) => shelf.area === panel.compartment.area).map((shelf) => (
                  <div key={shelf.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 text-[13px] text-inv-muted">棚{shelf.shelfNumber}</span>
                    {freeDrawers(shelf).map((drawer) => (
                      <button key={drawer.id} type="button" aria-label={`棚${shelf.shelfNumber} 引出し${drawer.drawerNumber}`} className={invSeg(false)} disabled={pending} onClick={() => void run(() => mutations.move.mutateAsync({ id: panel.compartment.id, drawerId: drawer.id }), `棚${shelf.shelfNumber} / 引出し${drawer.drawerNumber} へ移しました`)}>
                        {drawer.drawerNumber}
                      </button>
                    ))}
                    {freeDrawers(shelf).length === 0 ? <span className="text-[13px] text-inv-faint">空きなし</span> : null}
                  </div>
                ))}
                <button type="button" className={`${invButtonSmGhost} self-start`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
              </div>
            ) : null}

            {panel.kind === 'add-place' ? (
              <div className={subPanel} aria-label="追加する引き出し">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="エリア">
                  {areas.map((area) => (
                    <button key={area} type="button" aria-pressed={area === panel.area} className={`${invSeg(area === panel.area)} h-9 text-sm`} onClick={() => setPanel({ kind: 'add-place', area, shelfId: null })}>{area}</button>
                  ))}
                </div>
                {shelves.filter((shelf) => shelf.area === panel.area).map((shelf) => (
                  <div key={shelf.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-12 text-[13px] text-inv-muted">棚{shelf.shelfNumber}</span>
                    {freeDrawers(shelf).map((drawer) => (
                      <button key={drawer.id} type="button" aria-label={`引出し${drawer.drawerNumber}`} className={invSeg(false)} onClick={() => setPanel({ kind: 'add-tag', shelfId: shelf.id, drawerId: drawer.id })}>{drawer.drawerNumber}</button>
                    ))}
                    {freeDrawers(shelf).length === 0 ? <span className="text-[13px] text-inv-faint">空きなし</span> : null}
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
          </section>

          <span className="flex-1" />
          <section className="flex flex-col items-end gap-2" aria-label="アイテムの削除">
            {panel.kind === 'delete-item' ? (
              <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-inv-red/40 p-3">
                <p className="text-[15px] text-[#ffd0d0]">「{item.name}」を削除しますか？ 履歴は残ります。</p>
                <button type="button" className={`${invButtonDanger} border-inv-red bg-inv-red/15`} disabled={pending} onClick={() => void run(async () => { await mutations.deleteItem.mutateAsync(item.id); setItemId(null); }, `「${item.name}」を削除しました`)}>削除する</button>
                <button type="button" className={invButtonGhost} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
              </div>
            ) : (
              <button type="button" className={invButtonDanger} disabled={pending} onClick={() => setPanel({ kind: 'delete-item' })}><TrashIcon />アイテムを削除</button>
            )}
          </section>
        </div>
        </div>
        {/* Keyed by item so typed text and the mode never carry over to another item. */}
        <ToolValueBoard key={item.id} accessPassword={accessPassword} current={details} onChange={(field, value) => void changeDetail(field, value)} status={detailStatus} className="flex-1" />
        </div>
      </div>
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
}
