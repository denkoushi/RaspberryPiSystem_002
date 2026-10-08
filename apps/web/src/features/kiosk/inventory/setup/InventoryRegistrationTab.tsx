import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

import { inventoryThumbnailUrl, type InventoryImport, type InventoryItem } from '../../../../api/client';
import {
  useInventoryImportMessages,
  useInventoryImports,
  useInventoryItems,
  useInventoryLocations,
  useInventoryMutations,
} from '../../../../api/hooks';
import { InventoryPhotoDialog } from '../../../../components/kiosk/InventoryPhotoDialog';
import { AREA_DIRECTIONS, composeArea, DEFAULT_AREA_DIRECTION, splitArea } from '../areaNaming';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, PlusIcon, TrashIcon } from '../InventoryIcons';
import {
  invButtonGo,
  invButtonSm,
  invButtonSmGhost,
  invError,
  invEyebrow,
  invField,
  invLabel,
  invPanel,
  invSeg,
  invSegAdd,
  invSuccess,
} from '../inventoryUi';
import { NfcPrompt } from '../NfcPrompt';

import { InventoryUnitPicker } from './InventoryUnitPicker';
import { ToolValueBoard } from './ToolValueBoard';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

export type Draft = {
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
  manualUid: string;
  quantity: string;
};

type CheckItem = { id: string; label: string; done: boolean; detail: string; optional?: boolean };

const QUANTITY_MAX_DIGITS = 6;

function emptyDraft(candidate: InventoryImport | null): Draft {
  return {
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
    manualUid: '',
    quantity: '',
  };
}

