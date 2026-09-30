import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { inventoryThumbnailUrl, type InventoryImport, type InventoryItem } from '../../../../api/client';
import {
  useInventoryImportMessages,
  useInventoryImports,
  useInventoryItems,
  useInventoryLocations,
  useInventoryMutations,
  useInventoryToolFieldOptions,
} from '../../../../api/hooks';
import { InventoryPhotoDialog } from '../../../../components/kiosk/InventoryPhotoDialog';
import { AREA_DIRECTIONS, composeArea, DEFAULT_AREA_DIRECTION, splitArea } from '../areaNaming';
import { NfcPrompt } from '../NfcPrompt';

import { InventoryUnitPicker } from './InventoryUnitPicker';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

type Draft = {
  photosChecked: boolean;
  mode: 'NEW_ITEM' | 'EXISTING_ITEM' | null;
  itemId: string;
  itemName: string;
  name: string;
  model: string;
  usage: string;
  unit: string | null;
  maker: string;
  toolName: string;
  workMaterial: string;
  toolSize: string;
  /** Shelf area chosen for this item, "<machine> <direction>". */
  area: string;
  shelfId: string;
  drawerId: string;
  drawerLabel: string;
  itemTagUid: string;
  quantity: string;
};

type CheckItem = { id: string; label: string; done: boolean; detail: string; optional?: boolean };

const QUANTITY_MAX_DIGITS = 6;

function emptyDraft(candidate: InventoryImport | null): Draft {
  return {
    photosChecked: false,
    mode: null,
    itemId: '',
    itemName: '',
    name: candidate ? `ItemlistRaspi ${candidate.sourceItemId}` : '',
    model: '',
    usage: '',
    unit: null,
    maker: '',
    toolName: '',
    workMaterial: '',
    toolSize: '',
    area: '',
    shelfId: '',
    drawerId: '',
    drawerLabel: '',
    itemTagUid: '',
    quantity: '',
  };
}

/** What is done and what is left, in the order a worker does it. */
export function registrationChecklist(draft: Draft, photoCount: number): CheckItem[] {
  const items: CheckItem[] = [
    { id: 'photos', label: '写真の確認', done: draft.photosChecked, detail: draft.photosChecked ? `${photoCount}枚` : 'まだ' },
    {
      id: 'mode',
      label: '新規か既存か',
      done: draft.mode === 'NEW_ITEM' || (draft.mode === 'EXISTING_ITEM' && Boolean(draft.itemId)),
      detail: draft.mode === 'NEW_ITEM' ? '新規' : draft.mode === 'EXISTING_ITEM' ? (draft.itemId ? draft.itemName : '追加先を選ぶ') : 'まだ',
    },
    { id: 'names', label: '名前・工具情報・単位', done: true, optional: true, detail: `単位 ${draft.unit || '個'}` },
  ];
  if (draft.mode === 'EXISTING_ITEM') return items;
  return [
    ...items,
    { id: 'place', label: '置き場所', done: Boolean(draft.drawerId), detail: draft.drawerId ? draft.drawerLabel : 'まだ' },
    { id: 'tag', label: 'アイテムタグ', done: Boolean(draft.itemTagUid), detail: draft.itemTagUid ? '読み取り済み' : 'まだ' },
    { id: 'quantity', label: '最初の数', done: draft.quantity !== '', detail: draft.quantity !== '' ? `${draft.quantity}${draft.unit || '個'}` : 'まだ' },
  ];
}

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '処理に失敗しました';
}

