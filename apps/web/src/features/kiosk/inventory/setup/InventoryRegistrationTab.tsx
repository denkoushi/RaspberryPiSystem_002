import { useEffect, useMemo, useRef, useState } from 'react';

import { inventoryThumbnailUrl, type InventoryImport, type InventoryItem } from '../../../../api/client';
import {
  useInventoryImportMessages,
  useInventoryImports,
  useInventoryItems,
  useInventoryLocations,
  useInventoryMutations,
} from '../../../../api/hooks';
import { InventoryPhotoDialog } from '../../../../components/kiosk/InventoryPhotoDialog';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import {
  kioskButtonDangerClassName,
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName,
  kioskInputClassName,
  kioskPanelClassName,
} from '../../kioskTheme';

import { NfcScanPanel } from './NfcScanPanel';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

type Step = 'photos' | 'mode' | 'names' | 'place' | 'tag' | 'quantity';

type Draft = {
  mode: 'NEW_ITEM' | 'EXISTING_ITEM' | null;
  itemId: string;
  name: string;
  model: string;
  usage: string;
  shelfId: string;
  drawerId: string;
  itemTagUid: string;
  quantity: string;
};

const NEW_STEPS: Array<{ id: Step; label: string }> = [
  { id: 'photos', label: '写真の確認' },
  { id: 'mode', label: '新規か既存か' },
  { id: 'names', label: '名前など' },
  { id: 'place', label: '置き場所' },
  { id: 'tag', label: 'タグをかざす' },
  { id: 'quantity', label: '最初の数' },
];
const EXISTING_STEPS = NEW_STEPS.slice(0, 3);

function emptyDraft(candidate: InventoryImport | null): Draft {
  return {
    mode: null,
    itemId: '',
    name: candidate ? `ItemlistRaspi ${candidate.sourceItemId}` : '',
    model: '',
    usage: '',
    shelfId: '',
    drawerId: '',
    itemTagUid: '',
    quantity: '',
  };
}

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '処理に失敗しました';
}

const choiceClassName = 'min-h-16 min-w-28 rounded-lg border px-5 text-xl font-bold';
const selectedChoiceClassName = `${choiceClassName} border-sky-400 bg-sky-950/60 text-white`;
const idleChoiceClassName = `${choiceClassName} border-white/20 bg-slate-900/60 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40`;
const keyClassName =
  'inline-flex h-14 items-center justify-center rounded-lg border border-white/15 bg-slate-950 text-2xl font-bold text-white hover:bg-slate-800 disabled:opacity-40';

