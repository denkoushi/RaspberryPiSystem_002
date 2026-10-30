import { SHELF_DIRECTIONS, composeArea } from '@raspi-system/shelf-layout-core';
import { useState } from 'react';

import { Dialog } from '../../../../components/ui/Dialog';
import { HaizenHeader } from '../../haizen/HaizenHeader';
import { HaizenIcon } from '../../haizen/HaizenIcon';
import { HaizenSheet } from '../../haizen/HaizenSheet';
import { ShelfPhoto } from '../../shelfPhoto/ShelfPhoto';
import { ShelfPhotoCamera } from '../../shelfPhoto/ShelfPhotoCamera';
import { haizenPhoneStyle, hp } from '../../ui/haizenPhoneTokens';
import { useRegisteredShelves } from '../../useRegisteredShelves';
import { useShelfMachines } from '../../useShelfMachines';
import { useShelfLandmarkEditor } from '../kiosk/useShelfLandmarkEditor';
import { useShelfPhotoEditor } from '../kiosk/useShelfPhotoEditor';
import { useShelfOfflineQueue } from '../offline/useShelfOfflineQueue';
import { clearShelfPhotoDraft, readShelfPhotoDraft } from '../shelfPhotoDraft';
import { useHaizenTargetDevicesForShelfMaster } from '../useShelfMasterQueries';
import { buildZero2wPiSelectOptions } from '../zero2wPreset/zero2wPiSelectOptions';
import { ZERO2W_PI_CLEAR, ZERO2W_PI_UNCHANGED } from '../zero2wPreset/zero2wPiSelectValue';

import type { RegisteredShelfEntryDto } from '../../registeredShelves';

export function ShelfPhotoMaster({ onMessage }: { onMessage?: (message: string) => void }) {
  const query = useRegisteredShelves();
  const machinesQuery = useShelfMachines();
  const devicesQuery = useHaizenTargetDevicesForShelfMaster();
  const queue = useShelfOfflineQueue();
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const checking = queue.records.find((record) => record.id === checkingId);
  const queuedCodes = new Set(queue.records.map((record) => record.shelfCodeRaw));
  const shelves = (query.data?.shelves ?? []).filter((shelf) => !queuedCodes.has(shelf.shelfCodeRaw));
  const occupiedShelves = [...shelves, ...queue.records.map((record) => ({ shelfCodeRaw: record.shelfCodeRaw, isStructured: true }))];
  const [editing, setEditing] = useState<RegisteredShelfEntryDto | 'new' | null>(() => readShelfPhotoDraft() ? 'new' : null);
  return <>
    <div className={hp.list}>
      {query.isLoading ? <p className={hp.empty}>読込中…</p> : query.isError ? <div role="alert" className={hp.empty}>棚を取得できませんでした <button className={hp.mini} onClick={() => void query.refetch()}>再試行</button></div>
        : <>
          {shelves.map((shelf) => {
            const device = devicesQuery.data?.devices.find((device) => device.shelfCodeRaw === shelf.shelfCodeRaw);
            return <button key={shelf.shelfCodeRaw} type="button" aria-label={`棚 ${shelf.shelfCodeRaw} を編集`} onClick={() => setEditing(shelf)}
            className="flex items-center gap-2.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] p-2 text-left">
            <ShelfPhoto shelf={shelf} className="h-[72px] w-24 shrink-0 rounded-[10px]" />
            <span className="min-w-0"><b className="block font-mono text-xl text-[var(--hp-shelf)]">{shelf.shelfCodeRaw}</b><span className={`block truncate text-[13px] ${hp.muted}`}>{shelf.displayLabel}</span>
              {device && <span className="mt-1 inline-flex h-6 items-center rounded-full border border-[var(--hp-slip)] px-2 text-xs font-bold text-[var(--hp-slip)]">{device.name}</span>}
            </span>
          </button>; })}
          {!shelves.length && !queue.records.length && <p className={hp.empty}>棚がありません</p>}
        </>}
      {queue.records.map((record) => <button key={record.id} type="button" aria-label={`棚 ${record.shelfCodeRaw} ${record.status === 'pending' ? '未送信' : '要確認'}`}
        disabled={record.status === 'pending'} onClick={() => { setCheckingId(record.id); setConfirmDelete(false); }}
        className="flex items-center gap-2.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] p-2 text-left">
        <img alt={`棚 ${record.shelfCodeRaw} の写真`} src={`data:${record.photo.contentType};base64,${record.photo.dataBase64}`} className="h-[72px] w-24 shrink-0 rounded-[10px] object-cover" />
        <span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><b className="font-mono text-xl text-[var(--hp-shelf)]">{record.shelfCodeRaw}</b>
          <span className={`${hp.chip} ${record.status === 'needs_check' ? '!text-[var(--hp-ng)]' : ''}`}>{record.status === 'pending' ? '未送信' : '要確認'}</span></span>
          <span className={`block truncate text-[13px] ${hp.muted}`}>{record.displayLabel}</span></span>
      </button>)}
    </div>
    {checking && <Dialog isOpen onClose={() => { if (!removing) setCheckingId(null); }} ariaLabel="要確認" className={hp.sheet}>
      <div style={haizenPhoneStyle} className="space-y-3">
        <b>{checking.shelfCodeRaw}</b><p>{checking.message}</p>
        <div className="flex gap-2"><button type="button" className={hp.mini} disabled={removing} onClick={() => {
          if (!confirmDelete) { setConfirmDelete(true); return; }
          setRemoving(true);
          void queue.remove(checking.id).then(() => setCheckingId(null)).finally(() => setRemoving(false));
        }}>{confirmDelete ? '本当に消す' : '消す'}</button>
          <button type="button" className={hp.mini} disabled={removing} onClick={() => setCheckingId(null)}>閉じる</button></div>
      </div>
    </Dialog>}
    <footer className={hp.dock}><button type="button" disabled={query.isLoading} className={`${hp.primary} bg-[var(--hp-shelf)]`} onClick={() => setEditing('new')}><span aria-hidden>＋</span>棚を追加</button></footer>
    {editing && <ShelfPhotoForm shelf={editing === 'new' ? null : editing} shelves={occupiedShelves} machinesQuery={machinesQuery} devicesQuery={devicesQuery} submit={queue.submit} onClose={() => { if (editing === 'new') clearShelfPhotoDraft(); setEditing(null); }} onMessage={onMessage} />}
  </>;
}

