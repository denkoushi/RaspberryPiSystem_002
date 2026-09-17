import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  inventoryThumbnailUrl,
  type InventoryItem,
} from '../../api/client';
import {
  useInventoryHistory,
  useInventoryImportMessages,
  useInventoryImports,
  useInventoryItems,
  useInventoryLocations,
  useInventoryMutations,
} from '../../api/hooks';
import { useNfcStream } from '../../hooks/useNfcStream';

const inputClass = 'min-h-10 rounded-md border border-white/20 bg-slate-950/60 px-3 text-white placeholder:text-white/40 focus:border-sky-400 focus:outline-none';
const selectClass = `${inputClass} w-full`;
const buttonClass = 'min-h-10 rounded-md bg-sky-600 px-4 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass = 'min-h-10 rounded-md border border-white/20 bg-white/5 px-4 font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';
const compactSecondaryButtonClass = `${secondaryButtonClass.replace('px-4', 'px-2')} whitespace-nowrap`;
const keypadButtonClass = `${secondaryButtonClass.replace('px-4', 'px-1')} min-w-0 text-sm`;
const dangerButtonClass = 'min-h-10 rounded-md bg-red-600 px-4 font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40';

type Draft = {
  mode: 'NEW_ITEM' | 'EXISTING_ITEM';
  itemId: string;
  name: string;
  model: string;
  usage: string;
  shelfId: string;
  drawerId: string;
  itemTagUid: string;
  initialQuantity: number;
  reviewNote: string;
};

const emptyDraft: Draft = {
  mode: 'NEW_ITEM', itemId: '', name: '', model: '', usage: '', shelfId: '', drawerId: '', itemTagUid: '', initialQuantity: 0, reviewNote: ''
};

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return error instanceof Error ? error.message : '処理に失敗しました';
}

function NumericKeypad({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const append = (digit: number) => {
    const next = Number(`${value}${digit}`);
    if (Number.isSafeInteger(next) && next <= 999999999) onChange(next);
  };
  return (
    <div className="w-52 rounded-md border border-white/15 bg-slate-950/50 p-2">
      <output className="mb-2 block rounded bg-slate-900 px-3 py-2 text-right text-2xl font-bold text-white" aria-label="初期数量">{value}</output>
      <div className="grid grid-cols-3 gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button key={digit} type="button" className={keypadButtonClass} onClick={() => append(digit)}>{digit}</button>
        ))}
        <button type="button" className={keypadButtonClass} onClick={() => onChange(0)}>クリア</button>
        <button type="button" className={keypadButtonClass} onClick={() => append(0)}>0</button>
        <button type="button" className={keypadButtonClass} onClick={() => onChange(Math.floor(value / 10))}>←</button>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(new Date(value));
}