export function InventoryRegistrationTab({ accessPassword }: { accessPassword: string }) {
  const importsQuery = useInventoryImports(accessPassword);
  const messagesQuery = useInventoryImportMessages(accessPassword);
  const locationsQuery = useInventoryLocations();
  const mutations = useInventoryMutations(accessPassword);
  const candidates = useMemo(() => importsQuery.data ?? [], [importsQuery.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const candidate = candidates.find((entry) => entry.id === selectedId) ?? candidates[0] ?? null;
  const [step, setStep] = useState<Step>('photos');
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(candidate));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; alt: string } | null>(null);
  const itemsQuery = useInventoryItems(step === 'mode' && draft.mode === 'EXISTING_ITEM');
  const read = useArmedNfcRead(step === 'tag');
  const handledRef = useRef<NfcEvent | null>(null);
  const failedMessages = (messagesQuery.data ?? []).filter((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING');
  const photoPending = mutations.deleteImportPhoto.isPending || mutations.reorderImportPhotos.isPending;

  // A different candidate starts the wizard over.
  const candidateId = candidate?.id ?? null;
  useEffect(() => {
    setStep('photos');
    setDraft(emptyDraft(candidate));
    setError(null);
    setConfirmDeletePhotoId(null);
    // Only the candidate identity matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  useEffect(() => {
    if (!read || handledRef.current === read) return;
    handledRef.current = read;
    setDraft((current) => ({ ...current, itemTagUid: read.uid }));
    setStep('quantity');
  }, [read]);

  const areaShelves = useMemo(
    () => (locationsQuery.data ?? []).filter((shelf) => shelf.area === candidate?.area).sort((a, b) => a.shelfNumber - b.shelfNumber),
    [candidate?.area, locationsQuery.data],
  );
  const shelf = areaShelves.find((entry) => entry.id === draft.shelfId) ?? null;
  const steps = draft.mode === 'EXISTING_ITEM' ? EXISTING_STEPS : NEW_STEPS;
  const stepIndex = steps.findIndex((entry) => entry.id === step);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const back = () => { setError(null); if (stepIndex > 0) setStep(steps[stepIndex - 1].id); };

  const savePhotoOrder = (photoIds: string[]) => {
    if (!candidate) return;
    setError(null);
    void mutations.reorderImportPhotos.mutateAsync({ payloadId: candidate.id, photoIds }).catch((caught) => setError(errorText(caught)));
  };
  const movePhoto = (index: number, offset: -1 | 1) => {
    if (!candidate) return;
    const ids = candidate.photos.map((photo) => photo.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    savePhotoOrder(ids);
  };
  const deletePhoto = (photoId: string) => {
    if (!candidate) return;
    setConfirmDeletePhotoId(null);
    setError(null);
    void mutations.deleteImportPhoto.mutateAsync({ payloadId: candidate.id, photoId }).catch((caught) => setError(errorText(caught)));
  };

  const chooseExisting = (item: InventoryItem) => {
    update({ itemId: item.id, name: item.name, model: item.model ?? '', usage: item.usage ?? '' });
    setStep('names');
  };

  const register = async () => {
    if (!candidate || !draft.mode) return;
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
        },
      });
      setDone(`候補 #${candidate.sourceItemId} を登録しました`);
      setSelectedId(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const retryPanel = failedMessages.length > 0 ? (
    <section className="rounded-lg border border-amber-400/40 bg-amber-950/40 p-4" aria-label="取込エラー">
      <h2 className="text-lg font-bold text-white">写真メールの取込に失敗したもの</h2>
      {failedMessages.map((entry) => (
        <div key={entry.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-white/85">
          <span>{entry.errorMessage ?? '再試行できるエラー'}</span>
          <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} disabled={mutations.retryImport.isPending} onClick={() => void mutations.retryImport.mutateAsync(entry.id).catch((caught) => setError(errorText(caught)))}>もう一度取り込む</button>
        </div>
      ))}
    </section>
  ) : null;

  if (!candidate) {
    return (
      <div className="flex flex-col gap-4">
        {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null}
        {retryPanel}
        <p className={`${kioskPanelClassName} p-8 text-center text-lg text-white/70`}>{importsQuery.isLoading ? '読み込み中…' : '登録待ちの候補はありません'}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-white/60">メールで届いた候補</p>
        {candidates.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={entry.id === candidate.id} className={`rounded-lg border p-3 text-left text-white ${entry.id === candidate.id ? 'border-sky-400 bg-sky-950/60' : 'border-white/15 bg-slate-900/60'}`} onClick={() => { setSelectedId(entry.id); setDone(null); }}>
            <span className="block text-lg font-bold">候補 #{entry.sourceItemId}</span>
            <span className="text-sm text-white/60">{entry.category ?? '分類なし'} ・ 写真{entry.photos.length}枚</span>
          </button>
        ))}
      </div>
      <section className={`${kioskPanelClassName} flex flex-col gap-4 p-5`} aria-label={`候補 #${candidate.sourceItemId} の登録`}>
        {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null}
        {retryPanel}
        <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="登録の手順">
          {steps.map((entry, index) => (
            <li key={entry.id} aria-current={entry.id === step ? 'step' : undefined} className={`rounded-lg px-3 py-2 text-sm font-bold ${index < stepIndex ? 'bg-emerald-900/60 text-emerald-100' : entry.id === step ? 'bg-sky-700 text-white' : 'bg-slate-800 text-white/50'}`}>
              {index + 1}. {entry.label}
            </li>
          ))}
        </ol>
        {error ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{error}</p> : null}

        {step === 'photos' ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold text-white">写真を確認してください</h2>
            <p className="text-white/70">エリア {candidate.area} ・ 分類 {candidate.category ?? '-'} ・ メモ {candidate.note ?? '-'}</p>
            {candidate.photos.length === 0 ? <p className="text-white/60">写真はありません</p> : null}
            <div className="flex flex-wrap gap-3">
              {candidate.photos.map((photo, index) => (
                <figure key={photo.id} className="w-40 rounded-lg border border-white/15 bg-slate-950/40 p-2">
                  <button type="button" className="block w-full" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.filename })}>
                    <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.filename} className="h-32 w-full rounded object-cover" />
                  </button>
                  {confirmDeletePhotoId === photo.id ? (
                    <div className="mt-2 flex flex-col gap-1">
                      <span className="text-sm text-red-100">この写真を消しますか？</span>
                      <div className="flex gap-1">
                        <button type="button" className={`${kioskButtonDangerClassName} flex-1`} disabled={photoPending} onClick={() => deletePhoto(photo.id)}>消す</button>
                        <button type="button" className={`${kioskButtonSecondaryClassName} flex-1`} onClick={() => setConfirmDeletePhotoId(null)}>やめる</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-1">
                      <button type="button" className={`${kioskButtonSecondaryClassName} flex-1 px-1`} aria-label={`写真${index + 1}を前へ`} disabled={index === 0 || photoPending} onClick={() => movePhoto(index, -1)}>←</button>
                      <button type="button" className={`${kioskButtonSecondaryClassName} flex-1 px-1`} aria-label={`写真${index + 1}を後ろへ`} disabled={index === candidate.photos.length - 1 || photoPending} onClick={() => movePhoto(index, 1)}>→</button>
                      <button type="button" className={`${kioskButtonDangerClassName} flex-1 px-1`} aria-label={`写真${index + 1}を削除`} disabled={photoPending} onClick={() => setConfirmDeletePhotoId(photo.id)}>削除</button>
                    </div>
                  )}
                </figure>
              ))}
            </div>
            <div className="flex justify-end"><button type="button" className={`${kioskButtonPrimaryClassName} min-h-14 px-8 text-lg`} onClick={() => setStep('mode')}>次へ</button></div>
          </div>
        ) : null}

        {step === 'mode' ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold text-white">新しいアイテムですか？</h2>
            <div className="flex flex-wrap gap-3">
              <button type="button" aria-pressed={draft.mode === 'NEW_ITEM'} className={draft.mode === 'NEW_ITEM' ? selectedChoiceClassName : idleChoiceClassName} onClick={() => { update({ mode: 'NEW_ITEM', itemId: '', name: `ItemlistRaspi ${candidate.sourceItemId}`, model: '', usage: '' }); setStep('names'); }}>新規登録</button>
              <button type="button" aria-pressed={draft.mode === 'EXISTING_ITEM'} className={draft.mode === 'EXISTING_ITEM' ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ mode: 'EXISTING_ITEM' })}>既存のアイテムに写真を追加</button>
            </div>
            {draft.mode === 'EXISTING_ITEM' ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="追加先のアイテム">
                {itemsQuery.isLoading ? <p className="text-white/60">読み込み中…</p> : null}
                {(itemsQuery.data ?? []).map((item) => (
                  <button key={item.id} type="button" className="flex items-center gap-3 rounded-lg border border-white/15 bg-slate-950/40 p-3 text-left text-white hover:bg-slate-800" onClick={() => chooseExisting(item)}>
                    {item.photos[0] ? <img src={inventoryThumbnailUrl(item.photos[0].photoUrl)} alt="" className="h-16 w-16 rounded object-cover" /> : <span className="h-16 w-16 rounded bg-slate-800" aria-hidden="true" />}
                    <span className="min-w-0"><span className="block truncate text-lg font-bold">{item.name}</span><span className="text-sm text-white/60">{item.itemCode}</span></span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex"><button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={back}>← 前へ</button></div>
          </div>
        ) : null}

        {step === 'names' ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold text-white">名前など（省略できます）</h2>
            <p className="text-white/70">そのまま「次へ」で進めます。日本語の名前は、あとで管理画面（PC）から直せます。</p>
            <label className="flex flex-col gap-1 text-white">アイテム名<input className={kioskInputClassName} value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
            <label className="flex flex-col gap-1 text-white">型式<input className={kioskInputClassName} value={draft.model} onChange={(event) => update({ model: event.target.value })} /></label>
            <label className="flex flex-col gap-1 text-white">用途<input className={kioskInputClassName} value={draft.usage} onChange={(event) => update({ usage: event.target.value })} /></label>
            <div className="flex justify-between gap-2">
              <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={back}>← 前へ</button>
              {draft.mode === 'EXISTING_ITEM'
                ? <button type="button" className={`${kioskButtonPrimaryClassName} min-h-14 px-8 text-lg`} disabled={mutations.registerImport.isPending} onClick={() => void register()}>{mutations.registerImport.isPending ? '登録中…' : '写真を追加して登録する'}</button>
                : <button type="button" className={`${kioskButtonPrimaryClassName} min-h-14 px-8 text-lg`} onClick={() => setStep('place')}>次へ：置き場所</button>}
            </div>
          </div>
        ) : null}

        {step === 'place' ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-2xl font-bold text-white">どこに置きますか？</h2>
            <p className="text-white/70">エリア {candidate.area} の棚から選びます</p>
            {areaShelves.length === 0 ? <p className="rounded border border-amber-400/50 bg-amber-950/40 p-3 text-amber-100">このエリアの棚がまだありません。「棚・引き出し」タブで追加してください。</p> : null}
            <div className="flex flex-wrap gap-2" role="group" aria-label="棚">
              {areaShelves.map((entry) => (
                <button key={entry.id} type="button" aria-pressed={entry.id === draft.shelfId} className={entry.id === draft.shelfId ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ shelfId: entry.id, drawerId: '' })}>棚{entry.shelfNumber}</button>
              ))}
            </div>
            {shelf ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="引き出し">
                {shelf.drawers.map((drawer) => {
                  const used = drawer.compartments.length > 0;
                  return (
                    <button key={drawer.id} type="button" disabled={used} aria-pressed={drawer.id === draft.drawerId} className={drawer.id === draft.drawerId ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ drawerId: drawer.id })}>
                      引出し{drawer.drawerNumber}{used ? ' 使用中' : ''}
                    </button>
                  );
                })}
                {shelf.drawers.length === 0 ? <p className="text-white/60">この棚には引き出しがありません。「棚・引き出し」タブで追加してください。</p> : null}
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={back}>← 前へ</button>
              <button type="button" className={`${kioskButtonPrimaryClassName} min-h-14 px-8 text-lg`} disabled={!draft.drawerId} onClick={() => setStep('tag')}>次へ：タグをかざす</button>
            </div>
          </div>
        ) : null}

        {step === 'tag' ? (
          <div className="flex flex-col gap-3">
            <NfcScanPanel
              title="この引き出しに付けるアイテムタグ"
              hint="読み取ると次に進みます"
              pending={false}
              error={null}
              onManualUid={(uid) => { update({ itemTagUid: uid }); setStep('quantity'); }}
              onCancel={back}
            />
          </div>
        ) : null}

        {step === 'quantity' ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-3">
              <h2 className="text-2xl font-bold text-white">いま引き出しに入っている数</h2>
              <p className="text-white/70">タグ {draft.itemTagUid} を読み取りました</p>
              <output className="rounded bg-slate-950 px-4 py-3 text-right text-5xl font-bold text-white" aria-label="最初の数">{draft.quantity || '0'}</output>
              <div className="mt-auto flex justify-between gap-2">
                <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={back}>← 前へ</button>
                <button type="button" className={`${kioskButtonPrimaryClassName} min-h-14 px-8 text-lg`} disabled={mutations.registerImport.isPending} onClick={() => void register()}>{mutations.registerImport.isPending ? '登録中…' : '登録する'}</button>
              </div>
            </div>
            <KioskDigitTenkey value={draft.quantity} onChange={(next) => update({ quantity: next.replace(/^0+(?=\d)/, '') })} maxLength={6} ariaLabel="最初の数のテンキー" className="grid grid-cols-3 gap-2" keyClassName={keyClassName} />
          </div>
        ) : null}
      </section>
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
}