/** What is done and what is left, in the order a worker does it. */
export function registrationChecklist(draft: Draft): CheckItem[] {
  const items: CheckItem[] = [
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

// Fixed, content-sized controls: never stretched to the screen.
const keyClass = 'h-10 w-12 rounded-lg border border-inv-line2 bg-inv-s2 text-[17px] font-black text-inv-text hover:bg-inv-s3';
const iconSm = `${invButtonSm} w-9 px-0`;

function StepMark({ number, done, current }: { number: number; done: boolean; current: boolean }) {
  if (done) return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-inv-green text-inv-green-ink" aria-hidden="true"><CheckIcon size={13} /></span>;
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black ${current ? 'border-inv-amber text-inv-amber' : 'border-inv-line2 text-inv-faint'}`} aria-hidden="true">
      {number}
    </span>
  );
}

function Row({ id, number, title, done, current, alignTop, aside, children }: { id: string; number: number; title: string; done: boolean; current: boolean; alignTop?: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={`registration-${id}`} aria-label={title} className={`grid grid-cols-[148px_minmax(0,1fr)] gap-3 border-b border-inv-line py-3 last:border-b-0 ${alignTop ? 'items-start' : 'items-center'}`}>
      <div className={`flex flex-col gap-2 ${alignTop ? 'pt-2.5' : ''}`}>
        <div className="flex items-center gap-2">
          <StepMark number={number} done={done} current={current} />
          <h3 className="text-[15px] font-black">{title}</h3>
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
    <div role="group" aria-label="最初の数のテンキー" className="grid grid-cols-[repeat(6,48px)] gap-1.5">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'].map((digit) => (
        <button key={digit} type="button" className={keyClass} onClick={() => press(digit)}>{digit}</button>
      ))}
      <button type="button" className={`${keyClass} text-[13px] font-bold text-inv-muted`} onClick={() => onChange(value.slice(0, -1))}>消す</button>
      <button type="button" className={`${keyClass} text-[13px] font-bold text-inv-muted`} onClick={() => onChange('')}>クリア</button>
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
export type RegistrationState = { selectedId: string | null; draft: Draft | null };

export function InventoryRegistrationTab({ accessPassword, registration, setRegistration }: {
  accessPassword: string;
  registration: RegistrationState;
  setRegistration: Dispatch<SetStateAction<RegistrationState>>;
}) {
  const importsQuery = useInventoryImports(accessPassword);
  const messagesQuery = useInventoryImportMessages(accessPassword);
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword);
  // Newest first, like the unregistered cards on the daily list.
  const candidates = useMemo(() => [...(importsQuery.data ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [importsQuery.data]);
  const { selectedId } = registration;
  const completedIdRef = useRef<string | null>(null);
  const setSelectedId = (id: string | null) => setRegistration({ selectedId: id, draft: null });
  const candidate = selectedId ? candidates.find((entry) => entry.id === selectedId) ?? null : candidates.find((entry) => entry.id !== completedIdRef.current) ?? null;
  const draft = registration.draft ?? emptyDraft(candidate);
  const setDraft = useCallback((update: SetStateAction<Draft>) => setRegistration((current) => ({
    selectedId: current.selectedId ?? candidate?.id ?? null,
    draft: typeof update === 'function' ? update(current.draft ?? emptyDraft(candidate)) : update,
  })), [candidate, setRegistration]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; alt: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const itemsQuery = useInventoryItems(draft.mode !== null);
  const waitingForTag = draft.mode === 'NEW_ITEM' && Boolean(draft.drawerId) && !draft.itemTagUid;
  const read = useArmedNfcRead(waitingForTag);
  const handledRef = useRef<NfcEvent | null>(null);
  const failedMessages = (messagesQuery.data ?? []).filter((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING');
  const photoPending = mutations.deleteImportPhoto.isPending || mutations.reorderImportPhotos.isPending;

  // A different candidate starts over.
  const candidateId = candidate?.id ?? null;
  useEffect(() => {
    if (candidate && !registration.draft) setRegistration({ selectedId: candidate.id, draft: emptyDraft(candidate) });
  }, [candidate, registration.draft, setRegistration]);

  // The chosen candidate is gone (registered on another terminal): fall back to the newest one.
  const selectedGone = Boolean(selectedId) && !candidate && importsQuery.data !== undefined && !importsQuery.isFetching;
  useEffect(() => {
    if (selectedGone) setRegistration({ selectedId: null, draft: null });
  }, [selectedGone, setRegistration]);

  useEffect(() => {
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
  }, [read, setDraft]);

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
  }, [defaultArea, draft.area, draft.mode, itemsQuery.isLoading, setDraft]);
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
  }, [areaShelves, autoSelect, setDraft]);
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
  const checklist = registrationChecklist(draft);
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
  // Only coming back from an existing item clears what that item filled in; a name or tool
  // information entered before this button is pressed must survive it.
  const chooseNew = () => {
    if (draft.mode === 'NEW_ITEM') return;
    if (draft.mode === 'EXISTING_ITEM' && draft.itemId) {
      update({ mode: 'NEW_ITEM', area: '', shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '', manualUid: '', itemId: '', itemName: '', name: `ItemlistRaspi ${candidate?.sourceItemId ?? ''}`, model: '', usage: '', unit: null, maker: '', toolName: '', workMaterial: '', toolSize: '' });
      return;
    }
    update({ mode: 'NEW_ITEM', itemId: '', itemName: '' });
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
      completedIdRef.current = candidate.id;
      setSelectedId(candidates.find((entry) => entry.id !== candidate.id)?.id ?? null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const retryPanel = failedMessages.length > 0 ? (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-inv-amber/40 bg-inv-amber/[0.12] px-3 py-2 text-sm text-[#ffe8bf]" aria-label="取込エラー">
      <span className="font-bold">写真メールの取込に失敗:</span>
      {failedMessages.map((entry) => (
        <span key={entry.id} className="flex items-center gap-2">
          {entry.errorMessage ?? '再試行できるエラー'}
          <button type="button" className={invButtonSm} disabled={mutations.retryImport.isPending} onClick={() => void mutations.retryImport.mutateAsync(entry.id).catch((caught) => setError(errorText(caught)))}>もう一度取り込む</button>
        </span>
      ))}
    </section>
  ) : null;
  const doneBanner = <div className="flex h-12 shrink-0 items-center overflow-hidden">{done ? <p className={`rounded-xl border px-3 py-2 text-base font-bold ${invSuccess}`} role="status">{done}</p> : null}</div>;

  if (!candidate) {
    return (
      <div className="flex flex-col gap-3">
        {doneBanner}
        {retryPanel}
        <p className={`${invPanel} p-6 text-center text-base text-inv-muted`}>{importsQuery.isLoading ? '読み込み中…' : '登録待ちの候補はありません'}</p>
      </div>
    );
  }

  let stepNumber = 0;
  const next = () => { stepNumber += 1; return stepNumber; };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
      {doneBanner}
      {retryPanel}
      <div className="relative grid min-h-[560px] flex-1 grid-cols-[680px_minmax(0,1fr)_340px] gap-[18px]">
        {/* The photos stay in front of the shade so the name can be chosen while looking at them. */}
        <section aria-label="写真の確認" className={`${invPanel} flex min-h-0 flex-col gap-3 p-4 ${optionsOpen ? 'relative z-[45]' : ''}`}>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-black">写真の確認</h3>
            <span className="min-w-0 flex-1 truncate text-xs text-inv-faint">加工機 {candidate.area} ・ 分類 {candidate.category ?? '-'} ・ メモ {candidate.note ?? '-'}</span>
          </div>
          {candidate.photos.length === 0 ? <p className="text-sm text-inv-faint">写真はありません</p> : null}
          {/* Two rows fill the pane; more than four photos scroll inside it. */}
          <div className="grid min-h-0 flex-1 auto-rows-[calc(50%-0.375rem)] grid-cols-2 gap-3 overflow-y-auto">
            {candidate.photos.map((photo, index) => (
              <figure key={photo.id} className="flex min-h-0 flex-col gap-2">
                <button type="button" className="block min-h-0 w-full flex-1" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.filename })}>
                  <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.filename} className="h-full w-full rounded-xl border border-inv-line object-cover" />
                </button>
                {confirmDeletePhotoId === photo.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 text-sm text-[#ffb3b3]">この写真を消しますか？</span>
                    <button type="button" className={`${invButtonSm} border-inv-red/60 text-[#ffb3b3]`} disabled={photoPending} onClick={() => deletePhoto(photo.id)}>消す</button>
                    <button type="button" className={invButtonSmGhost} onClick={() => setConfirmDeletePhotoId(null)}>やめる</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button type="button" className={iconSm} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || photoPending} onClick={() => movePhoto(index, -1)}><ArrowLeftIcon /></button>
                    <button type="button" className={iconSm} aria-label={`写真${index + 1}を後ろへ`} disabled={index === candidate.photos.length - 1 || photoPending} onClick={() => movePhoto(index, 1)}><ArrowRightIcon size={16} /></button>
                    <span className="flex-1" />
                    <button type="button" className={`${iconSm} border-inv-red/45 bg-transparent text-[#ffb3b3] hover:bg-inv-red/10`} aria-label={`写真${index + 1}を削除`} disabled={photoPending} onClick={() => setConfirmDeletePhotoId(photo.id)}><TrashIcon /></button>
                  </div>
                )}
              </figure>
            ))}
          </div>
        </section>

        <div className={`${invPanel} relative flex min-h-0 flex-col overflow-y-auto px-[18px] py-1`}>
          <Row id="mode" number={next()} title="新規か既存か" done={isDone('mode')} current={currentId === 'mode'}>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={draft.mode === 'NEW_ITEM'} className={invSeg(draft.mode === 'NEW_ITEM')} onClick={chooseNew}>新規登録</button>
              <button type="button" aria-pressed={draft.mode === 'EXISTING_ITEM'} className={invSeg(draft.mode === 'EXISTING_ITEM')} onClick={() => update({ mode: 'EXISTING_ITEM', shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '', quantity: '' })}>既存のアイテムに写真を追加</button>
            </div>
            {draft.mode === 'EXISTING_ITEM' ? (
              <div className="mt-2 flex max-h-44 flex-wrap gap-2 overflow-y-auto" aria-label="追加先のアイテム">
                {itemsQuery.isLoading ? <p className="text-sm text-inv-faint">読み込み中…</p> : null}
                {(itemsQuery.data ?? []).map((item) => (
                  <button key={item.id} type="button" aria-pressed={item.id === draft.itemId} className={`flex h-14 w-64 items-center gap-2 rounded-[10px] px-2 text-left ${item.id === draft.itemId ? 'border-2 border-inv-cyan bg-inv-cyan/[0.12]' : 'border border-inv-line bg-inv-bg hover:bg-inv-s2'}`} onClick={() => chooseExisting(item)}>
                    {item.photos[0] ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(item.photos[0].photoUrl)} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="h-10 w-10 rounded bg-inv-s3" aria-hidden="true" />}
                    <span className="min-w-0"><span className="block truncate text-sm font-bold">{item.name}</span><span className="text-xs text-inv-faint">{item.itemCode}</span></span>
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
            aside={<button type="button" aria-expanded={optionsOpen} className={`${invButtonSm} self-start border-inv-cyan bg-inv-cyan/[0.12] text-[#dff8ff] hover:bg-inv-cyan/20`} onClick={() => setOptionsOpen((open) => !open)}><ChevronDownIcon />登録済みから選ぶ</button>}
          >
            <div className="grid grid-cols-[repeat(2,max-content)] gap-x-[18px] gap-y-2">
              {TEXT_FIELDS.map((field) => (
                <label key={field.key} className="flex items-center gap-2">
                  <span className={`${invLabel} w-[60px]`}>{field.label}</span>
                  <input aria-label={field.aria ?? field.label} placeholder={field.key === 'name' ? undefined : '省略可'} className={`${invField} w-[220px]`} value={draft[field.key]} onChange={(event) => update({ [field.key]: event.target.value } as Partial<Draft>)} />
                </label>
              ))}
            </div>
          </Row>

          <Row id="unit" number={next()} title="単位" done current={false}>
            <InventoryUnitPicker value={draft.unit} onChange={(unit) => update({ unit })} accessPassword={accessPassword} />
          </Row>

          {draft.mode !== 'EXISTING_ITEM' ? (
            <>
              <Row id="place" number={next()} title="置き場所" done={isDone('place')} current={currentId === 'place'} alignTop>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="加工機と向き">
                    <span className={`${invLabel} w-[52px]`}>加工機</span>
                    <span className="flex h-10 items-center rounded-lg border border-inv-line2 bg-inv-bg px-3 font-black">{machine}</span>
                    <span className="w-2" />
                    {AREA_DIRECTIONS.map((direction) => (
                      <button key={direction} type="button" aria-label={`${machine} ${direction}`} aria-pressed={direction === selectedDirection} className={invSeg(direction === selectedDirection)} onClick={() => chooseArea(composeArea(machine, direction))}>{direction}</button>
                    ))}
                    {previousArea && draft.area === previousArea ? <span className="ml-2 text-xs text-inv-faint">前回と同じ</span> : null}
                  </div>
                  {otherAreas.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="ほかの加工機の棚">
                      <span className={`${invLabel} w-[52px]`}>ほか</span>
                      {otherAreas.map((area) => (
                        <button key={area} type="button" aria-pressed={area === draft.area} className={`${invSeg(area === draft.area)} h-9 text-sm`} onClick={() => chooseArea(area)}>{area}</button>
                      ))}
                    </div>
                  ) : null}
                  {draft.area && areaShelves.length === 0 ? <p className="text-xs text-inv-amber">{draft.area} の棚はまだありません</p> : null}
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="棚">
                    <span className={`${invLabel} w-[52px]`}>棚</span>
                    {areaShelves.map((entry) => (
                      <button key={entry.id} type="button" aria-label={`棚${entry.shelfNumber}`} aria-pressed={entry.id === draft.shelfId} className={invSeg(entry.id === draft.shelfId)} onClick={() => update({ shelfId: entry.id, drawerId: '', drawerLabel: '', itemTagUid: '' })}>{entry.shelfNumber}</button>
                    ))}
                    <button type="button" className={invSegAdd} aria-label={`棚${nextShelfNumber}を作る`} disabled={creating || !draft.area} onClick={() => void createShelf()}><PlusIcon />棚{nextShelfNumber}</button>
                  </div>
                  {shelf ? (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="引き出し">
                      <span className={`${invLabel} w-[52px]`}>引出し</span>
                      {shelf.drawers.map((drawer) => {
                        const used = drawer.compartments.length > 0;
                        return (
                          <button key={drawer.id} type="button" disabled={used} aria-label={`引出し${drawer.drawerNumber}${used ? ' 使用中' : ''}`} aria-pressed={drawer.id === draft.drawerId} className={`${invSeg(drawer.id === draft.drawerId)} disabled:!opacity-[0.38]`} onClick={() => update({ drawerId: drawer.id, drawerLabel: `${shelf.area}・棚${shelf.shelfNumber}・引出し${drawer.drawerNumber}`, itemTagUid: '' })}>
                            {drawer.drawerNumber}
                          </button>
                        );
                      })}
                      <button type="button" className={invSegAdd} aria-label={`引出し${nextDrawerNumber}を作る`} disabled={creating} onClick={() => void createDrawer()}><PlusIcon /></button>
                    </div>
                  ) : null}
                </div>
              </Row>

              <Row id="tag" number={next()} title="アイテムタグ" done={isDone('tag')} current={currentId === 'tag'}>
                {!draft.drawerId ? <p className="text-sm text-inv-faint">置き場所のあと</p> : null}
                {waitingForTag ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <NfcPrompt size="small" tone="amber" label="アイテムタグ" sub={draft.drawerLabel} />
                    {manualOpen ? (
                      <span className="flex items-center gap-2">
                        <input aria-label="タグのID" placeholder="タグのID" className={`${invField} w-56`} value={draft.manualUid} onChange={(event) => update({ manualUid: event.target.value })} />
                        <button type="button" className={invButtonSm} disabled={!draft.manualUid.trim()} onClick={() => { update({ itemTagUid: draft.manualUid.trim(), manualUid: '' }); setManualOpen(false); }}>使う</button>
                      </span>
                    ) : (
                      <button type="button" className="text-[13px] text-inv-cyan underline underline-offset-2" onClick={() => setManualOpen(true)}>IDを手で入れる</button>
                    )}
                  </div>
                ) : null}
                {draft.itemTagUid ? (
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-bold ${invSuccess}`}><CheckIcon />タグ <span className="font-mono">{draft.itemTagUid}</span></span>
                    <button type="button" className={invButtonSmGhost} onClick={() => update({ itemTagUid: '' })}>読み直す</button>
                  </div>
                ) : null}
              </Row>

              <Row id="quantity" number={next()} title="最初の数" done={isDone('quantity')} current={currentId === 'quantity'} alignTop>
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-1.5">
                    <output aria-label="最初の数" className={`${invField} flex w-28 items-center justify-end text-xl font-black tabular-nums`}>{draft.quantity === '' ? '—' : draft.quantity}</output>
                    <span className="text-inv-muted">{draft.unit || '個'}</span>
                  </div>
                  <QuantityKeypad value={draft.quantity} onChange={(value) => update({ quantity: value })} />
                </div>
              </Row>
            </>
          ) : null}
        </div>

        <aside aria-label="登録の進み具合" className={`${invPanel} flex min-h-0 flex-col gap-2 p-[18px]`}>
          <p className={invEyebrow}>候補 #{candidate.sourceItemId}</p>
          <h3 className="mb-1 text-lg font-black">登録の進み具合</h3>
          <ul className="flex flex-col gap-1.5">
            {checklist.map((entry, index) => {
              const current = entry.id === currentId;
              return (
                <li key={entry.id} className={`flex h-[42px] items-center gap-2.5 rounded-[10px] px-3 ${current ? 'border border-inv-amber/40 bg-inv-amber/[0.12]' : 'bg-inv-s2'}`}>
                  <StepMark number={index + 1} done={entry.done} current={current} />
                  <span className={`flex-1 truncate ${entry.done ? 'font-bold' : current ? 'font-bold text-[#ffe8bf]' : 'text-inv-muted'}`}>{entry.label}{entry.done ? '' : <span className="sr-only">（まだ）</span>}</span>
                  <span className={`max-w-[9rem] truncate text-xs ${current ? 'text-inv-amber' : 'text-inv-faint'}`}>{current ? 'いまここ' : entry.detail}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex-1" />
          <div className="flex h-16 shrink-0 items-center overflow-hidden">{error ? <p className={`rounded-lg border px-3 py-2 text-sm ${invError}`} role="alert">{error}</p> : null}</div>
          <p className="text-center text-lg font-black tabular-nums" aria-live="polite">{remaining === 0 ? '登録できます' : `あと ${remaining} つ`}</p>
          <button type="button" className={`${invButtonGo} h-14 text-lg disabled:border-inv-line2 disabled:bg-inv-s2 disabled:text-inv-muted disabled:opacity-100`} disabled={remaining > 0 || mutations.registerImport.isPending} onClick={() => void register()}>
            {mutations.registerImport.isPending ? '登録中…' : '登録する'}
          </button>
        </aside>
        {optionsOpen ? (
          <>
            <div className="fixed inset-0 z-40 bg-[#05080d]/60" aria-hidden="true" onClick={() => setOptionsOpen(false)} />
            <ToolValueBoard
              accessPassword={accessPassword}
              current={{ name: draft.name, maker: draft.maker, toolName: draft.toolName, workMaterial: draft.workMaterial, toolSize: draft.toolSize, model: draft.model, usage: draft.usage }}
              onChange={(field, value) => update({ [field]: value } as Partial<Draft>)}
              onRenamed={(field, from, to) => setDraft((current) => (current[field] === from ? { ...current, [field]: to } : current))}
              provisionalName={draft.mode === 'EXISTING_ITEM' ? undefined : `ItemlistRaspi ${candidate.sourceItemId}`}
              onClose={() => setOptionsOpen(false)}
              className="absolute inset-y-0 left-[698px] right-0 z-50 shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(57,208,240,0.25)]"
            />
          </>
        ) : null}
      </div>
      {/* Candidates sit in their own strip below the panes so any number of them fits. */}
      <section aria-label="メールで届いた候補" className={`${invPanel} flex shrink-0 items-center gap-3 p-2.5`}>
        <p className="w-20 shrink-0 text-center leading-tight"><span className={invEyebrow}>登録待ち</span><br /><span className="text-2xl font-black tabular-nums">{candidates.length}</span><span className="text-xs text-inv-faint">件</span></p>
        <div className="flex min-w-0 gap-2.5 overflow-x-auto">
          {candidates.map((entry) => {
            const selected = entry.id === candidate.id;
            const photo = entry.photos[0];
            return (
              <button key={entry.id} type="button" aria-pressed={selected} aria-label={`候補 #${entry.sourceItemId}`} className={`flex w-[220px] shrink-0 items-center gap-2 rounded-xl border p-1.5 text-left ${selected ? 'border-2 border-inv-cyan bg-inv-cyan/[0.1]' : 'border-inv-line bg-inv-s2 hover:bg-inv-s3'}`} onClick={() => { setSelectedId(entry.id); setDone(null); }}>
                <span className="block h-[88px] w-[88px] shrink-0 overflow-hidden rounded-lg bg-inv-s3">
                  {photo ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="min-w-0">
                  <b className="block">#{entry.sourceItemId}</b>
                  <span className="block truncate text-xs text-inv-muted">{entry.area}</span>
                  <span className="block truncate text-xs text-inv-faint">{entry.category ?? '-'}・写真{entry.photos.length}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
}
