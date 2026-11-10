import { splitArea } from '@raspi-system/shelf-layout-core';
import { useEffect, useRef } from 'react';

import { ShelfPhoto } from '../../shelfPhoto/ShelfPhoto';
import { ShelfPhotoCamera } from '../../shelfPhoto/ShelfPhotoCamera';
import { buildZero2wPiSelectOptions } from '../zero2wPreset/zero2wPiSelectOptions';
import { ZERO2W_PI_CLEAR, ZERO2W_PI_UNCHANGED } from '../zero2wPreset/zero2wPiSelectValue';

import { compassDirections, displayName } from './shelfKioskModel';
import { useShelfPhotoEditor } from './useShelfPhotoEditor';

import type { ShelfPhotoEditorProps } from './useShelfPhotoEditor';

export function useDeleteConfirmation(confirmed: boolean, reset: () => void) {
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    if (!confirmed) return;
    const timer = window.setTimeout(() => resetRef.current(), 4000);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') resetRef.current(); };
    window.addEventListener('keydown', escape);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', escape); };
  }, [confirmed]);
}
export function ShelfKioskEditor(props: ShelfPhotoEditorProps) {
  const e = useShelfPhotoEditor(props);
  useDeleteConfirmation(e.confirmDelete, () => e.setConfirmDelete(false));
  const position = props.shelf ? splitArea(props.shelf.shelfCodeRaw) : null;
  const selectedDirection = position ? position.direction ?? '' : e.direction;
  return <form className={`sk-editor ${props.shelf ? '' : 'sk-new'}`} aria-label="棚" onSubmit={(event) => { event.preventDefault(); void e.save(); }}>
    <input ref={e.input} type="file" accept="image/*" capture="environment" aria-label="棚の写真" className="hidden" disabled={e.busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void e.selectPhoto(file); }} />
    <div className="sk-photo">{e.photo ? <img alt="登録する棚の写真" src={`data:${e.photo.contentType};base64,${e.photo.dataBase64}`} /> : props.shelf ? <ShelfPhoto shelf={props.shelf} label={displayName(props.shelf.shelfCodeRaw)} className="h-full w-full" /> : null}
      {e.photo || props.shelf ? <div className="sk-tools">{(e.photo || props.shelf?.photoUpdatedAt) && <button type="button" disabled={e.busy} onClick={() => void e.rotatePhoto()}>回す</button>}<button type="button" disabled={e.busy} onClick={() => e.setCameraOpen(true)}>撮り直す</button></div> : <button type="button" className="sk-shoot" disabled={e.busy} onClick={() => e.setCameraOpen(true)}>写真を撮る</button>}
    </div>
    <input aria-label="この棚の名前" className="sk-name" value={displayName(e.code)} readOnly />
    <div className="sk-rows"><div className="sk-row"><span>方角</span><div className="sk-dirwrap"><div className="sk-pad">{compassDirections.map((d, index) => !d ? <span key={index} className="sk-pad-center">○</span> : <button type="button" key={d} aria-pressed={selectedDirection === d} disabled={e.busy || Boolean(props.shelf) || e.registeredDirections.has(d)} onClick={() => e.setDirection(d)}>{d}</button>)}</div><button type="button" aria-pressed={selectedDirection === ''} disabled={e.busy || Boolean(props.shelf) || e.registeredDirections.has('')} onClick={() => e.setDirection('')}>方角なし</button></div></div>
      {props.shelf?.isStructured && <div className="sk-row"><span>Zero2W</span><div className="sk-picks">{buildZero2wPiSelectOptions(e.devices, props.shelf.shelfCodeRaw).filter((o) => o.value !== ZERO2W_PI_UNCHANGED).map((o) => <button type="button" key={o.value} disabled={e.busy || props.devicesQuery.isPending || props.devicesQuery.isError || o.disabled} aria-pressed={(e.draftDeviceId ?? ZERO2W_PI_CLEAR) === o.value} onClick={() => e.setZeroDraft(o.value)}>{o.value === ZERO2W_PI_CLEAR ? 'なし' : o.label}</button>)}</div></div>}
      <label className="sk-row"><span>メモ</span><input aria-label="メモ" maxLength={60} value={e.memo} disabled={e.busy} onChange={(event) => e.setMemo(event.target.value)} /></label>
      {e.error && <p role="alert">{e.error}</p>}
    </div>
    <footer className="sk-foot">{props.shelf ? <button type="button" className="sk-delete" disabled={e.busy} onClick={() => { if (e.confirmDelete) void e.deleteShelf(); else e.setConfirmDelete(true); }}>{e.confirmDelete ? '本当に消す' : '消す'}</button> : <button type="button" disabled={e.busy} onClick={props.onClose}>やめる</button>}<button type="submit" className="sk-go" disabled={!e.canSave}>{props.shelf ? '保存する' : '登録する'}</button></footer>
    {e.cameraOpen && <ShelfPhotoCamera onCapture={(photo) => { e.setPhoto(photo); e.setCameraOpen(false); }} onClose={() => e.setCameraOpen(false)} onSelectFile={() => e.input.current?.click()} />}
  </form>;
}