export function RaspiInventoryPage() {
  const location = useLocation();
  const isActiveRoute = location.pathname === '/admin/tools/raspi-inventory';
  const nfcEvent = useNfcStream(isActiveRoute);
  const importsQuery = useInventoryImports();
  const messagesQuery = useInventoryImportMessages();
  const itemsQuery = useInventoryItems();
  const locationsQuery = useInventoryLocations();
  const historyQuery = useInventoryHistory();
  const mutations = useInventoryMutations();
  const imports = importsQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const [selectedImportId, setSelectedImportId] = useState('');
  const selectedImport = imports.find((entry) => entry.id === selectedImportId) ?? null;
  const selectedImportPhotos = selectedImport?.photos ?? [];
  const photoEditingPending = mutations.deleteImportPhoto.isPending || mutations.reorderImportPhotos.isPending;
  const registeredPhotoEditingPending = mutations.deleteItemPhoto.isPending || mutations.reorderItemPhotos.isPending;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);
  const [draggedRegisteredPhoto, setDraggedRegisteredPhoto] = useState<{ itemId: string; photoId: string } | null>(null);
  const [dragOverRegisteredPhotoId, setDragOverRegisteredPhotoId] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<'item' | 'binding-item' | 'quantity' | 'restock' | null>(null);
  const lastScanKeyRef = useRef<string | null>(null);
  const nfcBaselineKeyRef = useRef<string | null>(null);
  const [quantityUid, setQuantityUid] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [restockUid, setRestockUid] = useState('');
  const [binding, setBinding] = useState({ itemId: '', shelfId: '', drawerId: '', itemTagUid: '', initialQuantity: 0 });
  const [newArea, setNewArea] = useState('');
  const [newShelfNumber, setNewShelfNumber] = useState(1);
  const [newDrawerNumber, setNewDrawerNumber] = useState(1);
  const [newShelfId, setNewShelfId] = useState('');
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [replacementUids, setReplacementUids] = useState<Record<string, string>>({});
  const [moveDrawers, setMoveDrawers] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedImportSourceItemId = selectedImport?.sourceItemId;

  useEffect(() => {
    if (selectedImportSourceItemId == null) return;
    setDraft({ ...emptyDraft, name: `ItemlistRaspi ${selectedImportSourceItemId}` });
    setScanTarget(null);
    nfcBaselineKeyRef.current = null;
  }, [selectedImportId, selectedImportSourceItemId]);

  useEffect(() => {
    if (!nfcEvent || !scanTarget) return;
    const key = nfcEvent.eventId != null ? String(nfcEvent.eventId) : `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (nfcBaselineKeyRef.current === key) return;
    if (lastScanKeyRef.current === key) return;
    lastScanKeyRef.current = key;
    if (scanTarget === 'item') setDraft((current) => ({ ...current, itemTagUid: nfcEvent.uid }));
    if (scanTarget === 'binding-item') setBinding((current) => ({ ...current, itemTagUid: nfcEvent.uid }));
    if (scanTarget === 'quantity') setQuantityUid(nfcEvent.uid);
    if (scanTarget === 'restock') setRestockUid(nfcEvent.uid);
    nfcBaselineKeyRef.current = null;
    setScanTarget(null);
  }, [nfcEvent, scanTarget]);

  const shelvesForArea = useMemo(
    () => locations.filter((shelf) => shelf.area === selectedImport?.area),
    [locations, selectedImport?.area]
  );
  const drawersForShelf = useMemo(
    () => shelvesForArea.find((shelf) => shelf.id === draft.shelfId)?.drawers ?? [],
    [draft.shelfId, shelvesForArea]
  );
  const allDrawers = useMemo(
    () => locations.flatMap((shelf) => shelf.drawers.map((drawer) => ({ ...drawer, area: shelf.area }))),
    [locations]
  );
  const bindingDrawers = useMemo(
    () => locations.find((shelf) => shelf.id === binding.shelfId)?.drawers ?? [],
    [binding.shelfId, locations]
  );

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const armNfcTarget = (target: 'item' | 'binding-item' | 'quantity' | 'restock') => {
    nfcBaselineKeyRef.current = nfcEvent ? (nfcEvent.eventId != null ? String(nfcEvent.eventId) : `${nfcEvent.uid}:${nfcEvent.timestamp}`) : null;
    setScanTarget(target);
  };

  const savePhotoOrder = async (photoIds: string[]) => {
    if (!selectedImport) return;
    setActionError(null);
    try {
      await mutations.reorderImportPhotos.mutateAsync({ payloadId: selectedImport.id, photoIds });
    } catch (error) {
      setActionError(errorText(error));
    }
  };

  const moveImportPhoto = (photoId: string, offset: -1 | 1) => {
    const currentIndex = selectedImportPhotos.findIndex((photo) => photo.id === photoId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedImportPhotos.length) return;
    const nextPhotoIds = selectedImportPhotos.map((photo) => photo.id);
    [nextPhotoIds[currentIndex], nextPhotoIds[nextIndex]] = [nextPhotoIds[nextIndex], nextPhotoIds[currentIndex]];
    void savePhotoOrder(nextPhotoIds);
  };

  const deleteImportPhoto = (photoId: string, filename: string) => {
    if (!selectedImport || !window.confirm(`「${filename}」を候補から削除しますか？`)) return;
    setActionError(null);
    void mutations.deleteImportPhoto.mutateAsync({ payloadId: selectedImport.id, photoId }).catch((error) => setActionError(errorText(error)));
  };

  const dropImportPhoto = (targetPhotoId: string) => {
    const sourcePhotoId = draggedPhotoId;
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
    if (!sourcePhotoId || sourcePhotoId === targetPhotoId) return;
    const sourceIndex = selectedImportPhotos.findIndex((photo) => photo.id === sourcePhotoId);
    const targetIndex = selectedImportPhotos.findIndex((photo) => photo.id === targetPhotoId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextPhotoIds = selectedImportPhotos.map((photo) => photo.id);
    const [movedPhotoId] = nextPhotoIds.splice(sourceIndex, 1);
    nextPhotoIds.splice(targetIndex, 0, movedPhotoId);
    void savePhotoOrder(nextPhotoIds);
  };

  const saveRegisteredPhotoOrder = async (itemId: string, photoIds: string[]) => {
    setActionError(null);
    try {
      await mutations.reorderItemPhotos.mutateAsync({ itemId, photoIds });
    } catch (error) {
      setActionError(errorText(error));
    }
  };

  const moveRegisteredPhoto = (item: InventoryItem, photoId: string, offset: -1 | 1) => {
    const currentIndex = item.photos.findIndex((photo) => photo.id === photoId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= item.photos.length) return;
    const nextPhotoIds = item.photos.map((photo) => photo.id);
    [nextPhotoIds[currentIndex], nextPhotoIds[nextIndex]] = [nextPhotoIds[nextIndex], nextPhotoIds[currentIndex]];
    void saveRegisteredPhotoOrder(item.id, nextPhotoIds);
  };

  const deleteRegisteredPhoto = (itemId: string, photoId: string, filename: string) => {
    if (!window.confirm(`「${filename}」を登録済みアイテムから削除しますか？`)) return;
    setActionError(null);
    void mutations.deleteItemPhoto.mutateAsync({ itemId, photoId }).catch((error) => setActionError(errorText(error)));
  };

  const dropRegisteredPhoto = (item: InventoryItem, targetPhotoId: string) => {
    const source = draggedRegisteredPhoto;
    setDraggedRegisteredPhoto(null);
    setDragOverRegisteredPhotoId(null);
    if (!source || source.itemId !== item.id || source.photoId === targetPhotoId) return;
    const sourceIndex = item.photos.findIndex((photo) => photo.id === source.photoId);
    const targetIndex = item.photos.findIndex((photo) => photo.id === targetPhotoId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextPhotoIds = item.photos.map((photo) => photo.id);
    const [movedPhotoId] = nextPhotoIds.splice(sourceIndex, 1);
    nextPhotoIds.splice(targetIndex, 0, movedPhotoId);
    void saveRegisteredPhotoOrder(item.id, nextPhotoIds);
  };

  const registerSelected = async () => {
    if (!selectedImport) return;
    setActionError(null);
    try {
      await mutations.registerImport.mutateAsync({
        id: selectedImport.id,
        input: {
          mode: draft.mode,
          itemId: draft.mode === 'EXISTING_ITEM' ? draft.itemId || undefined : undefined,
          name: draft.name,
          model: draft.model,
          usage: draft.usage,
          shelfId: draft.mode === 'NEW_ITEM' ? draft.shelfId || undefined : undefined,
          drawerId: draft.mode === 'NEW_ITEM' ? draft.drawerId || undefined : undefined,
          itemTagUid: draft.mode === 'NEW_ITEM' ? draft.itemTagUid || undefined : undefined,
          initialQuantity: draft.mode === 'NEW_ITEM' ? draft.initialQuantity : undefined,
          reviewNote: draft.reviewNote,
        },
      });
      setSelectedImportId('');
    } catch (error) {
      setActionError(errorText(error));
    }
  };

  const submitCorrection = async (compartmentId: string) => {
    const raw = corrections[compartmentId] ?? '';
    if (raw.trim() === '') { setActionError('修正後在庫を入力してください（0は入力できます）'); return; }
    const desired = Number(raw);
    if (!Number.isSafeInteger(desired) || desired < 0) { setActionError('在庫数は0以上の整数で入力してください'); return; }
    if (!window.confirm('この区画の在庫数を修正しますか？')) return;
    setActionError(null);
    try { await mutations.correction.mutateAsync({ compartmentId, desiredQuantity: desired }); } catch (error) { setActionError(errorText(error)); }
  };

  const submitMove = async (compartmentId: string) => {
    const drawerId = moveDrawers[compartmentId];
    if (!drawerId) return;
    if (!window.confirm('この区画を移動しますか？')) return;
    try { await mutations.move.mutateAsync({ id: compartmentId, drawerId }); } catch (error) { setActionError(errorText(error)); }
  };

  const submitReplacement = async (compartmentId: string) => {
    const uid = replacementUids[compartmentId]?.trim();
    if (!uid) return;
    if (!window.confirm('この区画のアイテムNFCタグを交換しますか？')) return;
    try { await mutations.replaceTag.mutateAsync({ id: compartmentId, uid }); } catch (error) { setActionError(errorText(error)); }
  };

  const submitBinding = async () => {
    if (!binding.itemId || !binding.shelfId || !binding.drawerId || !binding.itemTagUid.trim()) {
      setActionError('既存アイテム、棚、引き出し、アイテムNFC UIDを指定してください');
      return;
    }
    try {
      await mutations.bindCompartment.mutateAsync(binding);
      setBinding({ itemId: '', shelfId: '', drawerId: '', itemTagUid: '', initialQuantity: 0 });
    } catch (error) { setActionError(errorText(error)); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Raspberry Pi在庫</h1>
        <p className="mt-1 text-sm text-white/65">写真・情報の確認、NFC区画登録、在庫操作履歴を管理します。</p>
      </div>
      {actionError ? <div className="rounded-md border border-red-400/50 bg-red-950/60 p-3 text-red-100" role="alert">{actionError}</div> : null}

      {(messagesQuery.data ?? []).some((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING') ? <section className="rounded-lg border border-amber-400/40 bg-amber-950/40 p-4">
        <h2 className="text-lg font-bold">取込エラー・再試行</h2>
        <p className="mt-1 text-sm text-white/65">在庫写真メールの処理に失敗したメッセージだけ、ここから再試行できます。</p>
        {(messagesQuery.data ?? []).filter((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING').map((entry) => (
          <div key={entry.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-400/40 bg-amber-950/40 p-3 text-sm">
            <span>メール {entry.gmailMessageId}: {entry.errorMessage ?? '再試行可能なエラー'}</span>
            <button type="button" className={secondaryButtonClass} onClick={() => void mutations.retryImport.mutateAsync(entry.id).catch((error) => setActionError(errorText(error)))}>再試行</button>
          </div>
        ))}
      </section> : null}

      <section className="rounded-lg border border-white/15 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold">登録レビュー</h2>
        {imports.length === 0 ? <p className="mt-3 text-sm text-white/60">保留中の候補はありません。</p> : (
          <div className="mt-3 grid gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-2">
              {imports.map((entry) => (
                <button key={entry.id} type="button" className={`rounded border p-3 text-left ${entry.id === selectedImportId ? 'border-sky-400 bg-sky-950/50' : 'border-white/15 bg-slate-950/30'}`} onClick={() => setSelectedImportId(entry.id)}>
                  <span className="font-semibold">候補 #{entry.sourceItemId}</span>
                  <span className="ml-3 text-sm text-white/65">エリア: {entry.area} / 写真 {entry.photos.length}枚</span>
                </button>
              ))}
            </div>
            {selectedImport ? (
              <div className="w-full max-w-xl justify-self-start rounded border border-white/15 bg-slate-950/30 p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">候補写真（{selectedImportPhotos.length}枚）</h3>
                    <p className="text-xs text-white/55">カードをドラッグ、または矢印で並び替え</p>
                  </div>
                  {selectedImportPhotos.length === 0 ? <p className="rounded border border-dashed border-white/20 p-4 text-sm text-white/60">写真はありません。</p> : (
                    <div className="flex flex-wrap gap-2">
                      {selectedImportPhotos.map((photo, index) => (
                        <figure
                          key={photo.id}
                          data-testid={`inventory-import-photo-${photo.id}`}
                          draggable={!photoEditingPending}
                          onDragStart={(event) => {
                            if (photoEditingPending) return;
                            setDraggedPhotoId(photo.id);
                            if (event.dataTransfer) {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', photo.id);
                            }
                          }}
                          onDragOver={(event) => { event.preventDefault(); setDragOverPhotoId(photo.id); }}
                          onDrop={(event) => { event.preventDefault(); dropImportPhoto(photo.id); }}
                          onDragEnd={() => { setDraggedPhotoId(null); setDragOverPhotoId(null); }}
                          className={`w-36 rounded border bg-slate-900/70 p-1.5 ${dragOverPhotoId === photo.id ? 'border-sky-400' : 'border-white/15'} ${draggedPhotoId === photo.id ? 'opacity-50' : ''}`}
                        >
                          <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.filename} className="h-28 w-full rounded object-cover" />
                          <figcaption className="truncate px-1 pt-1 text-xs text-white/70" title={photo.filename}>{index + 1}. {photo.filename}</figcaption>
                          <div className="mt-1 flex items-center gap-1">
                            <button type="button" className={keypadButtonClass} aria-label={`画像${index + 1}を上へ`} disabled={index === 0 || photoEditingPending} onClick={() => moveImportPhoto(photo.id, -1)}>↑</button>
                            <button type="button" className={keypadButtonClass} aria-label={`画像${index + 1}を下へ`} disabled={index === selectedImportPhotos.length - 1 || photoEditingPending} onClick={() => moveImportPhoto(photo.id, 1)}>↓</button>
                            <button type="button" className={`${dangerButtonClass.replace('px-4', 'px-2')} ml-auto text-sm`} aria-label={`画像${index + 1}を削除`} disabled={photoEditingPending} onClick={() => deleteImportPhoto(photo.id, photo.filename)}>削除</button>
                          </div>
                        </figure>
                      ))}
                    </div>
                  )}
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/75">
                    <div><dt className="inline font-semibold">エリア: </dt><dd className="inline">{selectedImport.area}</dd></div>
                    <div><dt className="inline font-semibold">カテゴリ: </dt><dd className="inline">{selectedImport.category ?? '-'}</dd></div>
                    <div><dt className="inline font-semibold">メモ: </dt><dd className="inline">{selectedImport.note ?? '-'}</dd></div>
                  </dl>
                </div>
                <div className="mt-4 flex gap-2">
                  <button type="button" className={draft.mode === 'NEW_ITEM' ? buttonClass : secondaryButtonClass} onClick={() => updateDraft('mode', 'NEW_ITEM')}>新規登録</button>
                  <button type="button" className={draft.mode === 'EXISTING_ITEM' ? buttonClass : secondaryButtonClass} onClick={() => updateDraft('mode', 'EXISTING_ITEM')}>既存に追加</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="flex w-full max-w-md flex-col gap-1 text-sm">アイテム名<input className={`${inputClass} w-full`} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} /></label>
                  <label className="flex w-full max-w-xs flex-col gap-1 text-sm">型式<input className={`${inputClass} w-full`} value={draft.model} onChange={(event) => updateDraft('model', event.target.value)} /></label>
                  <label className="flex w-full max-w-md flex-col gap-1 text-sm">用途<input className={`${inputClass} w-full`} value={draft.usage} onChange={(event) => updateDraft('usage', event.target.value)} /></label>
                </div>
                {draft.mode === 'EXISTING_ITEM' ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <label className="flex w-full max-w-md flex-col gap-1 text-sm">追加先アイテム<select className={selectClass} value={draft.itemId} onChange={(event) => {
                      const itemId = event.target.value;
                      const selectedItem = items.find((item) => item.id === itemId);
                      setDraft((current) => ({
                        ...current,
                        itemId,
                        name: selectedItem?.name ?? current.name,
                        model: selectedItem?.model ?? '',
                        usage: selectedItem?.usage ?? '',
                      }));
                    }}><option value="">選択してください</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.itemCode})</option>)}</select></label>
                    <p className="text-xs text-amber-200">既存への追加は写真・情報だけを更新し、在庫数・エリア・棚・引き出し・区画は変更しません。</p>
                  </div>
                ) : (
                  <div className="mt-3 flex max-w-5xl flex-wrap items-start gap-4">
                    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                      <div className="flex flex-wrap gap-2">
                        <label className="flex w-40 flex-col gap-1 text-sm">棚番号<select className={selectClass} value={draft.shelfId} onChange={(event) => { updateDraft('shelfId', event.target.value); updateDraft('drawerId', ''); }}><option value="">棚を選択</option>{shelvesForArea.map((shelf) => <option key={shelf.id} value={shelf.id}>棚{shelf.shelfNumber}</option>)}</select></label>
                        <label className="flex w-44 flex-col gap-1 text-sm">引き出し番号<select className={selectClass} value={draft.drawerId} onChange={(event) => updateDraft('drawerId', event.target.value)} disabled={!draft.shelfId}><option value="">引き出しを選択</option>{drawersForShelf.map((drawer) => <option key={drawer.id} value={drawer.id}>引き出し{drawer.drawerNumber}</option>)}</select></label>
                      </div>
                      <label className="flex w-full max-w-lg flex-col gap-1 text-sm">アイテムNFC UID<div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={draft.itemTagUid} onChange={(event) => updateDraft('itemTagUid', event.target.value)} /><button type="button" className={secondaryButtonClass} onClick={() => armNfcTarget('item')}>NFCを読み取る</button></div></label>
                    </div>
                    <div className="shrink-0"><p className="mb-1 text-sm">初期実在庫数（ソフトウェア keypad）</p><NumericKeypad value={draft.initialQuantity} onChange={(value) => updateDraft('initialQuantity', value)} /></div>
                  </div>
                )}
                <label className="mt-3 flex flex-col gap-1 text-sm">レビュー記録<textarea className={`${inputClass} min-h-20 py-2`} value={draft.reviewNote} onChange={(event) => updateDraft('reviewNote', event.target.value)} /></label>
                <button type="button" className={`${buttonClass} mt-3 w-full max-w-md`} onClick={() => void registerSelected()} disabled={mutations.registerImport.isPending}>登録を確定</button>
              </div>
            ) : <p className="rounded border border-dashed border-white/20 p-8 text-center text-white/60">候補を選択してください。</p>}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold">棚・引き出し管理</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex w-full max-w-xs flex-col gap-1 text-sm">エリア<input className={`${inputClass} w-full`} placeholder="例: 30007_KSJP-55" value={newArea} onChange={(event) => setNewArea(event.target.value)} /></label>
          <label className="flex w-20 flex-col gap-1 text-sm">棚番号<input className={`${inputClass} w-full`} type="number" min={1} value={newShelfNumber} onChange={(event) => setNewShelfNumber(Number(event.target.value))} /></label>
          <button type="button" className={buttonClass} onClick={() => void mutations.createShelf.mutateAsync({ area: newArea, shelfNumber: newShelfNumber }).then(() => setNewArea('')).catch((error) => setActionError(errorText(error)))}>棚を追加</button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex w-full max-w-sm flex-col gap-1 text-sm">追加先の棚<select className={selectClass} value={newShelfId} onChange={(event) => setNewShelfId(event.target.value)}><option value="">棚を選択</option>{locations.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.area} / 棚{shelf.shelfNumber}</option>)}</select></label>
          <label className="flex w-24 flex-col gap-1 text-sm">引き出し番号<input className={`${inputClass} w-full`} type="number" min={1} value={newDrawerNumber} onChange={(event) => setNewDrawerNumber(Number(event.target.value))} /></label>
          <button type="button" className={buttonClass} onClick={() => void mutations.createDrawer.mutateAsync({ shelfId: newShelfId, drawerNumber: newDrawerNumber }).catch((error) => setActionError(errorText(error)))}>引き出しを追加</button>
        </div>
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold">既存アイテムに区画を追加</h2>
        <p className="mt-1 text-sm text-white/65">メールレビューとは別に、同じアイテム情報を別の区画へ割り当てます。初期数量とアイテムNFCを登録します。</p>
        <div className="mt-3 flex max-w-5xl flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <label className="flex w-full max-w-md flex-col gap-1 text-sm">アイテム<select className={selectClass} value={binding.itemId} onChange={(event) => setBinding((current) => ({ ...current, itemId: event.target.value }))}><option value="">選択してください</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.itemCode})</option>)}</select></label>
            <label className="flex w-52 flex-col gap-1 text-sm">エリア・棚<select className={selectClass} value={binding.shelfId} onChange={(event) => setBinding((current) => ({ ...current, shelfId: event.target.value, drawerId: '' }))}><option value="">選択してください</option>{locations.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.area} / 棚{shelf.shelfNumber}</option>)}</select></label>
            <label className="flex w-44 flex-col gap-1 text-sm">引き出し<select className={selectClass} value={binding.drawerId} onChange={(event) => setBinding((current) => ({ ...current, drawerId: event.target.value }))} disabled={!binding.shelfId}><option value="">選択してください</option>{bindingDrawers.map((drawer) => <option key={drawer.id} value={drawer.id}>引き出し{drawer.drawerNumber}</option>)}</select></label>
            <label className="flex w-full max-w-lg flex-col gap-1 text-sm">アイテムNFC UID<div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={binding.itemTagUid} onChange={(event) => setBinding((current) => ({ ...current, itemTagUid: event.target.value }))} /><button type="button" className={secondaryButtonClass} onClick={() => armNfcTarget('binding-item')}>NFCを読み取る</button></div></label>
            <button type="button" className={buttonClass} onClick={() => void submitBinding()} disabled={mutations.bindCompartment.isPending}>区画を登録</button>
          </div>
          <div className="shrink-0"><p className="mb-1 text-sm">初期実在庫数</p><NumericKeypad value={binding.initialQuantity} onChange={(value) => setBinding((current) => ({ ...current, initialQuantity: value }))} /></div>
        </div>
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold">数量NFC・補充NFC</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="w-full max-w-2xl rounded border border-white/15 p-3">
            <h3 className="font-semibold">数量タグ（任意の正の数量）</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2"><label className="flex w-full max-w-sm flex-col gap-1 text-sm">数量タグUID<div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1`} placeholder="UID" value={quantityUid} onChange={(event) => setQuantityUid(event.target.value)} /><button type="button" className={secondaryButtonClass} onClick={() => armNfcTarget('quantity')}>NFCを読み取る</button></div></label><label className="flex w-24 flex-col gap-1 text-sm">数量<input className={`${inputClass} w-full`} type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><button type="button" className={buttonClass} onClick={() => void mutations.quantityTag.mutateAsync({ uid: quantityUid, quantity }).catch((error) => setActionError(errorText(error)))}>登録</button></div>
          </div>
          <div className="w-full max-w-2xl rounded border border-white/15 p-3">
            <h3 className="font-semibold">補充モードタグ</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2"><label className="flex w-full max-w-sm flex-col gap-1 text-sm">補充モードタグUID<div className="flex flex-wrap gap-2"><input className={`${inputClass} min-w-0 flex-1`} placeholder="UID" value={restockUid} onChange={(event) => setRestockUid(event.target.value)} /><button type="button" className={secondaryButtonClass} onClick={() => armNfcTarget('restock')}>NFCを読み取る</button></div></label><button type="button" className={buttonClass} onClick={() => void mutations.restockTag.mutateAsync(restockUid).catch((error) => setActionError(errorText(error)))}>登録</button></div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold">区画・在庫管理</h2>
        <div className="mt-3 flex flex-col gap-4">
          {items.length === 0 ? <p className="text-sm text-white/60">登録済みアイテムはありません。</p> : items.flatMap((item: InventoryItem) => item.compartments.map((compartment) => (
            <div key={compartment.id} className="rounded border border-white/15 bg-slate-950/30 p-3">
              <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><strong>{item.name}</strong> <span className="text-sm text-white/60">{item.itemCode}</span>{item.photos.length > 0 ? <div className="mt-2 flex max-w-full gap-2 overflow-x-auto" aria-label={`${item.name}の写真`}>
                {item.photos.map((photo, index) => <figure
                  key={photo.id}
                  draggable={!registeredPhotoEditingPending}
                  onDragStart={(event) => {
                    if (registeredPhotoEditingPending) return;
                    setDraggedRegisteredPhoto({ itemId: item.id, photoId: photo.id });
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', photo.id);
                    }
                  }}
                  onDragOver={(event) => { event.preventDefault(); setDragOverRegisteredPhotoId(photo.id); }}
                  onDrop={(event) => { event.preventDefault(); dropRegisteredPhoto(item, photo.id); }}
                  onDragEnd={() => { setDraggedRegisteredPhoto(null); setDragOverRegisteredPhotoId(null); }}
                  className={`w-28 shrink-0 rounded border bg-slate-900/70 p-1 ${dragOverRegisteredPhotoId === photo.id ? 'border-sky-400' : 'border-white/15'} ${draggedRegisteredPhoto?.photoId === photo.id ? 'opacity-50' : ''}`}
                >
                  <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-20 w-full rounded object-cover" />
                  <figcaption className="truncate px-1 pt-1 text-xs text-white/70" title={photo.originalFilename}>{index + 1}. {photo.originalFilename}</figcaption>
                  <div className="mt-1 flex items-center gap-1">
                    <button type="button" className={keypadButtonClass} aria-label={`登録済み画像${index + 1}を上へ`} disabled={index === 0 || registeredPhotoEditingPending} onClick={() => moveRegisteredPhoto(item, photo.id, -1)}>↑</button>
                    <button type="button" className={keypadButtonClass} aria-label={`登録済み画像${index + 1}を下へ`} disabled={index === item.photos.length - 1 || registeredPhotoEditingPending} onClick={() => moveRegisteredPhoto(item, photo.id, 1)}>↓</button>
                    <button type="button" className={`${dangerButtonClass.replace('px-4', 'px-2')} ml-auto text-sm`} aria-label={`登録済み画像${index + 1}を削除`} disabled={registeredPhotoEditingPending} onClick={() => deleteRegisteredPhoto(item.id, photo.id, photo.originalFilename)}>削除</button>
                  </div>
                </figure>)}
              </div> : null}</div><span className="font-bold">現在庫 {compartment.stockQuantity}</span></div>
              <p className="mt-1 text-sm text-white/65">{compartment.area} / 棚{compartment.shelfNumber} / 引出し{compartment.drawerNumber} / NFC {compartment.itemTagUid ?? '未設定'}</p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="flex items-end gap-2"><label className="flex w-28 flex-col gap-1 text-sm">修正後在庫<input className={`${inputClass} w-full`} type="number" min={0} value={corrections[compartment.id] ?? ''} onChange={(event) => setCorrections((current) => ({ ...current, [compartment.id]: event.target.value }))} /></label><button type="button" className={compactSecondaryButtonClass} onClick={() => void submitCorrection(compartment.id)}>修正</button></div>
                <div className="flex items-end gap-2"><label className="flex w-64 flex-col gap-1 text-sm">移動先<select className={selectClass} value={moveDrawers[compartment.id] ?? ''} onChange={(event) => setMoveDrawers((current) => ({ ...current, [compartment.id]: event.target.value }))}><option value="">移動先</option>{allDrawers.filter((drawer) => drawer.area === compartment.area).map((drawer) => <option key={drawer.id} value={drawer.id}>棚{drawer.shelf.shelfNumber} / 引出し{drawer.drawerNumber}</option>)}</select></label><button type="button" className={compactSecondaryButtonClass} onClick={() => void submitMove(compartment.id)}>移動</button></div>
                <div className="flex items-end gap-2"><label className="flex w-full max-w-xs flex-col gap-1 text-sm">交換後アイテムNFC UID<input className={`${inputClass} w-full`} value={replacementUids[compartment.id] ?? ''} onChange={(event) => setReplacementUids((current) => ({ ...current, [compartment.id]: event.target.value }))} /></label><button type="button" className={compactSecondaryButtonClass} onClick={() => void submitReplacement(compartment.id)}>交換</button></div>
              </div>
            </div>
          ))) }
        </div>
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold">在庫履歴</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-white/15 text-white/65"><tr><th className="p-2">日時</th><th className="p-2">端末</th><th className="p-2">アイテム</th><th className="p-2">区画</th><th className="p-2">増減</th><th className="p-2">前後</th><th className="p-2">操作</th></tr></thead><tbody>{(historyQuery.data ?? []).map((entry) => <tr key={entry.id} className="border-b border-white/10"><td className="p-2">{formatDate(entry.createdAt)}</td><td className="p-2">{entry.clientId ?? '-'}</td><td className="p-2">{entry.inventoryItem.name}</td><td className="p-2">{entry.compartment ? `${entry.compartment.drawer.shelf.area} / 棚${entry.compartment.drawer.shelf.shelfNumber} / 引出し${entry.compartment.drawer.drawerNumber}` : '-'}</td><td className="p-2">{entry.delta > 0 ? '+' : ''}{entry.delta}</td><td className="p-2">{entry.beforeQuantity} → {entry.afterQuantity}</td><td className="p-2"><button type="button" className={dangerButtonClass} disabled={!['ISSUE', 'RESTOCK', 'CORRECTION'].includes(entry.action)} onClick={() => { if (window.confirm('直前の取引を取り消しますか？')) void mutations.cancel.mutateAsync(entry.id).catch((error) => setActionError(errorText(error))); }}>直前取消</button></td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
