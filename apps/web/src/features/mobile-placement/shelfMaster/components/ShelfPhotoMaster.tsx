import { SHELF_DIRECTIONS, composeArea, type ShelfDirection } from '@raspi-system/shelf-layout-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { deleteMobilePlacementShelf, deleteMobilePlacementShelfLandmark, getMobilePlacementShelfMachines, postMobilePlacementShelfLandmark, patchMobilePlacementShelfMemo, postMobilePlacementShelfRegister, putMobilePlacementShelfPhoto } from '../../../../api/client';
import { Dialog } from '../../../../components/ui/Dialog';
import { HaizenHeader } from '../../haizen/HaizenHeader';
import { HaizenIcon } from '../../haizen/HaizenIcon';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';
import { resizeShelfPhoto } from '../../shelfPhoto/resizeShelfPhoto';
import { ShelfPhoto } from '../../shelfPhoto/ShelfPhoto';
import { ShelfPhotoCamera } from '../../shelfPhoto/ShelfPhotoCamera';
import { haizenPhoneStyle, hp } from '../../ui/haizenPhoneTokens';
import { useRegisteredShelves } from '../../useRegisteredShelves';
import { clearShelfPhotoDraft, readShelfPhotoDraft, saveShelfPhotoDraft } from '../shelfPhotoDraft';

import type { RegisteredShelfEntryDto } from '../../registeredShelves';

export function ShelfPhotoMaster({ onMessage }: { onMessage?: (message: string) => void }) {
  const query = useRegisteredShelves();
  const [editing, setEditing] = useState<RegisteredShelfEntryDto | 'new' | null>(() => readShelfPhotoDraft() ? 'new' : null);
  return <>
    {query.isLoading ? <p className={hp.empty}>読込中…</p> : query.isError ? <div role="alert" className={hp.empty}>棚を取得できませんでした <button className={hp.mini} onClick={() => void query.refetch()}>再試行</button></div>
      : <div className={hp.list}>
        {query.data?.shelves.map((shelf) => <button key={shelf.shelfCodeRaw} type="button" aria-label={`棚 ${shelf.shelfCodeRaw} を編集`} onClick={() => setEditing(shelf)}
          className="flex items-center gap-2.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] p-2 text-left">
          <ShelfPhoto shelf={shelf} className="h-[72px] w-24 shrink-0 rounded-[10px]" />
          <span className="min-w-0"><b className="block font-mono text-xl text-[var(--hp-shelf)]">{shelf.shelfCodeRaw}</b><span className={`block truncate text-[13px] ${hp.muted}`}>{shelf.displayLabel}</span></span>
        </button>)}
        {!query.data?.shelves.length && <p className={hp.empty}>棚がありません</p>}
      </div>}
    <footer className={hp.dock}><button type="button" disabled={query.isLoading || query.isError} className={`${hp.primary} bg-[var(--hp-shelf)]`} onClick={() => setEditing('new')}><span aria-hidden>＋</span>棚を追加</button></footer>
    {editing && <ShelfPhotoForm shelf={editing === 'new' ? null : editing} shelves={query.data?.shelves ?? []} onClose={() => { if (editing === 'new') clearShelfPhotoDraft(); setEditing(null); }} onMessage={onMessage} />}
  </>;
}