// Fixed, content-sized controls: 44px high, width from the label, never stretched to the screen.
const choiceBase = 'h-11 rounded-lg px-4 text-base font-bold disabled:cursor-not-allowed';
const choiceOn = `${choiceBase} border-2 border-sky-400 bg-sky-950/60 text-white`;
const choiceOff = `${choiceBase} border border-white/25 bg-slate-800 text-white/90 hover:bg-slate-700`;
const numberOn = 'h-11 w-16 rounded-lg border-2 border-sky-400 bg-sky-950/60 text-base font-bold text-white';
const numberOff = 'h-11 w-16 rounded-lg border border-white/25 bg-slate-800 text-base font-bold text-white/90 hover:bg-slate-700 disabled:border-slate-800 disabled:bg-slate-950 disabled:text-sm disabled:font-normal disabled:text-white/30';
const directionOn = 'h-11 w-14 rounded-lg border-2 border-sky-400 bg-sky-950/60 text-base font-bold text-white';
const directionOff = 'h-11 w-14 rounded-lg border border-white/25 bg-slate-800 text-base font-bold text-white/90 hover:bg-slate-700';
const addClass = 'h-11 rounded-lg border border-dashed border-white/40 px-3 text-sm text-white/85 hover:bg-slate-800 disabled:opacity-40';
const smallButton = 'h-9 rounded-md border border-white/25 bg-slate-800 px-3 text-sm text-white hover:bg-slate-700 disabled:opacity-40';
const inputClass = 'h-10 rounded-md border border-white/25 bg-slate-950 px-2.5 text-base text-white focus:border-sky-400 focus:outline-none';
const keyClass = 'h-10 w-[52px] rounded-md border border-white/15 bg-slate-800 text-lg font-bold text-white hover:bg-slate-700';

