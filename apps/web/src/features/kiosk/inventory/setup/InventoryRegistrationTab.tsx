import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { inventoryThumbnailUrl, type InventoryImport, type InventoryItem, type InventoryToolFieldSuggestion } from '../../../../api/client';
import {
  useInventoryImportMessages,
  useInventoryImports,
  useInventoryItems,
  useInventoryLocations,
  useInventoryMutations,
} from '../../../../api/hooks';
import { InventoryPhotoReadDialog } from '../../../../components/kiosk/InventoryPhotoReadDialog';
import { useDismissOnOutside } from '../../../../hooks/useDismissOnOutside';
import { AREA_DIRECTIONS, composeArea, DEFAULT_AREA_DIRECTION, splitArea } from '../areaNaming';
import { CheckIcon, PlusIcon } from '../InventoryIcons';
import {
  invSetupTargets,
  invButtonGo,
  invButtonSm,
  invButtonSmGhost,
  invError,
  invField,
  invLabel,
  invLabelNumber,
  invPanel,
  invSeg,
  invSegAdd,
  invSuccess,
} from '../inventoryUi';
import { NfcPrompt } from '../NfcPrompt';

import { InventoryExistingItemPicker } from './InventoryExistingItemPicker';
import { RegistrationDetails } from './RegistrationDetails';
import { emptyDraft, registrationChecklist, type Draft, type RegistrationState } from './registrationDraft';
import { RegistrationPhotos } from './RegistrationPhotos';
import { iconSm, QuantityKeypad, Row, StepMark } from './RegistrationRowParts';
import { setupErrorText as errorText } from './setupError';
import { touchSetupPin } from './setupPinSession';
import { ToolValueBoard } from './ToolValueBoard';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

export { registrationChecklist } from './registrationDraft';
export type { Draft, RegistrationState } from './registrationDraft';

