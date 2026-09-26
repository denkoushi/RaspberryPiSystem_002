import { useEffect, useMemo, useRef, useState } from 'react';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryShelf } from '../../../../api/client';
import { useInventoryItems, useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';
import { InventoryPhotoDialog } from '../../../../components/kiosk/InventoryPhotoDialog';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import {
  kioskButtonDangerClassName,
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName,
  kioskPanelClassName,
} from '../../kioskTheme';
import { compartmentLocationText } from '../inventoryDailyFlow';

import { NfcScanPanel } from './NfcScanPanel';
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

const choiceClassName = 'min-h-14 min-w-24 rounded-lg border px-4 text-lg font-bold';
const selectedChoiceClassName = `${choiceClassName} border-sky-400 bg-sky-950/60 text-white`;
const idleChoiceClassName = `${choiceClassName} border-white/20 bg-slate-900/60 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40`;
const keyClassName =
  'inline-flex h-14 items-center justify-center rounded-lg border border-white/15 bg-slate-950 text-2xl font-bold text-white hover:bg-slate-800 disabled:opacity-40';

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
  const read = useArmedNfcRead(panel.kind === 'add-tag');
  const handledRef = useRef<NfcEvent | null>(null);
  const pending = mutations.move.isPending || mutations.bindCompartment.isPending || mutations.deleteItemPhoto.isPending
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
  };

  if (!item) {
    return (
      <div className="flex flex-col gap-3">
        {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null}
        <p className="text-white/70">直したいアイテムを選んでください</p>
        {itemsQuery.isLoading ? <p className="text-white/60">読み込み中…</p> : null}
        {!itemsQuery.isLoading && items.length === 0 ? <p className="text-white/60">登録済みのアイテムはありません</p> : null}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((entry) => (
            <button key={entry.id} type="button" className="flex items-center gap-3 rounded-lg border border-white/15 bg-slate-950/40 p-3 text-left text-white hover:bg-slate-800" onClick={() => open(entry.id)}>
              {entry.photos[0] ? <img src={inventoryThumbnailUrl(entry.photos[0].photoUrl)} alt="" className="h-16 w-16 rounded object-cover" /> : <span className="h-16 w-16 rounded bg-slate-800" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold">{entry.name}</span>
                <span className="text-sm text-white/60">{entry.itemCode} ・ {entry.compartments.length === 0 ? '置き場所なし' : `${entry.compartments.length}か所`}</span>
              </span>
            </button>
          ))}
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 text-lg`} onClick={() => open(null)}>← アイテム一覧</button>
        <h2 className="text-2xl font-bold text-white">{item.name}</h2>
        <span className="text-white/60">{item.itemCode}</span>
      </div>
      {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null}
      {error ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{error}</p> : null}

      <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="写真">
        <h3 className="text-xl font-bold text-white">写真</h3>
        {item.photos.length === 0 ? <p className="text-white/60">写真はありません</p> : null}
        <div className="flex flex-wrap gap-3">
          {item.photos.map((photo, index) => (
            <figure key={photo.id} className="w-40 rounded-lg border border-white/15 bg-slate-950/40 p-2">
              <button type="button" className="block w-full" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.originalFilename })}>
                <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-32 w-full rounded object-cover" />
              </button>
              {confirmPhotoId === photo.id ? (
                <div className="mt-2 flex flex-col gap-1">
                  <span className="text-sm text-red-100">この写真を消しますか？</span>
                  <div className="flex gap-1">
                    <button type="button" className={`${kioskButtonDangerClassName} flex-1`} disabled={pending} onClick={() => { setConfirmPhotoId(null); void run(() => mutations.deleteItemPhoto.mutateAsync({ itemId: item.id, photoId: photo.id }), '写真を消しました'); }}>消す</button>
                    <button type="button" className={`${kioskButtonSecondaryClassName} flex-1`} onClick={() => setConfirmPhotoId(null)}>やめる</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-1">
                  <button type="button" className={`${kioskButtonSecondaryClassName} flex-1 px-1`} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || pending} onClick={() => movePhoto(index, -1)}>←</button>
                  <button type="button" className={`${kioskButtonSecondaryClassName} flex-1 px-1`} aria-label={`写真${index + 1}を後ろへ`} disabled={index === item.photos.length - 1 || pending} onClick={() => movePhoto(index, 1)}>→</button>
                  <button type="button" className={`${kioskButtonDangerClassName} flex-1 px-1`} aria-label={`写真${index + 1}を削除`} disabled={pending} onClick={() => setConfirmPhotoId(photo.id)}>削除</button>
                </div>
              )}
            </figure>
          ))}
        </div>
      </section>

      <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="置き場所">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xl font-bold text-white">置き場所</h3>
          <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} disabled={pending} onClick={() => setPanel({ kind: 'add-place', area: item.compartments[0]?.area ?? null, shelfId: null })}>＋ 別の引き出しにも置く</button>
        </div>
        {item.compartments.length === 0 ? <p className="text-white/60">置き場所がありません</p> : null}
        {item.compartments.map((compartment) => (
          <div key={compartment.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-950/40 p-3 text-white">
            <span className="text-lg font-bold">{compartmentLocationText(compartment)}</span>
            <span className="text-white/70">在庫 {compartment.stockQuantity}個 ・ タグ{compartment.itemTagUid ? 'あり' : 'なし'}</span>
            <button type="button" className={`${kioskButtonSecondaryClassName} ml-auto min-h-12`} disabled={pending} onClick={() => setPanel({ kind: 'move', compartment })}>別の引き出しへ移す</button>
          </div>
        ))}

        {panel.kind === 'move' ? (
          <div className="flex flex-col gap-2 rounded-lg border border-sky-400/50 p-3" aria-label="移動先">
            <p className="text-lg text-white">{compartmentLocationText(panel.compartment)} から移す先（同じエリアの空いている引き出し）</p>
            {shelves.filter((shelf) => shelf.area === panel.compartment.area).map((shelf) => (
              <div key={shelf.id} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-white/60">棚{shelf.shelfNumber}</span>
                {freeDrawers(shelf).map((drawer) => (
                  <button key={drawer.id} type="button" className={idleChoiceClassName} disabled={pending} onClick={() => void run(() => mutations.move.mutateAsync({ id: panel.compartment.id, drawerId: drawer.id }), `棚${shelf.shelfNumber} / 引出し${drawer.drawerNumber} へ移しました`)}>
                    棚{shelf.shelfNumber} 引出し{drawer.drawerNumber}
                  </button>
                ))}
                {freeDrawers(shelf).length === 0 ? <span className="text-sm text-white/50">空きなし</span> : null}
              </div>
            ))}
            <button type="button" className={`${kioskButtonSecondaryClassName} self-start`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
          </div>
        ) : null}

        {panel.kind === 'add-place' ? (
          <div className="flex flex-col gap-2 rounded-lg border border-sky-400/50 p-3" aria-label="追加する引き出し">
            <div className="flex flex-wrap gap-2" role="group" aria-label="エリア">
              {areas.map((area) => (
                <button key={area} type="button" aria-pressed={area === panel.area} className={area === panel.area ? selectedChoiceClassName : idleChoiceClassName} onClick={() => setPanel({ kind: 'add-place', area, shelfId: null })}>{area}</button>
              ))}
            </div>
            {shelves.filter((shelf) => shelf.area === panel.area).map((shelf) => (
              <div key={shelf.id} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-white/60">棚{shelf.shelfNumber}</span>
                {freeDrawers(shelf).map((drawer) => (
                  <button key={drawer.id} type="button" className={idleChoiceClassName} onClick={() => setPanel({ kind: 'add-tag', shelfId: shelf.id, drawerId: drawer.id })}>引出し{drawer.drawerNumber}</button>
                ))}
                {freeDrawers(shelf).length === 0 ? <span className="text-sm text-white/50">空きなし</span> : null}
              </div>
            ))}
            <button type="button" className={`${kioskButtonSecondaryClassName} self-start`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
          </div>
        ) : null}

        {panel.kind === 'add-tag' ? (
          <NfcScanPanel
            title="新しい引き出しに付けるアイテムタグ"
            hint="読み取ると次に進みます"
            pending={false}
            error={null}
            onManualUid={(uid) => setPanel({ kind: 'add-quantity', shelfId: panel.shelfId, drawerId: panel.drawerId, uid, quantity: '' })}
            onCancel={() => setPanel({ kind: 'none' })}
          />
        ) : null}

        {panel.kind === 'add-quantity' ? (
          <div className="grid gap-3 rounded-lg border border-sky-400/50 p-3 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="flex flex-col gap-2">
              <p className="text-lg text-white">タグ {panel.uid} を読み取りました。いま入っている数は？</p>
              <output className="rounded bg-slate-950 px-4 py-3 text-right text-4xl font-bold text-white" aria-label="入っている数">{panel.quantity || '0'}</output>
              <div className="mt-auto flex gap-2">
                <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
                <button
                  type="button"
                  className={`${kioskButtonPrimaryClassName} min-h-14 flex-1 text-lg`}
                  disabled={pending}
                  onClick={() => void run(() => mutations.bindCompartment.mutateAsync({ itemId: item.id, shelfId: panel.shelfId, drawerId: panel.drawerId, itemTagUid: panel.uid, initialQuantity: Number(panel.quantity || '0') }), '引き出しを追加しました')}
                >
                  この引き出しを追加する
                </button>
              </div>
            </div>
            <KioskDigitTenkey value={panel.quantity} onChange={(next) => setPanel({ ...panel, quantity: next.replace(/^0+(?=\d)/, '') })} maxLength={6} ariaLabel="入っている数のテンキー" className="grid grid-cols-3 gap-2" keyClassName={keyClassName} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-red-500/40 p-4" aria-label="アイテムの削除">
        {panel.kind === 'delete-item' ? (
          <>
            <p className="text-lg text-red-100">「{item.name}」を削除しますか？ 履歴は残ります。</p>
            <div className="flex gap-2">
              <button type="button" className={`${kioskButtonDangerClassName} min-h-12`} disabled={pending} onClick={() => void run(async () => { await mutations.deleteItem.mutateAsync(item.id); setItemId(null); }, `「${item.name}」を削除しました`)}>削除する</button>
              <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={() => setPanel({ kind: 'none' })}>やめる</button>
            </div>
          </>
        ) : (
          <button type="button" className={`${kioskButtonDangerClassName} min-h-12 self-start`} disabled={pending} onClick={() => setPanel({ kind: 'delete-item' })}>アイテムを削除</button>
        )}
      </section>
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
}
