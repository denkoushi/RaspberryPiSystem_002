import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
  shelfId: string;
  drawerId: string;
  drawerLabel: string;
  itemTagUid: string;
  quantity: string;
};

type CheckItem = { id: string; label: string; done: boolean; detail: string; optional?: boolean };

function emptyDraft(candidate: InventoryImport | null): Draft {
  return {
    photosChecked: false,
    mode: null,
    itemId: '',
    itemName: '',
    name: candidate ? `ItemlistRaspi ${candidate.sourceItemId}` : '',
    model: '',
    usage: '',
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
    { id: 'photos', label: '写真の確認', done: draft.photosChecked, detail: draft.photosChecked ? `${photoCount}枚 確認済み` : '写真を見て「確認した」を押す' },
    {
      id: 'mode',
      label: '新規か既存か',
      done: draft.mode === 'NEW_ITEM' || (draft.mode === 'EXISTING_ITEM' && Boolean(draft.itemId)),
      detail: draft.mode === 'NEW_ITEM' ? '新規登録' : draft.mode === 'EXISTING_ITEM' ? (draft.itemId ? `既存: ${draft.itemName}` : '追加先のアイテムを選ぶ') : 'どちらかを選ぶ',
    },
    { id: 'names', label: '名前など', done: true, optional: true, detail: draft.name || '（初期値のまま）' },
  ];
  if (draft.mode === 'EXISTING_ITEM') return items;
  return [
    ...items,
    { id: 'place', label: '置き場所', done: Boolean(draft.drawerId), detail: draft.drawerId ? draft.drawerLabel : '棚と引き出しを選ぶ' },
    { id: 'tag', label: 'アイテムタグ', done: Boolean(draft.itemTagUid), detail: draft.itemTagUid ? '読み取り済み' : draft.drawerId ? 'タグをかざす' : '置き場所のあとでかざす' },
    { id: 'quantity', label: '最初の数', done: draft.quantity !== '', detail: draft.quantity !== '' ? `${draft.quantity}個` : 'テンキーで入れる' },
  ];
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

function Section({ id, number, title, done, optional, children }: { id: string; number: number; title: string; done: boolean; optional?: boolean; children: ReactNode }) {
  return (
    <section id={`registration-${id}`} className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label={title}>
      <h3 className="flex items-center gap-3 text-xl font-bold text-white">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-base ${done ? 'bg-emerald-600' : 'bg-slate-700'}`}>{done ? '✓' : number}</span>
        {title}
        {optional ? <span className="text-sm font-normal text-white/50">省略できます</span> : null}
      </h3>
      {children}
    </section>
  );
}

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
  const itemsQuery = useInventoryItems(draft.mode === 'EXISTING_ITEM');
  const waitingForTag = draft.mode === 'NEW_ITEM' && Boolean(draft.drawerId) && !draft.itemTagUid;
  const read = useArmedNfcRead(waitingForTag);
  const handledRef = useRef<NfcEvent | null>(null);
  const [manualUid, setManualUid] = useState('');
  const failedMessages = (messagesQuery.data ?? []).filter((entry) => entry.outcome === 'RETRYABLE' || entry.outcome === 'PROCESSING');
  const photoPending = mutations.deleteImportPhoto.isPending || mutations.reorderImportPhotos.isPending;

  // A different candidate starts over.
  const candidateId = candidate?.id ?? null;
  useEffect(() => {
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
  }, [read]);

  const areaShelves = useMemo(
    () => (locationsQuery.data ?? []).filter((shelf) => shelf.area === candidate?.area).sort((a, b) => a.shelfNumber - b.shelfNumber),
    [candidate?.area, locationsQuery.data],
  );
  const shelf = areaShelves.find((entry) => entry.id === draft.shelfId) ?? null;
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const checklist = registrationChecklist(draft, candidate?.photos.length ?? 0);
  const remaining = checklist.filter((entry) => !entry.done).length;

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
    update({ itemId: item.id, itemName: item.name, name: item.name, model: item.model ?? '', usage: item.usage ?? '' });
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
  const doneBanner = done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null;

  if (!candidate) {
    return (
      <div className="flex flex-col gap-4">
        {doneBanner}
        {retryPanel}
        <p className={`${kioskPanelClassName} p-8 text-center text-lg text-white/70`}>{importsQuery.isLoading ? '読み込み中…' : '登録待ちの候補はありません'}</p>
      </div>
    );
  }

  let sectionNumber = 0;
  const nextNumber = () => { sectionNumber += 1; return sectionNumber; };
  const checkDone = (id: string) => checklist.find((entry) => entry.id === id)?.done ?? false;

  return (
    <div className="flex flex-col gap-4">
      {doneBanner}
      {retryPanel}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="メールで届いた候補">
        <span className="text-sm text-white/60">候補</span>
        {candidates.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={entry.id === candidate.id} className={`min-h-12 rounded-lg border px-4 text-left text-white ${entry.id === candidate.id ? 'border-sky-400 bg-sky-950/60' : 'border-white/15 bg-slate-900/60'}`} onClick={() => { setSelectedId(entry.id); setDone(null); }}>
            <span className="font-bold">#{entry.sourceItemId}</span>
            <span className="ml-2 text-sm text-white/60">{entry.category ?? '分類なし'} ・ 写真{entry.photos.length}枚</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section id="photos" number={nextNumber()} title="写真の確認" done={checkDone('photos')}>
            <p className="text-white/70">エリア {candidate.area} ・ 分類 {candidate.category ?? '-'} ・ メモ {candidate.note ?? '-'}</p>
            {candidate.photos.length === 0 ? <p className="text-white/60">写真はありません</p> : null}
            <div className="flex flex-wrap gap-3">
              {candidate.photos.map((photo, index) => (
                <figure key={photo.id} className="w-80 rounded-lg border border-white/15 bg-slate-950/40 p-2">
                  <button type="button" className="block w-full" aria-label={`写真${index + 1}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.filename })}>
                    <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.filename} className="h-64 w-full rounded object-cover" />
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
            <button type="button" aria-pressed={draft.photosChecked} className={draft.photosChecked ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ photosChecked: !draft.photosChecked })}>{draft.photosChecked ? '✓ 写真を確認した' : '写真を確認した'}</button>
          </Section>

          <Section id="mode" number={nextNumber()} title="新規か既存か" done={checkDone('mode')}>
            <div className="flex flex-wrap gap-3">
              <button type="button" aria-pressed={draft.mode === 'NEW_ITEM'} className={draft.mode === 'NEW_ITEM' ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ mode: 'NEW_ITEM', itemId: '', itemName: '', name: `ItemlistRaspi ${candidate.sourceItemId}`, model: '', usage: '' })}>新規登録</button>
              <button type="button" aria-pressed={draft.mode === 'EXISTING_ITEM'} className={draft.mode === 'EXISTING_ITEM' ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ mode: 'EXISTING_ITEM', shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '', quantity: '' })}>既存のアイテムに写真を追加</button>
            </div>
            {draft.mode === 'EXISTING_ITEM' ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="追加先のアイテム">
                {itemsQuery.isLoading ? <p className="text-white/60">読み込み中…</p> : null}
                {(itemsQuery.data ?? []).map((item) => (
                  <button key={item.id} type="button" aria-pressed={item.id === draft.itemId} className={`flex items-center gap-3 rounded-lg border p-3 text-left text-white hover:bg-slate-800 ${item.id === draft.itemId ? 'border-sky-400 bg-sky-950/60' : 'border-white/15 bg-slate-950/40'}`} onClick={() => chooseExisting(item)}>
                    {item.photos[0] ? <img src={inventoryThumbnailUrl(item.photos[0].photoUrl)} alt="" className="h-16 w-16 rounded object-cover" /> : <span className="h-16 w-16 rounded bg-slate-800" aria-hidden="true" />}
                    <span className="min-w-0"><span className="block truncate text-lg font-bold">{item.name}</span><span className="text-sm text-white/60">{item.itemCode}</span></span>
                  </button>
                ))}
              </div>
            ) : null}
          </Section>

          <Section id="names" number={nextNumber()} title="名前など" done={checkDone('names')} optional>
            <p className="text-white/70">日本語の名前は、あとで管理画面（PC）から直せます。</p>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-white">アイテム名<input className={kioskInputClassName} value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
              <label className="flex flex-col gap-1 text-white">型式<input className={kioskInputClassName} value={draft.model} onChange={(event) => update({ model: event.target.value })} /></label>
              <label className="flex flex-col gap-1 text-white">用途<input className={kioskInputClassName} value={draft.usage} onChange={(event) => update({ usage: event.target.value })} /></label>
            </div>
          </Section>

          {draft.mode !== 'EXISTING_ITEM' ? (
            <>
              <Section id="place" number={nextNumber()} title="置き場所" done={checkDone('place')}>
                <p className="text-white/70">エリア {candidate.area} の棚から選びます</p>
                {areaShelves.length === 0 ? <p className="rounded border border-amber-400/50 bg-amber-950/40 p-3 text-amber-100">このエリアの棚がまだありません。「棚・引き出し」タブで追加してください。</p> : null}
                <div className="flex flex-wrap gap-2" role="group" aria-label="棚">
                  {areaShelves.map((entry) => (
                    <button key={entry.id} type="button" aria-pressed={entry.id === draft.shelfId} className={entry.id === draft.shelfId ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ shelfId: entry.id, drawerId: '', drawerLabel: '', itemTagUid: '' })}>棚{entry.shelfNumber}</button>
                  ))}
                </div>
                {shelf ? (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="引き出し">
                    {shelf.drawers.map((drawer) => {
                      const used = drawer.compartments.length > 0;
                      return (
                        <button key={drawer.id} type="button" disabled={used} aria-pressed={drawer.id === draft.drawerId} className={drawer.id === draft.drawerId ? selectedChoiceClassName : idleChoiceClassName} onClick={() => update({ drawerId: drawer.id, drawerLabel: `棚${shelf.shelfNumber} ・ 引出し${drawer.drawerNumber}`, itemTagUid: '' })}>
                          引出し{drawer.drawerNumber}{used ? ' 使用中' : ''}
                        </button>
                      );
                    })}
                    {shelf.drawers.length === 0 ? <p className="text-white/60">この棚には引き出しがありません。「棚・引き出し」タブで追加してください。</p> : null}
                  </div>
                ) : null}
              </Section>

              <Section id="tag" number={nextNumber()} title="アイテムタグ" done={checkDone('tag')}>
                {!draft.drawerId ? <p className="text-white/60">置き場所を選ぶと、タグの読み取りを始めます。</p> : null}
                {waitingForTag ? (
                  <div className="flex flex-col gap-2 rounded-lg border-2 border-amber-400 bg-amber-950/40 p-4">
                    <p className="text-2xl font-bold text-white">この引き出しに付けるタグをかざしてください</p>
                    <details className="text-sm text-white/70">
                      <summary className="flex min-h-11 cursor-pointer items-center">読めないときはIDを手で入れる</summary>
                      <div className="mt-2 flex gap-2">
                        <input className={`${kioskInputClassName} min-w-0 flex-1`} aria-label="タグのID" placeholder="タグのID" value={manualUid} onChange={(event) => setManualUid(event.target.value)} />
                        <button type="button" className={kioskButtonSecondaryClassName} disabled={!manualUid.trim()} onClick={() => { update({ itemTagUid: manualUid.trim() }); setManualUid(''); }}>使う</button>
                      </div>
                    </details>
                  </div>
                ) : null}
                {draft.itemTagUid ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-lg text-white">タグ {draft.itemTagUid} を読み取りました</p>
                    <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={() => update({ itemTagUid: '' })}>読み直す</button>
                  </div>
                ) : null}
              </Section>

              <Section id="quantity" number={nextNumber()} title="最初の数（いま引き出しに入っている数）" done={checkDone('quantity')}>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
                  <output className="self-start rounded bg-slate-950 px-4 py-3 text-right text-5xl font-bold text-white" aria-label="最初の数">{draft.quantity === '' ? '—' : draft.quantity}</output>
                  <KioskDigitTenkey value={draft.quantity} onChange={(next) => update({ quantity: next.replace(/^0+(?=\d)/, '') })} maxLength={6} ariaLabel="最初の数のテンキー" className="grid grid-cols-3 gap-2" keyClassName={keyClassName} />
                </div>
              </Section>
            </>
          ) : null}
        </div>

        <aside className={`${kioskPanelClassName} sticky top-0 flex flex-col gap-3 p-4`} aria-label="登録の進み具合">
          <h3 className="text-xl font-bold text-white">候補 #{candidate.sourceItemId} の登録</h3>
          <ul className="flex flex-col gap-2">
            {checklist.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 rounded-lg bg-slate-950/40 p-3 text-left hover:bg-slate-800"
                  onClick={() => document.getElementById(`registration-${entry.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold ${entry.done ? 'bg-emerald-600 text-white' : 'border-2 border-white/40 text-white/40'}`} aria-hidden="true">{entry.done ? '✓' : ''}</span>
                  <span className="min-w-0">
                    <span className="block text-lg font-bold text-white">{entry.label}{entry.done ? '' : '（まだ）'}</span>
                    <span className="block truncate text-sm text-white/60">{entry.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{error}</p> : null}
          <p className="text-center text-lg font-semibold text-white" aria-live="polite">{remaining === 0 ? '登録できます' : `あと ${remaining} つ`}</p>
          <button type="button" className={`${kioskButtonPrimaryClassName} min-h-16 text-xl`} disabled={remaining > 0 || mutations.registerImport.isPending} onClick={() => void register()}>
            {mutations.registerImport.isPending ? '登録中…' : '登録する'}
          </button>
        </aside>
      </div>
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
    </div>
  );
}