export function InventoryRegistrationTab({ accessPassword, registration, setRegistration }: {
  accessPassword: string;
  registration: RegistrationState;
  setRegistration: Dispatch<SetStateAction<RegistrationState>>;
}) {
  const importsQuery = useInventoryImports(accessPassword, true);
  const messagesQuery = useInventoryImportMessages(accessPassword, true);
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword, true);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [undoDismiss, setUndoDismiss] = useState<{ candidate: InventoryImport; draft: Draft } | null>(null);
  const registered = registration.completed ?? null;
  const [suggestion, setSuggestion] = useState<{ candidateId: string; photoId: string; result: InventoryToolFieldSuggestion } | null>(null);
  const [reading, setReading] = useState(false);
  const suggestionGenerationRef = useRef(0);
  const [working, setWorking] = useState(false);
  const [errorAt, setErrorAt] = useState('register');
  // Newest first, like the unregistered cards on the daily list.
  const candidates = useMemo(() => [...(importsQuery.data ?? [])].filter((entry) => !hiddenIds.includes(entry.id) && entry.status !== 'DISMISSED' && entry.status !== 'REGISTERED').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [importsQuery.data, hiddenIds]);
  const { selectedId } = registration;
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const completedIdRef = useRef<string | null>(null);
  const setSelectedId = (id: string | null) => setRegistration({ selectedId: id, draft: null });
  const candidate = selectedId ? candidates.find((entry) => entry.id === selectedId) ?? null : candidates.find((entry) => entry.id !== completedIdRef.current) ?? null;
  const draft = registration.draft ?? emptyDraft(candidate);
  const setDraft = useCallback((update: SetStateAction<Draft>) => {
    setUndoDismiss(null);
    setRegistration((current) => ({
      selectedId: current.selectedId ?? candidate?.id ?? null,
      draft: typeof update === 'function' ? update(current.draft ?? emptyDraft(candidate)) : update,
    }));
  }, [candidate, setRegistration]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<string | null>(null);
  const [readPhotoId, setReadPhotoId] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [photoPage, setPhotoPage] = useState(0);
  const lastPhotoPage = Math.max(0, Math.ceil((candidate?.photos.length ?? 0) / 2) - 1);
  const currentPhotoPage = Math.min(photoPage, lastPhotoPage);
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const candidatesRef = useRef<HTMLDivElement>(null);
  const candidatesButtonRef = useRef<HTMLButtonElement>(null);
  useDismissOnOutside(candidatesRef, candidatesOpen, () => setCandidatesOpen(false));
  const candidateIndex = candidates.findIndex((entry) => entry.id === candidate?.id);
  const chooseCandidate = (id: string) => { setSelectedId(id); setDone(null); setCandidatesOpen(false); };
  useEffect(() => { setPhotoPage((page) => Math.min(page, lastPhotoPage)); }, [lastPhotoPage]);
  const itemsQuery = useInventoryItems(draft.mode !== null);
  const selectedItem = itemsQuery.data?.find((item) => item.id === draft.itemId);
  const waitingForTag = draft.mode === 'NEW_ITEM' && Boolean(draft.drawerId) && !draft.itemTagUid;
  const read = useArmedNfcRead(waitingForTag);
  const handledRef = useRef<NfcEvent | null>(null);
  const failedMessages = (messagesQuery.data ?? []).filter((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING');
  const photoPending = mutations.deleteImportPhoto.isPending || mutations.rotateImportPhoto.isPending || mutations.reorderImportPhotos.isPending;

  // A different candidate starts over.
  const candidateId = candidate?.id ?? null;
  useEffect(() => {
    if (!registered && candidate && !registration.draft) setRegistration({ selectedId: candidate.id, draft: emptyDraft(candidate) });
  }, [candidate, registration.draft, setRegistration, registered]);

  // The chosen candidate is gone (registered on another terminal): fall back to the newest one.
  const selectedGone = Boolean(selectedId) && !candidate && importsQuery.data !== undefined && !importsQuery.isFetching;
  useEffect(() => {
    if (selectedGone && !registered) setRegistration({ selectedId: null, draft: null });
  }, [selectedGone, setRegistration, registered]);

  useEffect(() => {
    setError(null);
    setConfirmDeletePhotoId(null);
    setManualOpen(false);
    setSuggestion(null);
    setReadPhotoId(null);
    setPhotoPage(0);
    setCandidatesOpen(false);
    setSelectedPhoto(null);
    suggestionGenerationRef.current += 1;
    setReading(false);
    // Only the candidate identity matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  useEffect(() => {
    if (!read || handledRef.current === read) return;
    handledRef.current = read;
    touchSetupPin();
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
      setDraft((current) => ({ ...current, drawerId: created.id, drawerLabel: `${parent.area}・棚${parent.shelfNumber}・引き出し${created.drawerNumber}`, itemTagUid: '' }));
    }
    setAutoSelect(null);
  }, [areaShelves, autoSelect, setDraft]);
  const createShelf = async () => {
    if (!candidate) return;
    setError(null);
    setErrorAt('place');
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
    setErrorAt('place');
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
    setErrorAt('photos');
    void mutations.reorderImportPhotos.mutateAsync({ payloadId: candidate.id, photoIds: ids }).catch((caught) => setError(errorText(caught)));
  };
  const rotatePhoto = (photoId: string) => {
    if (!candidate) return;
    setError(null);
    setErrorAt('photos');
    void mutations.rotateImportPhoto.mutateAsync({ payloadId: candidate.id, photoId }).catch((caught) => setError(errorText(caught)));
  };
  const deletePhoto = (photoId: string) => {
    if (!candidate) return;
    setConfirmDeletePhotoId(null);
    setError(null);
    setErrorAt('photos');
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
    if (!candidate || !draft.mode || remaining > 0 || working) return;
    setUndoDismiss(null);
    setErrorAt('register');
    setError(null);
    setWorking(true);
    const isNew = draft.mode === 'NEW_ITEM';
    try {
      const result = await mutations.registerImport.mutateAsync({
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
      setHiddenIds((ids) => [...ids, candidate.id]);
      completedIdRef.current = candidate.id;
      setRegistration({ selectedId: candidate.id, draft, completed: { candidateId: candidate.id, labelNumber: result.compartment?.labelNumber, name: result.item.name, location: isNew ? draft.drawerLabel : '写真を追加しました' } });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setWorking(false);
    }
  };

  const dismiss = async () => {
    if (!candidate || working) return;
    setWorking(true);
    setUndoDismiss(null);
    setErrorAt('register');
    setError(null);
    try {
      await mutations.dismissImport.mutateAsync(candidate.id);
      if (registrationRef.current.selectedId === candidate.id) setUndoDismiss({ candidate, draft });
      setHiddenIds((ids) => [...ids, candidate.id]);
      setDone(`候補 #${candidate.sourceItemId} は登録しません`);
      setRegistration((current) => current.selectedId === candidate.id ? {
        selectedId: candidates.find((entry) => entry.id !== candidate.id)?.id ?? null, draft: null,
      } : current);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setWorking(false);
    }
  };
  const restore = async () => {
    if (!undoDismiss || working) return;
    setWorking(true);
    const beforeRestore = registrationRef.current;
    setErrorAt('undo');
    setError(null);
    try {
      await mutations.restoreImport.mutateAsync(undoDismiss.candidate.id);
      setHiddenIds((ids) => ids.filter((id) => id !== undoDismiss.candidate.id));
      setRegistration((current) => current === beforeRestore ? { selectedId: undoDismiss.candidate.id, draft: undoDismiss.draft } : current);
      setUndoDismiss(null);
      setDone('候補を戻しました');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setWorking(false);
    }
  };
  const readPhoto = async () => {
    const photo = candidate?.photos.find((entry) => entry.id === readPhotoId) ?? candidate?.photos[0];
    if (!candidate || !photo || reading) return;
    const generation = ++suggestionGenerationRef.current;
    setReading(true);
    setSuggestion(null);
    const unavailable: InventoryToolFieldSuggestion = { model: [], maker: [], status: 'unavailable' };
    try {
      const result = await mutations.suggestToolFields.mutateAsync({ source: 'import', payloadId: candidate.id, photoId: photo.id });
      if (generation === suggestionGenerationRef.current) setSuggestion({ candidateId: candidate.id, photoId: photo.id, result });
    } catch {
      if (generation === suggestionGenerationRef.current) setSuggestion({ candidateId: candidate.id, photoId: photo.id, result: unavailable });
    } finally { if (generation === suggestionGenerationRef.current) setReading(false); }
  };
  const visibleSuggestion = suggestion?.candidateId === candidateId ? suggestion.result : null;
  const suggestionFailed = visibleSuggestion && (visibleSuggestion.status === 'unavailable' || !visibleSuggestion.model.length && !visibleSuggestion.maker.length);
  const localError = (target: string) => <div className="h-8 shrink-0 overflow-hidden text-sm leading-4">{error && errorAt === target ? <p className="line-clamp-2 text-[#ffd0d0]" role="alert">{error}</p> : null}</div>;

  const retryPanel = failedMessages.length > 0 ? (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-inv-amber/40 bg-inv-amber/[0.12] px-3 py-2 text-sm text-[#ffe8bf]" aria-label="取込エラー">
      <span className="font-bold">写真メールの取込に失敗:</span>
      {failedMessages.map((entry) => (
        <span key={entry.id} className="flex flex-col gap-1">
          {entry.errorMessage ?? '再試行できるエラー'}
          <button type="button" className={invButtonSm} disabled={mutations.retryImport.isPending} onClick={() => { setErrorAt(entry.id); setError(null); void mutations.retryImport.mutateAsync(entry.id).catch((caught) => setError(errorText(caught))); }}>もう一度取り込む</button>
          {localError(entry.id)}
        </span>
      ))}
    </section>
  ) : null;
  const doneBanner = <div className="flex h-12 shrink-0 items-center gap-3 overflow-hidden">
    {done ? <p className="min-w-0 truncate text-base font-bold text-[#d7fbe9]" role="status">{done}</p> : null}
    {undoDismiss ? <button type="button" className={invButtonSmGhost} disabled={working} onClick={() => void restore()}>元に戻す</button> : null}
    {errorAt === 'undo' ? localError('undo') : null}
  </div>;

  if (registered) {
    return <div className={`${invSetupTargets} flex min-h-0 flex-1 flex-col gap-3 pt-4`}>
      {doneBanner}
      <section className={`${invPanel} flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center`} aria-label="登録完了">
        <h2 className="text-xl font-black">{registered.labelNumber !== undefined ? '登録しました　タグと引き出しに書く番号' : '写真を追加しました'}</h2>
        {registered.labelNumber !== undefined ? <span className={`${invLabelNumber} border-[3px] px-7 py-2 text-[88px] leading-[1.1]`}>{formatInventoryLabelNumber(registered.labelNumber)}</span> : null}
        <p className="max-w-full truncate text-inv-muted">{registered.name} ／ {registered.location}</p>
        <button type="button" className={invButtonGo} onClick={() => { setRegistration({ selectedId: candidates.find((entry) => entry.id !== registered.candidateId)?.id ?? null, draft: null }); }}>次へ</button>
      </section>
    </div>;
  }

  if (!candidate) {
    return (
      <div className={`${invSetupTargets} flex flex-col gap-3`}>
        {doneBanner}
        {retryPanel}
        <p className={`${invPanel} p-6 text-center text-base text-inv-muted`}>{importsQuery.isLoading ? '読み込み中…' : '登録待ちの候補はありません'}</p>
      </div>
    );
  }

  let stepNumber = 0;
  const next = () => { stepNumber += 1; return stepNumber; };

  return (
    <div className={`${invSetupTargets} flex min-h-0 flex-1 flex-col gap-3 pt-4`}>
      {done || undoDismiss || errorAt === 'undo' && error ? doneBanner : null}
      {retryPanel}
      <div className="relative grid min-h-0 flex-1 grid-cols-[420px_minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <RegistrationPhotos
          candidate={candidate} optionsOpen={optionsOpen}
          currentPhotoPage={currentPhotoPage} lastPhotoPage={lastPhotoPage}
          confirmDeletePhotoId={confirmDeletePhotoId} photoPending={photoPending}
          setReadPhotoId={setReadPhotoId} setSelectedPhoto={setSelectedPhoto}
          setConfirmDeletePhotoId={setConfirmDeletePhotoId} setPhotoPage={setPhotoPage}
          deletePhoto={deletePhoto} movePhoto={movePhoto} rotatePhoto={rotatePhoto}
          localError={localError}
        />

        <RegistrationDetails
          accessPassword={accessPassword} candidate={candidate} draft={draft} selectedItem={selectedItem}
          modeNumber={next()} namesNumber={next()} unitNumber={next()}
          isDone={isDone} currentId={currentId} chooseNew={chooseNew} update={update}
          reading={reading} readPhoto={readPhoto} optionsOpen={optionsOpen} setOptionsOpen={setOptionsOpen}
          visibleSuggestion={visibleSuggestion} suggestionFailed={suggestionFailed}
        />
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
          {draft.mode === 'EXISTING_ITEM' ? (
            <InventoryExistingItemPicker
              key={candidate.id}
              items={itemsQuery.data ?? []}
              isLoading={itemsQuery.isLoading}
              machine={splitArea(candidate.area).machine}
              selectedItem={selectedItem}
              stepMark={<StepMark number={next()} done={Boolean(draft.itemId)} current={!draft.itemId} />}
              onChoose={chooseExisting}
              onClear={() => update({ itemId: '', itemName: '' })}
            />
          ) : (
            <>
              <Row id="place" number={next()} title="置き場所" done={isDone('place')} current={currentId === 'place'} bounded>
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <p aria-label="選んだ置き場所" className="shrink-0 truncate rounded-xl border border-inv-line2 bg-inv-bg px-3 py-2 text-lg font-black">{draft.area || 'エリア'}・{shelf ? `棚${shelf.shelfNumber}` : '棚'}・{draft.drawerId ? `引き出し${shelf?.drawers.find((drawer) => drawer.id === draft.drawerId)?.drawerNumber ?? '—'}` : '引き出し'}</p>
                  <div className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-1.5 overflow-y-auto [&>button]:shrink-0" role="group" aria-label="加工機と向き">
                    <span className={`${invLabel} w-[52px]`}>エリア</span>
                    {AREA_DIRECTIONS.map((direction) => (
                      <button key={direction} type="button" aria-label={`${machine} ${direction}`} aria-pressed={composeArea(machine, direction) === draft.area} className={invSeg(composeArea(machine, direction) === draft.area)} onClick={() => chooseArea(composeArea(machine, direction))}>{composeArea(machine, direction)}</button>
                    ))}
                    {previousArea && draft.area === previousArea ? <span className="ml-2 text-xs text-inv-faint">前回と同じ</span> : null}
                  </div>
                  {otherAreas.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-1.5 overflow-y-auto [&>button]:shrink-0" role="group" aria-label="ほかの加工機の棚">
                      <span className={`${invLabel} w-[52px]`}>ほか</span>
                      {otherAreas.map((area) => (
                        <button key={area} type="button" aria-pressed={area === draft.area} className={`${invSeg(area === draft.area)} h-11 text-sm`} onClick={() => chooseArea(area)}>{area}</button>
                      ))}
                    </div>
                  ) : null}
                  {draft.area && areaShelves.length === 0 ? <p className="shrink-0 text-xs text-inv-amber">{draft.area} の棚はまだありません</p> : null}
                  <div className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-1.5 overflow-y-auto [&>button]:shrink-0" role="group" aria-label="棚">
                    <span className={`${invLabel} w-[52px]`}>棚</span>
                    {areaShelves.map((entry) => (
                      <button key={entry.id} type="button" aria-label={`棚${entry.shelfNumber}`} aria-pressed={entry.id === draft.shelfId} className={invSeg(entry.id === draft.shelfId)} onClick={() => update({ shelfId: entry.id, drawerId: '', drawerLabel: '', itemTagUid: '' })}>{entry.shelfNumber}</button>
                    ))}
                    <button type="button" className={invSegAdd} aria-label={`棚${nextShelfNumber}を作る`} disabled={creating || !draft.area} onClick={() => void createShelf()}><PlusIcon />棚{nextShelfNumber}</button>
                  </div>
                  {shelf ? (
                    <div className="flex min-h-0 flex-1 flex-wrap content-start items-center gap-1.5 overflow-y-auto [&>button]:shrink-0" role="group" aria-label="引き出し">
                      <span className={`${invLabel} w-[52px]`}>引き出し</span>
                      {shelf.drawers.map((drawer) => (
                        <button key={drawer.id} type="button" aria-label={`引き出し${drawer.drawerNumber}`} aria-pressed={drawer.id === draft.drawerId} className={invSeg(drawer.id === draft.drawerId)} onClick={() => update({ drawerId: drawer.id, drawerLabel: `${shelf.area}・棚${shelf.shelfNumber}・引き出し${drawer.drawerNumber}`, itemTagUid: '' })}>
                          {drawer.drawerNumber}
                        </button>
                      ))}
                      <button type="button" className={invSegAdd} aria-label={`引き出し${nextDrawerNumber}を作る`} disabled={creating} onClick={() => void createDrawer()}><PlusIcon /></button>
                    </div>
                  ) : null}
                </div>
                {localError('place')}
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
                      <button type="button" className="inline-flex min-h-11 min-w-11 items-center text-[13px] text-inv-cyan underline underline-offset-2" onClick={() => setManualOpen(true)}>IDを手で入れる</button>
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

              <Row id="quantity" number={next()} title="最初の数" done={isDone('quantity')} current={currentId === 'quantity'}>
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-1.5">
                    <output aria-label="最初の数" className={`${invField} flex w-28 items-center justify-end text-xl font-black tabular-nums`}>{draft.quantity === '' ? '—' : draft.quantity}</output>
                    <span className="text-inv-muted">{draft.unit || '個'}</span>
                  </div>
                  <QuantityKeypad value={draft.quantity} onChange={(value) => update({ quantity: value })} />
                </div>
              </Row>
            </>
          )}
        </div>

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
              className="absolute inset-y-0 left-[436px] right-0 z-50 shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(57,208,240,0.25)]"
            />
          </>
        ) : null}
      </div>
      <section aria-label="メールで届いた候補" className={`${invPanel} relative flex shrink-0 items-center gap-3 p-2.5`}>
        <div ref={candidatesRef}>
          <button ref={candidatesButtonRef} type="button" className={invButtonSm} aria-expanded={candidatesOpen} onClick={() => setCandidatesOpen((open) => !open)}>登録待ち {candidates.length}</button>
          {candidatesOpen ? <div role="region" aria-label="登録待ちの一覧" className={`${invPanel} absolute inset-x-0 bottom-full z-50 mb-2 grid max-h-[60dvh] grid-cols-8 gap-2 overflow-y-auto p-3 shadow-xl`}>
            {candidates.map((entry) => {
              const selected = entry.id === candidate.id;
              const photo = entry.photos[0];
              return <button key={entry.id} type="button" aria-pressed={selected} aria-label={`候補 #${entry.sourceItemId}`} disabled={mutations.registerImport.isPending} className={`flex min-w-0 flex-col gap-2 rounded-xl border p-2 text-left ${selected ? 'border-2 border-inv-cyan bg-inv-cyan/[0.1]' : 'border-inv-line bg-inv-s2 hover:bg-inv-s3'}`} onClick={() => { chooseCandidate(entry.id); candidatesButtonRef.current?.focus(); }}>
                <span className="block h-20 w-full overflow-hidden rounded-lg bg-inv-s3">
                  {photo ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
                </span>
                <b className="max-w-full truncate text-sm">候補 #{entry.sourceItemId}</b>
                <span className="line-clamp-2 break-all text-xs text-inv-muted">{entry.area}</span>
              </button>;
            })}
          </div> : null}
        </div>
        <p aria-label="選択中の候補" className="min-w-0 max-w-sm truncate text-sm font-bold">候補 #{candidate.sourceItemId}・{draft.mode === 'EXISTING_ITEM' ? draft.itemName || draft.name : draft.name}</p>
        <div className="flex shrink-0 gap-2" role="group" aria-label="候補の切り替え">
          <button type="button" className={iconSm} aria-label="前の候補" disabled={candidateIndex <= 0 || mutations.registerImport.isPending} onClick={() => chooseCandidate(candidates[candidateIndex - 1].id)}>＜</button>
          <button type="button" className={iconSm} aria-label="次の候補" disabled={candidateIndex >= candidates.length - 1 || mutations.registerImport.isPending} onClick={() => chooseCandidate(candidates[candidateIndex + 1].id)}>＞</button>
        </div>
        <span className="flex-1" />
        <div className="flex shrink-0 items-center gap-3" aria-label="登録操作">
          {error && errorAt === 'register' ? <p className={`max-w-60 text-sm ${invError}`} role="alert">{error}</p> : null}
          <button type="button" className={invButtonSmGhost} disabled={working} onClick={() => void dismiss()}>登録しない</button>
          <p className="whitespace-nowrap text-lg font-black tabular-nums" aria-live="polite">{remaining === 0 ? '登録できます' : `あと ${remaining} つ`}</p>
          <button type="button" className={`${invButtonGo} h-14 text-lg disabled:border-inv-line2 disabled:bg-inv-s2 disabled:text-inv-muted disabled:opacity-100`} disabled={remaining > 0 || working || mutations.registerImport.isPending} onClick={() => void register()}>{mutations.registerImport.isPending ? '登録中…' : '登録する'}</button>
        </div>
      </section>
      {selectedPhoto ? <InventoryPhotoReadDialog key={candidate.id} photos={candidate.photos.map(photo => ({ ...photo, alt: photo.filename }))} initialPhotoId={selectedPhoto} source={{ source: 'import', payloadId: candidate.id }} accessPassword={accessPassword} values={draft} onApply={(field, value) => update({ [field]: value })} onClose={() => setSelectedPhoto(null)} /> : null}
    </div>
  );
}