function ShelfPhotoForm({ shelf, shelves, machinesQuery, devicesQuery, submit, onClose, onMessage }: { shelf: RegisteredShelfEntryDto | null; shelves: RegisteredShelfEntryDto[]; machinesQuery: ReturnType<typeof useShelfMachines>; devicesQuery: ReturnType<typeof useHaizenTargetDevicesForShelfMaster>; submit: ReturnType<typeof useShelfOfflineQueue>['submit']; onClose: () => void; onMessage?: (message: string) => void }) {
  const { zeroSheet, setZeroSheet, selectedPi, setSelectedPi, setZeroDraft, devices, currentDeviceId, draftDeviceId, draftDevice, input, cameraOpen, setCameraOpen, machine, setMachine, landmarkSheet, setLandmarkSheet, direction, setDirection, memo, setMemo, photo, setPhoto, createdCode, busy, confirmDelete, setConfirmDelete, error, directions, registeredDirections, code, canSave, deleteShelf, save, selectPhoto, rotatePhoto } = useShelfPhotoEditor({ shelf, shelves, machinesQuery, devicesQuery, submit, onClose, onMessage });
  return <div style={haizenPhoneStyle}><Dialog isOpen closeOnEsc={!landmarkSheet && !cameraOpen && !zeroSheet} trapFocus={!landmarkSheet && !cameraOpen && !zeroSheet} onClose={() => { if (!busy && !landmarkSheet && !cameraOpen && !zeroSheet) onClose(); }} ariaLabel={shelf ? '棚を直す' : '棚を追加'} overlayZIndex={60}
    className="!fixed !inset-0 !m-auto !flex !h-dvh !max-h-none !w-full !max-w-[480px] !flex-col !rounded-none !border-0 !bg-[#0d0f0e] !p-0 !text-[#f2f4f1]">
    <div style={haizenPhoneStyle} className="flex min-h-0 flex-1 flex-col">
      <HaizenHeader title={shelf ? '棚を直す' : '棚を追加'} onBack={() => { if (!busy) onClose(); }} />
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className={`flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-2 ${!createdCode ? '[@media(max-height:768px)]:gap-0 [@media(max-height:768px)]:pt-0 [@media(max-height:768px)]:[&>label]:gap-0' : ''}`}>
          <input ref={input} type="file" accept="image/*" capture="environment" aria-label="棚の写真" className="hidden" disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = '';
            if (!file) return;
            await selectPhoto(file);
          }} />
          <div className="relative aspect-[4/3] max-h-[27dvh] w-full max-w-[280px] shrink-0 self-center">
            <button type="button" disabled={busy} className="relative grid h-full w-full place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-[var(--hp-line)] bg-[var(--hp-panel)] text-[17px] font-bold" onClick={() => setCameraOpen(true)}>
              {photo ? <img alt="登録する棚の写真" src={`data:${photo.contentType};base64,${photo.dataBase64}`} className="absolute inset-0 h-full w-full object-cover" />
                : shelf?.photoUpdatedAt ? <ShelfPhoto shelf={shelf} className="absolute inset-0 h-full w-full" /> : <span><HaizenIcon name="photo" className="mx-auto mb-1.5 h-10 w-10" />棚の写真を撮る</span>}
              {(photo || shelf?.photoUpdatedAt) && <span className="absolute bottom-2 right-2 rounded-[10px] bg-[var(--hp-bg)] px-3 py-2.5 text-sm">撮り直す</span>}
            </button>
            {photo && <button type="button" aria-label="写真を回す" disabled={busy} className="absolute bottom-2 left-2 grid h-11 w-11 place-items-center rounded-[10px] bg-[var(--hp-bg)]"
              onClick={() => void rotatePhoto()}><HaizenIcon name="rotate" className="h-6 w-6" /></button>}
          </div>
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
          {shelf?.isStructured && <label className="flex flex-col gap-1 text-sm font-bold">Zero2W
            <button type="button" disabled={busy || devicesQuery.isPending || devicesQuery.isError}
              className={`flex h-14 w-full shrink-0 items-center justify-between rounded-[12px] border bg-[var(--hp-panel)] px-3 text-left text-[17px] ${draftDevice ? 'border-[var(--hp-slip)] text-[var(--hp-slip)]' : 'border-[var(--hp-line)] text-[var(--hp-ink3)]'}`}
              onClick={() => { setSelectedPi(draftDeviceId ?? ZERO2W_PI_CLEAR); setZeroSheet(true); }}>
              {draftDevice?.name ?? '未設定'}<span aria-hidden>›</span>
            </button>
          </label>}
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
    {zeroSheet && shelf && <HaizenSheet title={`Zero2W · ${shelf.shelfCodeRaw}`} onClose={() => setZeroSheet(false)}>
      <div className="flex items-center justify-between"><h2 className="font-black">Zero2W · {shelf.shelfCodeRaw}</h2><button type="button" className={hp.mini} onClick={() => setZeroSheet(false)}>やめる</button></div>
      <div className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
        {buildZero2wPiSelectOptions(devices, shelf.shelfCodeRaw)
          .filter((option) => option.value !== ZERO2W_PI_UNCHANGED && (option.value !== ZERO2W_PI_CLEAR || currentDeviceId || draftDeviceId || selectedPi !== ZERO2W_PI_CLEAR))
          .map((option) => <button key={option.value} type="button" disabled={option.disabled}
            aria-pressed={selectedPi === option.value}
            className={`${hp.segment} flex !h-auto min-h-[60px] w-full shrink-0 items-center justify-between text-left !text-[17px] disabled:opacity-40 ${option.value === ZERO2W_PI_CLEAR ? '!text-[var(--hp-ng)]' : ''}`}
            onClick={() => setSelectedPi(option.value)}>
            {option.value === ZERO2W_PI_CLEAR ? 'Zero2W 外す' : option.label}
            {option.subLabel && <small className="ml-2 font-mono text-xs">{option.subLabel}</small>}
          </button>)}
      </div>
      <button type="button" className="h-14 self-end rounded-[12px] bg-[var(--hp-slip)] px-6 text-[17px] font-bold text-[var(--hp-bg)]"
        onClick={() => { setZeroDraft(selectedPi); setZeroSheet(false); }}>確定</button>
    </HaizenSheet>}
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
  const { name, setName, confirmDelete, setConfirmDelete, busy, error, change } = useShelfLandmarkEditor({ onSelect, onDelete });
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