function ShelfPhotoForm({ shelf, shelves, onClose, onMessage }: { shelf: RegisteredShelfEntryDto | null; shelves: RegisteredShelfEntryDto[]; onClose: () => void; onMessage?: (message: string) => void }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [draft] = useState(() => shelf ? null : readShelfPhotoDraft());
  const [cameraOpen, setCameraOpen] = useState(false);
  const [machine, setMachine] = useState(draft?.machine ?? '');
  const [landmarkSheet, setLandmarkSheet] = useState(false);
  const [direction, setDirection] = useState<ShelfDirection | '' | null>(draft?.direction ?? null);
  const [memo, setMemo] = useState(shelf?.displayLabel ?? draft?.memo ?? '');
  const [savedMemo, setSavedMemo] = useState(shelf?.displayLabel?.trim() || null);
  const [photo, setPhoto] = useState<Awaited<ReturnType<typeof resizeShelfPhoto>> | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(shelf?.shelfCodeRaw ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (shelf) return;
    if (createdCode) clearShelfPhotoDraft();
    else saveShelfPhotoDraft({ machine, direction, memo });
  }, [shelf, createdCode, machine, direction, memo]);
  const machinesQuery = useQuery({
    queryKey: mobilePlacementQueryKeys.shelfMachines,
    queryFn: getMobilePlacementShelfMachines,
    enabled: !createdCode
  });
  const directions = ['北西', '北', '北東', '西', '', '東', '南西', '南', '南東'] as const;
  const registeredDirections = new Set(directions.filter((d) => shelves.some((s) => s.shelfCodeRaw === (d ? composeArea(machine, d) : machine))));
  const code = createdCode ?? (machine && direction !== null ? (direction ? composeArea(machine, direction) : machine) : '');
  const canSave = !busy && Boolean(code) && (Boolean(createdCode) ||
    (Boolean(photo) && direction !== null && !registeredDirections.has(direction) &&
      !machinesQuery.isError && Boolean(machinesQuery.data?.machines.includes(machine) || machinesQuery.data?.landmarks?.includes(machine))));
  const deleteShelf = async () => {
    if (!shelf || busy) return;
    setBusy(true); setError(null);
    try {
      await deleteMobilePlacementShelf(shelf.shelfCodeRaw);
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfLayout });
      onClose();
      onMessage?.(`${shelf.shelfCodeRaw} を消しました`);
    } catch (e) {
      setError(isAxiosError(e) && typeof e.response?.data?.message === 'string' ? e.response.data.message : e instanceof Error ? e.message : '削除できませんでした');
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!canSave) return;
    setBusy(true); setError(null);
    try {
      const savedCode = createdCode ?? code.trim();
      if (!createdCode) {
        await postMobilePlacementShelfRegister({ shelfCodeRaw: savedCode, displayLabel: memo.trim() || null });
        clearShelfPhotoDraft();
        setCreatedCode(savedCode);
        setSavedMemo(memo.trim() || null);
      } else if ((memo.trim() || null) !== savedMemo) {
        await patchMobilePlacementShelfMemo(savedCode, memo.trim() || null);
        setSavedMemo(memo.trim() || null);
      }
      if (photo) await putMobilePlacementShelfPhoto(savedCode, photo);
      onClose();
    } catch (e) {
      setError(isAxiosError(e) && typeof e.response?.data?.message === 'string' ? e.response.data.message : e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
      setBusy(false);
    }
  };
  return <div style={haizenPhoneStyle}><Dialog isOpen closeOnEsc={!landmarkSheet && !cameraOpen} trapFocus={!landmarkSheet && !cameraOpen} onClose={() => { if (!busy && !landmarkSheet && !cameraOpen) onClose(); }} ariaLabel={shelf ? '棚を直す' : '棚を追加'} overlayZIndex={60}
    className="!fixed !inset-0 !m-auto !flex !h-dvh !max-h-none !w-full !max-w-[480px] !flex-col !rounded-none !border-0 !bg-[#0d0f0e] !p-0 !text-[#f2f4f1]">
    <div style={haizenPhoneStyle} className="flex min-h-0 flex-1 flex-col">
      <HaizenHeader title={shelf ? '棚を直す' : '棚を追加'} onBack={() => { if (!busy) onClose(); }} />
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className={`flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-2 ${!createdCode ? '[@media(max-height:768px)]:gap-0 [@media(max-height:768px)]:pt-0 [@media(max-height:768px)]:[&>label]:gap-0' : ''}`}>
          <input ref={input} type="file" accept="image/*" capture="environment" aria-label="棚の写真" className="hidden" disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = '';
            if (!file) return;
            setBusy(true); setError(null);
            try { setPhoto(await resizeShelfPhoto(file)); } catch (err) { setError(err instanceof Error ? err.message : '写真を処理できませんでした'); }
            finally { setBusy(false); }
          }} />
          <button type="button" disabled={busy} className="relative grid aspect-[4/3] max-h-[27dvh] w-full max-w-[280px] shrink-0 place-items-center self-center overflow-hidden rounded-2xl border-2 border-dashed border-[var(--hp-line)] bg-[var(--hp-panel)] text-[17px] font-bold" onClick={() => setCameraOpen(true)}>
            {photo ? <img alt="登録する棚の写真" src={`data:${photo.contentType};base64,${photo.dataBase64}`} className="absolute inset-0 h-full w-full object-cover" />
              : shelf?.photoUpdatedAt ? <ShelfPhoto shelf={shelf} className="absolute inset-0 h-full w-full" /> : <span><HaizenIcon name="photo" className="mx-auto mb-1.5 h-10 w-10" />棚の写真を撮る</span>}
            {(photo || shelf?.photoUpdatedAt) && <span className="absolute bottom-2 right-2 rounded-[10px] bg-[var(--hp-bg)] px-3 py-2.5 text-sm">撮り直す</span>}
          </button>
          {!createdCode && <>
            <button type="button" aria-label="目安" disabled={busy || machinesQuery.isLoading || machinesQuery.isError}
              className={`${hp.input} flex shrink-0 items-center justify-between text-left !font-sans ${machine ? '' : '!text-[var(--hp-ink2)]'}`}
              onClick={() => setLandmarkSheet(true)}>{machine || '目安を選ぶ'}<span aria-hidden className={hp.muted}>▾</span></button>
            {machinesQuery.isError && <p role="alert" className="text-sm text-[var(--hp-ng)]">目安を取得できませんでした <button type="button" className={hp.mini} onClick={() => void machinesQuery.refetch()}>再試行</button></p>}
            <div role="group" aria-label="方角" className="grid shrink-0 grid-cols-3 gap-1.5">
              {directions.map((d) => <button key={d} type="button" disabled={busy || !machine || registeredDirections.has(d)}
                className={`${hp.chip} !h-10 flex flex-col items-center justify-center !px-1 ${d ? '!text-2xl' : '!text-base'} !font-black !leading-none disabled:opacity-40`} aria-pressed={direction === d} onClick={() => setDirection(d)}>
                {d || '方角なし'}{registeredDirections.has(d) && <small className="mt-px text-[9px] font-bold">登録済み</small>}
              </button>)}
            </div>
          </>}
          <label className="flex flex-col gap-1 text-sm font-bold">この棚の名前<input className={`${hp.input} !text-xl !text-[var(--hp-shelf)]`} value={code} readOnly /></label>
          <label className="flex flex-col gap-1 text-sm font-bold">メモ<textarea className={`${hp.input} !h-16 py-2 !font-sans`} value={memo} maxLength={60} disabled={busy} placeholder="例: ロボドリル01 南 上段" onChange={(e) => setMemo(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-[var(--hp-ng)]">{error}</p>}
          {shelf && <div className="flex gap-2 pb-2.5">
            <button type="button" disabled={busy} className={`${hp.mini} ${confirmDelete ? '!bg-[var(--hp-ng)] !text-[var(--hp-bg)] !border-[var(--hp-ng)]' : '!text-[var(--hp-ng)]'}`}
              onClick={() => { if (confirmDelete) void deleteShelf(); else setConfirmDelete(true); }}>
              {confirmDelete ? '本当に消す' : 'この棚を消す'}
            </button>
            {confirmDelete && <button type="button" disabled={busy} className={hp.mini} onClick={() => setConfirmDelete(false)}>やめる</button>}
          </div>}
        </div>
        <footer className={`${hp.dock} ${!createdCode ? '[@media(max-height:768px)]:!pt-0 [@media(max-height:768px)]:!pb-[calc(12px+env(safe-area-inset-bottom,0px))]' : ''}`}><button type="submit" className={`${hp.primary} bg-[var(--hp-shelf)]`} disabled={!canSave}>
          <HaizenIcon name="check" />{busy ? '処理中…' : shelf ? '保存する' : '登録する'}
        </button></footer>
      </form>
    </div>
  </Dialog>
    {cameraOpen && <ShelfPhotoCamera onCapture={(captured) => { setPhoto(captured); setCameraOpen(false); }}
      onClose={() => setCameraOpen(false)} onSelectFile={() => input.current?.click()} />}
    {landmarkSheet && <ShelfLandmarkSheet machine={machine} shelves={shelves} machines={machinesQuery.data?.machines ?? []} landmarks={machinesQuery.data?.landmarks ?? []}
      onClose={() => setLandmarkSheet(false)} onSelect={(name) => { setMachine(name); setDirection(null); setLandmarkSheet(false); }}
      onDelete={(name) => { if (machine === name) { setMachine(''); setDirection(null); } }} />}
  </div>;
}

function ShelfLandmarkSheet({ machine, shelves, machines, landmarks, onClose, onSelect, onDelete }: {
  machine: string; shelves: RegisteredShelfEntryDto[]; machines: string[]; landmarks: string[];
  onClose: () => void; onSelect: (name: string) => void; onDelete: (name: string) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = async (deleting?: string) => {
    if (busy || (!deleting && !name.trim())) return;
    setBusy(true); setError(null);
    try {
      if (deleting) {
        await deleteMobilePlacementShelfLandmark(deleting);
        onDelete(deleting);
        setConfirmDelete(null);
      } else {
        const added = await postMobilePlacementShelfLandmark(name.trim());
        onSelect(added.name);
      }
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.shelfMachines });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    } catch (e) {
      setError(isAxiosError(e) && typeof e.response?.data?.message === 'string' ? e.response.data.message : e instanceof Error ? e.message : '目安を更新できませんでした');
      setConfirmDelete(null);
    } finally { setBusy(false); }
  };
  const row = (value: string, own: boolean) => {
    const used = shelves.some((s) => s.shelfCodeRaw === value || SHELF_DIRECTIONS.some((d) => s.shelfCodeRaw === composeArea(value, d)));
    const confirming = confirmDelete === value;
    return <div key={value} className="flex items-center gap-1.5">
      <button type="button" disabled={busy} aria-pressed={machine === value} onClick={() => onSelect(value)}
        className={`${hp.segment} !h-12 min-w-0 flex-1 truncate !bg-[var(--hp-bg)] !px-3 text-left !text-[17px] aria-pressed:!bg-[color-mix(in_srgb,var(--hp-panel)_70%,var(--hp-shelf))]`}>{value}</button>
      {own && !used && <button type="button" disabled={busy} aria-label={`${value} を消す`}
        className={`${hp.mini} ${confirming ? '!bg-[var(--hp-ng)] !border-[var(--hp-ng)] !text-[var(--hp-bg)]' : '!text-[var(--hp-ng)]'}`}
        onClick={() => { if (confirming) void change(value); else setConfirmDelete(value); }}>{confirming ? '消す' : '×'}</button>}
    </div>;
  };
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} ariaLabel="目安を選ぶ" overlayZIndex={70}
    className={`${hp.sheet} !flex !max-h-[86dvh] !flex-col !overflow-hidden`}>
    <div style={haizenPhoneStyle} className="flex min-h-0 flex-col gap-2.5">
      <div className="flex shrink-0 items-center justify-between"><h2 className="text-lg font-black">目安を選ぶ</h2><button type="button" disabled={busy} className={hp.mini} onClick={onClose}>閉じる</button></div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {landmarks.map((value) => row(value, true))}
        <form className="flex shrink-0 gap-1.5" onSubmit={(e) => { e.preventDefault(); void change(); }}>
          <input aria-label="新しい目安" placeholder="例: 電気室" maxLength={30} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} className={`${hp.input} flex-1 !font-sans`} />
          <button type="submit" disabled={busy || !name.trim()} className={`${hp.mini} !h-11 !text-[var(--hp-ink)]`}>追加</button>
        </form>
        {error && <p role="alert" className="text-sm text-[var(--hp-ng)]">{error}</p>}
        <h3 className={`mt-1.5 text-[13px] ${hp.muted}`}>加工機</h3>
        {machines.map((value) => row(value, false))}
      </div>
    </div>
  </Dialog>;
}