function StepMark({ number, done, current }: { number: number; done: boolean; current: boolean }) {
  if (done) return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white" aria-hidden="true">✓</span>;
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${current ? 'border-amber-400 text-amber-300' : 'border-slate-500 text-slate-400'}`} aria-hidden="true">
      {number}
    </span>
  );
}

function Row({ id, number, title, done, current, alignTop, aside, children }: { id: string; number: number; title: string; done: boolean; current: boolean; alignTop?: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={`registration-${id}`} aria-label={title} className={`grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-b border-slate-800 py-3 last:border-b-0 ${alignTop ? 'items-start' : 'items-center'}`}>
      <div className={`flex flex-col gap-2 ${alignTop ? 'pt-2.5' : ''}`}>
        <div className="flex items-center gap-2">
          <StepMark number={number} done={done} current={current} />
          <h3 className="text-base font-bold text-white">{title}</h3>
        </div>
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function QuantityKeypad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const press = (digit: string) => {
    if (value.length >= QUANTITY_MAX_DIGITS) return;
    onChange(`${value}${digit}`.replace(/^0+(?=\d)/, ''));
  };
  return (
    <div role="group" aria-label="最初の数のテンキー" className="grid grid-cols-[repeat(6,52px)] gap-1.5">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'].map((digit) => (
        <button key={digit} type="button" className={keyClass} onClick={() => press(digit)}>{digit}</button>
      ))}
      <button type="button" className={`${keyClass} text-sm font-normal`} onClick={() => onChange(value.slice(0, -1))}>消す</button>
      <button type="button" className={`${keyClass} text-sm font-normal text-amber-200`} onClick={() => onChange('')}>クリア</button>
    </div>
  );
}

type TextFieldKey = 'name' | 'model' | 'usage' | 'maker' | 'toolName' | 'workMaterial' | 'toolSize';
const TEXT_FIELDS: Array<{ key: TextFieldKey; label: string; aria?: string }> = [
  { key: 'name', label: '名前', aria: 'アイテム名' },
  { key: 'model', label: '型式' },
  { key: 'maker', label: 'メーカー' },
  { key: 'toolName', label: '工具名' },
  { key: 'workMaterial', label: '被削材' },
  { key: 'toolSize', label: '工具寸法' },
  { key: 'usage', label: '用途' },
];
const TOOL_OPTION_COLUMNS: Array<{ key: 'maker' | 'toolName' | 'workMaterial' | 'toolSize' | 'model' | 'usage'; label: string }> = [
  { key: 'maker', label: 'メーカー' },
  { key: 'toolName', label: '工具名' },
  { key: 'workMaterial', label: '被削材' },
  { key: 'toolSize', label: '工具寸法' },
  { key: 'model', label: '型式' },
  { key: 'usage', label: '用途' },
];

export function InventoryRegistrationTab({ accessPassword }: { accessPassword: string }) {
  const importsQuery = useInventoryImports(accessPassword);
  const messagesQuery = useInventoryImportMessages(accessPassword);
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword);
  const candidates = useMemo(() => importsQuery.data ?? [], [importsQuery.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const candidate = candidates.find((entry) => entry.id === selectedId) ?? candidates[0] ?? null;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(candidate));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; alt: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const toolOptions = useInventoryToolFieldOptions(optionsOpen);
  const [manualUid, setManualUid] = useState('');
  const itemsQuery = useInventoryItems(draft.mode !== null);
  const waitingForTag = draft.mode === 'NEW_ITEM' && Boolean(draft.drawerId) && !draft.itemTagUid;
  const read = useArmedNfcRead(waitingForTag);
  const handledRef = useRef<NfcEvent | null>(null);
  const failedMessages = (messagesQuery.data ?? []).filter((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING');
  const photoPending = mutations.deleteImportPhoto.isPending || mutations.reorderImportPhotos.isPending;

  // A different candidate starts over.
  const candidateId = candidate?.id ?? null;
  useEffect(() => {
    setDraft(emptyDraft(candidate));
    setError(null);
    setConfirmDeletePhotoId(null);
    setManualOpen(false);
    // Only the candidate identity matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  useEffect(() => {
    if (!read || handledRef.current === read) return;
    handledRef.current = read;
    setDraft((current) => ({ ...current, itemTagUid: read.uid }));
  }, [read]);

  // The mail location is the machine; the shelf area is "<machine> <direction>" or another machine's area.
  const machine = candidate?.area ?? '';
  const previousArea = useMemo(() => {
    const earlier = (itemsQuery.data ?? []).find((item) => item.area === machine && item.compartments.length > 0);
    return earlier?.compartments[0]?.area ?? null;
  }, [itemsQuery.data, machine]);
  const defaultArea = previousArea ?? (machine ? composeArea(machine, DEFAULT_AREA_DIRECTION) : '');
  useEffect(() => {
    if (draft.mode !== 'NEW_ITEM' || draft.area || !defaultArea || itemsQuery.isLoading) return;
    setDraft((current) => (current.area ? current : { ...current, area: defaultArea }));
  }, [defaultArea, draft.area, draft.mode, itemsQuery.isLoading]);
  const selectedSplit = splitArea(draft.area);
  const selectedDirection = selectedSplit.machine === machine ? selectedSplit.direction : null;
  const otherAreas = useMemo(
    () => [...new Set((locationsQuery.data ?? []).map((shelf) => shelf.area))].filter((area) => splitArea(area).machine !== machine).sort((a, b) => a.localeCompare(b, 'ja')),
    [locationsQuery.data, machine],
  );
  const areaShelves = useMemo(
    () => (locationsQuery.data ?? []).filter((shelf) => shelf.area === draft.area).sort((a, b) => a.shelfNumber - b.shelfNumber),
    [draft.area, locationsQuery.data],
  );
  const chooseArea = (area: string) => update({ area, shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '' });
  const shelf = areaShelves.find((entry) => entry.id === draft.shelfId) ?? null;
  const nextShelfNumber = areaShelves.length === 0 ? 1 : Math.max(...areaShelves.map((entry) => entry.shelfNumber)) + 1;
  const nextDrawerNumber = !shelf || shelf.drawers.length === 0 ? 1 : Math.max(...shelf.drawers.map((drawer) => drawer.drawerNumber)) + 1;
  const creating = mutations.createShelf.isPending || mutations.createDrawer.isPending;
  // A shelf or drawer created here is selected as soon as it appears in the refreshed list.
  const [autoSelect, setAutoSelect] = useState<{ kind: 'shelf'; shelfNumber: number } | { kind: 'drawer'; shelfId: string; drawerNumber: number } | null>(null);
  useEffect(() => {
    if (!autoSelect) return;
    if (autoSelect.kind === 'shelf') {
      const created = areaShelves.find((entry) => entry.shelfNumber === autoSelect.shelfNumber);
      if (!created) return;
      setDraft((current) => ({ ...current, shelfId: created.id, drawerId: '', drawerLabel: '', itemTagUid: '' }));
    } else {
      const parent = areaShelves.find((entry) => entry.id === autoSelect.shelfId);
      const created = parent?.drawers.find((drawer) => drawer.drawerNumber === autoSelect.drawerNumber);
      if (!parent || !created) return;
      setDraft((current) => ({ ...current, drawerId: created.id, drawerLabel: `${parent.area}・棚${parent.shelfNumber}・引出し${created.drawerNumber}`, itemTagUid: '' }));
    }
    setAutoSelect(null);
  }, [areaShelves, autoSelect]);
  const createShelf = async () => {
    if (!candidate) return;
    setError(null);
    try {
      if (!draft.area) return;
      await mutations.createShelf.mutateAsync({ area: draft.area, shelfNumber: nextShelfNumber });
      setAutoSelect({ kind: 'shelf', shelfNumber: nextShelfNumber });
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const createDrawer = async () => {
    if (!shelf) return;
    setError(null);
    try {
      await mutations.createDrawer.mutateAsync({ shelfId: shelf.id, drawerNumber: nextDrawerNumber });
      setAutoSelect({ kind: 'drawer', shelfId: shelf.id, drawerNumber: nextDrawerNumber });
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const checklist = registrationChecklist(draft, candidate?.photos.length ?? 0);
  const remaining = checklist.filter((entry) => !entry.done).length;
  const currentId = checklist.find((entry) => !entry.done)?.id ?? null;
  const isDone = (id: string) => checklist.find((entry) => entry.id === id)?.done ?? false;

  const movePhoto = (index: number, offset: -1 | 1) => {
    if (!candidate) return;
    const ids = candidate.photos.map((photo) => photo.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setError(null);
    void mutations.reorderImportPhotos.mutateAsync({ payloadId: candidate.id, photoIds: ids }).catch((caught) => setError(errorText(caught)));
  };
  const deletePhoto = (photoId: string) => {
    if (!candidate) return;
    setConfirmDeletePhotoId(null);
    setError(null);
    void mutations.deleteImportPhoto.mutateAsync({ payloadId: candidate.id, photoId }).catch((caught) => setError(errorText(caught)));
  };
  const chooseExisting = (item: InventoryItem) => {
    update({ itemId: item.id, itemName: item.name, name: item.name, model: item.model ?? '', usage: item.usage ?? '', unit: item.unit, maker: item.maker ?? '', toolName: item.toolName ?? '', workMaterial: item.workMaterial ?? '', toolSize: item.toolSize ?? '' });
  };

  const register = async () => {
    if (!candidate || !draft.mode || remaining > 0) return;
    setError(null);
    const isNew = draft.mode === 'NEW_ITEM';
    try {
      await mutations.registerImport.mutateAsync({
        id: candidate.id,
        input: {
          mode: draft.mode,
          itemId: isNew ? undefined : draft.itemId || undefined,
          name: draft.name,
          model: draft.model,
          usage: draft.usage,
          shelfId: isNew ? draft.shelfId || undefined : undefined,
          drawerId: isNew ? draft.drawerId || undefined : undefined,
          itemTagUid: isNew ? draft.itemTagUid || undefined : undefined,
          initialQuantity: isNew ? Number(draft.quantity || '0') : undefined,
          unit: draft.unit,
          maker: draft.maker,
          toolName: draft.toolName,
          workMaterial: draft.workMaterial,
          toolSize: draft.toolSize,
        },
      });
      setDone(`候補 #${candidate.sourceItemId} を登録しました`);
      setSelectedId(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const retryPanel = failedMessages.length > 0 ? (
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-sm text-white/85" aria-label="取込エラー">
      <span className="font-bold text-white">写真メールの取込に失敗:</span>
      {failedMessages.map((entry) => (
        <span key={entry.id} className="flex items-center gap-2">
          {entry.errorMessage ?? '再試行できるエラー'}
          <button type="button" className={smallButton} disabled={mutations.retryImport.isPending} onClick={() => void mutations.retryImport.mutateAsync(entry.id).catch((caught) => setError(errorText(caught)))}>もう一度取り込む</button>
        </span>
      ))}
    </section>
  ) : null;
  const doneBanner = done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 px-3 py-2 text-base font-semibold text-emerald-100" role="status">{done}</p> : null;

  if (!candidate) {
    return (
      <div className="flex flex-col gap-3">
        {doneBanner}
        {retryPanel}
        <p className="rounded-lg border border-white/15 bg-slate-900/60 p-6 text-center text-base text-white/70">{importsQuery.isLoading ? '読み込み中…' : '登録待ちの候補はありません'}</p>
      </div>
    );
  }

  let stepNumber = 1;
  const next = () => { stepNumber += 1; return stepNumber; };

  return (
    <div className="flex flex-col gap-3">
      {doneBanner}
      {retryPanel}
      <div className="grid h-[calc(100dvh-11rem)] min-h-[640px] grid-cols-[692px_minmax(0,1fr)_340px] gap-4">
        <section aria-label="写真の確認" className="flex min-h-0 flex-col gap-2.5 rounded-lg border border-slate-700 bg-slate-900/70 p-3.5">
          <div className="flex items-center gap-2">
            <StepMark number={1} done={isDone('photos')} current={currentId === 'photos'} />
            <h3 className="text-base font-bold text-white">写真の確認</h3>
            <span className="min-w-0 flex-1 truncate text-sm text-white/60">加工機 {candidate.area} ・ 分類 {candidate.category ?? '-'} ・ メモ {candidate.note ?? '-'}</span>
            <button type="button" aria-pressed={draft.photosChecked} className={draft.photosChecked ? 'h-10 shrink-0 rounded-lg border-2 border-emerald-500 bg-emerald-950 px-3.5 text-[15px] font-bold text-emerald-100' : 'h-10 shrink-0 rounded-lg border border-white/25 bg-slate-800 px-3.5 text-[15px] font-bold text-white hover:bg-slate-700'} onClick={() => update({ photosChecked: !draft.photosChecked })}>
              {draft.photosChecked ? '✓ 写真を確認した' : '写真を確認した'}
            </button>
          </div>
          {candidate.photos.length === 0 ? <p className="text-sm text-white/60">写真はありません</p> : null}
          {/* Two rows fill the pane; more than four photos scroll inside it. */}
          <div className="grid min-h-0 flex-1 auto-rows-[calc(50%-0.3125rem)] grid-cols-2 gap-2.5 overflow-y-auto">
            {candidate.photos.map((photo, index) => (
              <figure key={photo.id} className="flex min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-950 p-1.5">
                <button type="button" className="block min-h-0 w-full flex-1" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.filename })}>
                  <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.filename} className="h-full w-full rounded object-cover" />
                </button>
                {confirmDeletePhotoId === photo.id ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="flex-1 text-sm text-red-100">この写真を消しますか？</span>
                    <button type="button" className="h-9 rounded-md bg-red-600 px-3 text-sm font-bold text-white disabled:opacity-40" disabled={photoPending} onClick={() => deletePhoto(photo.id)}>消す</button>
                    <button type="button" className={smallButton} onClick={() => setConfirmDeletePhotoId(null)}>やめる</button>
                  </div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button type="button" className={`${smallButton} w-11`} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || photoPending} onClick={() => movePhoto(index, -1)}>←</button>
                    <button type="button" className={`${smallButton} w-11`} aria-label={`写真${index + 1}を後ろへ`} disabled={index === candidate.photos.length - 1 || photoPending} onClick={() => movePhoto(index, 1)}>→</button>
                    <span className="flex-1" />
                    <button type="button" className="h-9 rounded-md border border-red-400 px-3 text-sm text-red-100 hover:bg-red-950 disabled:opacity-40" aria-label={`写真${index + 1}を削除`} disabled={photoPending} onClick={() => setConfirmDeletePhotoId(photo.id)}>削除</button>
                  </div>
                )}
              </figure>
            ))}
          </div>
        </section>

        <div className="relative flex min-h-0 flex-col overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-1.5">
          <Row id="mode" number={next()} title="新規か既存か" done={isDone('mode')} current={currentId === 'mode'}>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={draft.mode === 'NEW_ITEM'} className={draft.mode === 'NEW_ITEM' ? choiceOn : choiceOff} onClick={() => update({ mode: 'NEW_ITEM', area: '', shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '', itemId: '', itemName: '', name: `ItemlistRaspi ${candidate.sourceItemId}`, model: '', usage: '' })}>新規登録</button>
              <button type="button" aria-pressed={draft.mode === 'EXISTING_ITEM'} className={draft.mode === 'EXISTING_ITEM' ? choiceOn : choiceOff} onClick={() => update({ mode: 'EXISTING_ITEM', shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '', quantity: '' })}>既存のアイテムに写真を追加</button>
            </div>
            {draft.mode === 'EXISTING_ITEM' ? (
              <div className="mt-2 flex max-h-44 flex-wrap gap-2 overflow-y-auto" aria-label="追加先のアイテム">
                {itemsQuery.isLoading ? <p className="text-sm text-white/60">読み込み中…</p> : null}
                {(itemsQuery.data ?? []).map((item) => (
                  <button key={item.id} type="button" aria-pressed={item.id === draft.itemId} className={`flex h-14 w-64 items-center gap-2 rounded-lg border px-2 text-left text-white ${item.id === draft.itemId ? 'border-2 border-sky-400 bg-sky-950/60' : 'border-slate-700 bg-slate-950 hover:bg-slate-800'}`} onClick={() => chooseExisting(item)}>
                    {item.photos[0] ? <img src={inventoryThumbnailUrl(item.photos[0].photoUrl)} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="h-10 w-10 rounded bg-slate-800" aria-hidden="true" />}
                    <span className="min-w-0"><span className="block truncate text-sm font-bold">{item.name}</span><span className="text-xs text-white/60">{item.itemCode}</span></span>
                  </button>
                ))}
              </div>
            ) : null}
          </Row>

          <Row
            id="names"
            number={next()}
            title="名前・工具情報"
            done={isDone('names')}
            current={false}
            alignTop
            aside={<button type="button" aria-expanded={optionsOpen} className="h-9 self-start rounded-md border-2 border-sky-400 bg-sky-950/60 px-2.5 text-[13px] font-bold text-sky-100" onClick={() => setOptionsOpen((open) => !open)}>▼ 登録済みから選ぶ</button>}
          >
            <div className="grid grid-cols-[repeat(2,max-content)] gap-x-4 gap-y-2">
              {TEXT_FIELDS.map((field) => (
                <label key={field.key} className="flex items-center gap-1.5">
                  <span className="w-[60px] text-sm text-white/60">{field.label}</span>
                  <input aria-label={field.aria ?? field.label} placeholder={field.key === 'name' ? undefined : '省略可'} className={`${inputClass} w-[220px]`} value={draft[field.key]} onChange={(event) => update({ [field.key]: event.target.value } as Partial<Draft>)} />
                </label>
              ))}
            </div>
            {optionsOpen ? (
              // Fixed to the screen so the scrolling centre column cannot clip it.
              <div role="dialog" aria-label="登録済みの値から選ぶ" className="fixed left-1/2 top-32 z-50 flex w-[1000px] -translate-x-1/2 flex-col gap-2.5 rounded-xl border-2 border-sky-400 bg-slate-900 p-3.5 shadow-2xl">
                <div className="flex items-center gap-2">
                  <strong className="text-white">登録済みの値から選ぶ</strong>
                  <span className="text-[13px] text-white/60">押した値がその欄に入ります</span>
                  <span className="flex-1" />
                  <button type="button" className="h-9 rounded-md border border-white/25 px-3 text-sm text-white" onClick={() => setOptionsOpen(false)}>閉じる</button>
                </div>
                <div className="flex gap-3">
                  {TOOL_OPTION_COLUMNS.map((column) => {
                    const values = toolOptions.data?.[column.key] ?? [];
                    return (
                      <div key={column.key} className="flex max-h-[26rem] w-[150px] flex-col gap-1.5 overflow-y-auto" role="group" aria-label={column.label}>
                        <span className="text-[13px] font-bold text-white/80">{column.label}</span>
                        {values.length === 0 ? <span className="text-sm text-white/40">まだありません</span> : null}
                        {values.map((value) => (
                          <button key={value} type="button" aria-pressed={draft[column.key] === value} className={`h-9 rounded-md px-2.5 text-left text-sm text-white ${draft[column.key] === value ? 'border-2 border-sky-400 bg-sky-950/60' : 'border border-slate-700 bg-slate-950 hover:bg-slate-800'}`} onClick={() => update({ [column.key]: value } as Partial<Draft>)}>{value}</button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </Row>

          <Row id="unit" number={next()} title="単位" done current={false}>
            <InventoryUnitPicker value={draft.unit} onChange={(unit) => update({ unit })} accessPassword={accessPassword} />
          </Row>

          {draft.mode !== 'EXISTING_ITEM' ? (
            <>
              <Row id="place" number={next()} title="置き場所" done={isDone('place')} current={currentId === 'place'} alignTop>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="加工機と向き">
                    <span className="w-14 text-sm text-white/60">加工機</span>
                    <span className="flex h-11 items-center rounded-lg border border-slate-700 bg-slate-950 px-3 font-bold text-white">{machine}</span>
                    <span className="w-3" />
                    {AREA_DIRECTIONS.map((direction) => (
                      <button key={direction} type="button" aria-label={`${machine} ${direction}`} aria-pressed={direction === selectedDirection} className={direction === selectedDirection ? directionOn : directionOff} onClick={() => chooseArea(composeArea(machine, direction))}>{direction}</button>
                    ))}
                    {previousArea && draft.area === previousArea ? <span className="ml-2 text-sm text-white/60">前回この加工機で使った場所</span> : null}
                  </div>
                  {otherAreas.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="ほかの加工機の棚">
                      <span className="w-14 text-sm text-white/60">ほか</span>
                      <span className="text-sm text-white/60">ほかの加工機の棚に置く:</span>
                      {otherAreas.map((area) => (
                        <button key={area} type="button" aria-pressed={area === draft.area} className={`h-9 rounded-lg px-2.5 text-sm ${area === draft.area ? 'border-2 border-sky-400 bg-sky-950/60 font-bold text-white' : 'border border-white/25 bg-slate-800 text-white/90 hover:bg-slate-700'}`} onClick={() => chooseArea(area)}>{area}</button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 rounded-md bg-slate-950 px-2.5 py-1.5">
                    <span className="text-sm text-white/60">エリア</span>
                    <span className="font-bold text-white">{draft.area || '—'}</span>
                    {draft.area && areaShelves.length === 0 ? <span className="ml-2 text-sm text-amber-100">このエリアの棚はまだありません</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="棚">
                    <span className="w-14 text-sm text-white/60">棚</span>
                    {areaShelves.map((entry) => (
                      <button key={entry.id} type="button" aria-label={`棚${entry.shelfNumber}`} aria-pressed={entry.id === draft.shelfId} className={entry.id === draft.shelfId ? numberOn : numberOff} onClick={() => update({ shelfId: entry.id, drawerId: '', drawerLabel: '', itemTagUid: '' })}>{entry.shelfNumber}</button>
                    ))}
                    <button type="button" className={addClass} disabled={creating || !draft.area} onClick={() => void createShelf()}>＋ 棚{nextShelfNumber}を作る</button>
                  </div>
                  {shelf ? (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="引き出し">
                      <span className="w-14 text-sm text-white/60">引出し</span>
                      {shelf.drawers.map((drawer) => {
                        const used = drawer.compartments.length > 0;
                        return (
                          <button key={drawer.id} type="button" disabled={used} aria-label={`引出し${drawer.drawerNumber}${used ? ' 使用中' : ''}`} aria-pressed={drawer.id === draft.drawerId} className={drawer.id === draft.drawerId ? numberOn : numberOff} onClick={() => update({ drawerId: drawer.id, drawerLabel: `${shelf.area}・棚${shelf.shelfNumber}・引出し${drawer.drawerNumber}`, itemTagUid: '' })}>
                            {drawer.drawerNumber}{used ? ' 使用' : ''}
                          </button>
                        );
                      })}
                      <button type="button" className={addClass} disabled={creating} onClick={() => void createDrawer()}>＋ 引出し{nextDrawerNumber}を作る</button>
                    </div>
                  ) : null}
                </div>
              </Row>

              <Row id="tag" number={next()} title="アイテムタグ" done={isDone('tag')} current={currentId === 'tag'}>
                {!draft.drawerId ? <p className="text-sm text-white/60">置き場所のあと</p> : null}
                {waitingForTag ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <NfcPrompt size="small" tone="amber" label="アイテムタグ" sub={draft.drawerLabel} />
                    {manualOpen ? (
                      <span className="flex items-center gap-2">
                        <input aria-label="タグのID" placeholder="タグのID" className={`${inputClass} w-56`} value={manualUid} onChange={(event) => setManualUid(event.target.value)} />
                        <button type="button" className={smallButton} disabled={!manualUid.trim()} onClick={() => { update({ itemTagUid: manualUid.trim() }); setManualUid(''); setManualOpen(false); }}>使う</button>
                      </span>
                    ) : (
                      <button type="button" className="text-sm text-sky-300 underline" onClick={() => setManualOpen(true)}>IDを手で入れる</button>
                    )}
                  </div>
                ) : null}
                {draft.itemTagUid ? (
                  <div className="flex items-center gap-3">
                    <p className="text-base text-white">タグ {draft.itemTagUid} を読み取りました</p>
                    <button type="button" className={smallButton} onClick={() => update({ itemTagUid: '' })}>読み直す</button>
                  </div>
                ) : null}
              </Row>

              <Row id="quantity" number={next()} title="最初の数" done={isDone('quantity')} current={currentId === 'quantity'} alignTop>
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-1.5">
                    <output aria-label="最初の数" className="flex h-11 w-28 items-center justify-end rounded-md border border-white/25 bg-slate-950 px-2.5 text-xl font-bold text-white">{draft.quantity === '' ? '—' : draft.quantity}</output>
                    <span className="text-white/60">{draft.unit || '個'}</span>
                  </div>
                  <QuantityKeypad value={draft.quantity} onChange={(value) => update({ quantity: value })} />
                </div>
              </Row>
            </>
          ) : null}
        </div>

        <aside aria-label="登録の進み具合" className="flex min-h-0 flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-3.5">
          <h3 className="text-base font-bold text-white">候補 #{candidate.sourceItemId} の登録</h3>
          {candidates.length > 1 ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="メールで届いた候補">
              {candidates.map((entry) => (
                <button key={entry.id} type="button" aria-pressed={entry.id === candidate.id} className={`h-9 rounded-md px-2.5 text-sm ${entry.id === candidate.id ? 'border-2 border-sky-400 bg-sky-950/60 font-bold text-white' : 'border border-slate-700 bg-slate-950 text-white/80'}`} onClick={() => { setSelectedId(entry.id); setDone(null); }}>
                  #{entry.sourceItemId}（写真{entry.photos.length}）
                </button>
              ))}
            </div>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {checklist.map((entry) => {
              const current = entry.id === currentId;
              return (
                <li key={entry.id} className={`flex h-10 items-center gap-2.5 rounded-md px-2.5 ${current ? 'border border-amber-600 bg-amber-950/60' : 'bg-slate-950'}`}>
                  <span className={`w-4 font-bold ${entry.done ? 'text-emerald-400' : current ? 'text-amber-300' : 'text-slate-500'}`} aria-hidden="true">{entry.done ? '✓' : '○'}</span>
                  <span className={`flex-1 truncate ${entry.done ? 'text-white' : current ? 'text-amber-100' : 'text-white/60'}`}>{entry.label}{entry.done ? '' : '（まだ）'}</span>
                  <span className={`max-w-[9rem] truncate text-sm ${current ? 'text-amber-100' : 'text-white/50'}`}>{current ? 'いまここ' : entry.detail}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex-1" />
          {error ? <p className="rounded border border-red-400/50 bg-red-950/60 px-3 py-2 text-sm text-red-100" role="alert">{error}</p> : null}
          <p className="text-center text-base font-bold text-white" aria-live="polite">{remaining === 0 ? '登録できます' : `あと ${remaining} つ`}</p>
          <button type="button" className="h-[52px] rounded-lg bg-emerald-600 text-lg font-bold text-white hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-white/40" disabled={remaining > 0 || mutations.registerImport.isPending} onClick={() => void register()}>
            {mutations.registerImport.isPending ? '登録中…' : '登録する'}
          </button>
        </aside>
      </div>
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
}
