import { overlayRegionBBoxSchema, type OverlayBBox } from '@raspi-system/shared-types';
import { useEffect, useRef, useState } from 'react';

import { readInventoryPhotoRegion, type InventoryOptionField, type InventoryPhotoSource } from '../../api/client';
import { invButton, invButtonGhost } from '../../features/kiosk/inventory/inventoryUi';
import { OverlayRangeSelectionSurface } from '../../features/overlays/OverlayRangeSelectionSurface';
import { Dialog } from '../ui/Dialog';

import { useInventoryFullPhoto } from './useInventoryFullPhoto';

const fields = [
  ['name', '名前'], ['model', '型式'], ['maker', 'メーカー'], ['toolName', '工具名'],
  ['toolSize', '寸法'], ['workMaterial', '被削材'], ['usage', '用途'],
] as const;
const framesKey = 'kiosk-inventory-ocr-frames';
type Frame = { field: InventoryOptionField; bbox: OverlayBBox };
type Photo = { id: string; photoUrl: string; alt: string };
type Props = {
  photos: Photo[];
  initialPhotoId: string;
  source: InventoryPhotoSource;
  accessPassword: string;
  values: Partial<Record<InventoryOptionField, string | null>>;
  onApply: (field: InventoryOptionField, value: string) => void;
  onClose: () => void;
};

function readFrames(): Frame[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(framesKey) ?? '[]');
    if (!Array.isArray(stored)) return [];
    const frames = new Map<InventoryOptionField, Frame>();
    for (const entry of stored) {
      if (!entry || typeof entry !== 'object' || !fields.some(([field]) => field === entry.field)) continue;
      const bbox = overlayRegionBBoxSchema.safeParse(entry.bbox);
      if (bbox.success) frames.set(entry.field, { field: entry.field, bbox: bbox.data });
    }
    return [...frames.values()];
  } catch { return []; }
}

function FrameBox({ bbox, saved = false }: { bbox: OverlayBBox; saved?: boolean }) {
  return <div aria-label={saved ? '記憶した枠' : '読み取り枠'} className={`pointer-events-none absolute border-2 ${saved ? 'border-dashed border-inv-cyan bg-inv-cyan/10' : 'border-inv-amber bg-inv-amber/10'}`} style={{ left: `${bbox.xRatio * 100}%`, top: `${bbox.yRatio * 100}%`, width: `${bbox.widthRatio * 100}%`, height: `${bbox.heightRatio * 100}%` }} />;
}

/** A photo change remounts the session, aborting work and discarding its candidates. */
function PhotoReadSession({ photo, count, onPrevious, onNext, saved, save, ...props }: Omit<Props, 'photos' | 'initialPhotoId'> & {
  photo: Photo; count: string | null; onPrevious: () => void; onNext: () => void;
  saved: Frame[]; save: (frames: Frame[]) => void;
}) {
  const { imageUrl, error } = useInventoryFullPhoto(photo.photoUrl);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bbox, setBBox] = useState<OverlayBBox | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [last, setLast] = useState<Frame | null>(null);
  const [message, setMessage] = useState('文字を枠で囲む');
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  const start = () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setCandidates([]);
    setLast(null);
    setFailed(false);
    setMessage('読み取り中…');
    return controller;
  };
  const read = async (region: OverlayBBox) => {
    const controller = start();
    setBBox(region);
    try {
      const result = await readInventoryPhotoRegion({ ...props.source, photoId: photo.id, bbox: region }, props.accessPassword, controller.signal);
      if (controller.signal.aborted) return;
      if (result.status === 'unavailable') throw new Error('Unavailable');
      setCandidates(result.candidates);
      setSelected(0);
      setMessage(result.candidates.length ? '入れる先を押す' : '文字なし。囲み直す');
    } catch {
      if (!controller.signal.aborted) { setMessage('読み取れませんでした'); setFailed(true); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const readSaved = async () => {
    const controller = start();
    setBBox(null);
    let applied = 0;
    let unavailable = false;
    for (const frame of saved) {
      try {
        const result = await readInventoryPhotoRegion({ ...props.source, photoId: photo.id, bbox: frame.bbox }, props.accessPassword, controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === 'unavailable') unavailable = true;
        else if (result.candidates[0]) { props.onApply(frame.field, result.candidates[0]); applied += 1; }
      } catch { if (controller.signal.aborted) return; unavailable = true; }
    }
    setBusy(false);
    setFailed(unavailable);
    setMessage(applied ? `${applied} 件入れた` : unavailable ? '読み取れませんでした' : '文字なし');
  };

  return <div className="grid h-[calc(100dvh-4rem)] grid-cols-[minmax(0,1fr)_300px] grid-rows-[48px_minmax(0,1fr)_76px]">
    <div className="flex items-center justify-center">
      {count ? <span aria-label="写真の枚数" className="rounded-lg border border-inv-line2 bg-inv-s2 px-3 text-xl font-bold tabular-nums">{count}</span> : null}
    </div>
    <div className="col-start-1 row-start-2 flex min-h-0 min-w-0 items-center justify-center px-3">
      {imageUrl ? <div className="relative max-w-full" aria-label="読み取り写真">
        <img src={imageUrl} alt={photo.alt} draggable={false} onLoad={() => setLoaded(true)} className="block max-h-[calc(100dvh-12rem)] max-w-full object-contain" />
        {loaded ? <>
          {saved.map(frame => <FrameBox key={frame.field} bbox={frame.bbox} saved />)}
          {bbox ? <FrameBox bbox={bbox} /> : null}
          <OverlayRangeSelectionSurface selectionMode={!busy} onRangeSelected={region => void read(region)} ariaLabel="文字を囲む" data-kiosk-sop-target="inventory-photo-read-range" previewTestId="inventory-photo-read-pending-range" previewClassName="border-inv-amber bg-inv-amber/20" />
        </> : null}
      </div> : null}
      {!imageUrl && !error ? <p role="status" className="text-inv-muted">画像を読み込み中…</p> : null}
      {error ? <p role="alert" className="text-inv-red">画像の取得に失敗しました</p> : null}
    </div>
    <div className="col-start-1 row-start-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-3">
      <button type="button" className={`${invButton} justify-self-start`} disabled={!saved.length || busy || !loaded} onClick={() => void readSaved()}>記憶した枠で読む{saved.length ? `（${saved.length}）` : ''}</button>
      {count ? <div role="group" aria-label="写真の切り替え" className="flex gap-4">
        <button type="button" aria-label="前の写真" className={`${invButton} h-14 w-16 text-2xl`} onClick={onPrevious}>＜</button>
        <button type="button" aria-label="次の写真" className={`${invButton} h-14 w-16 text-2xl`} onClick={onNext}>＞</button>
      </div> : null}
      <span />
    </div>
    <aside className="col-start-2 row-span-3 row-start-1 flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-inv-line bg-inv-s1 p-3.5">
      <button type="button" className={`${invButtonGhost} self-end`} onClick={props.onClose}>閉じる</button>
      <p role="status" className={`text-lg font-bold ${failed ? 'text-inv-red' : ''}`}>{message}</p>
      {failed && message !== '読み取れませんでした' ? <p role="alert" className="text-inv-red">読み取れませんでした</p> : null}
      <div className="flex flex-col gap-1.5" role="group" aria-label="読み取り候補">
        {candidates.map((candidate, index) => <button key={candidate} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={`min-h-11 rounded-lg border px-3 py-1 text-left font-bold [overflow-wrap:anywhere] ${selected === index ? 'border-inv-amber bg-inv-amber/10' : 'border-inv-line2 bg-inv-s2'}`}>{candidate}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="入れる先">
        {fields.map(([field, label]) => <button key={field} type="button" aria-label={`${label}に入れる`} disabled={busy || !candidates.length} className={`min-h-12 min-w-0 rounded-lg border bg-inv-bg px-2.5 py-1 text-left ${candidates.length ? 'border-inv-amber' : 'border-inv-line2'}`} onClick={() => {
          if (!bbox || !candidates[selected]) return;
          props.onApply(field, candidates[selected]);
          setLast({ field, bbox });
          setCandidates([]);
          setMessage(`${label}に入れた`);
        }}><small className="block text-[11px] text-inv-faint">{label}</small><span className="block truncate text-[13px] font-bold">{props.values[field] || '—'}</span></button>)}
      </div>
      {last ? <button type="button" className={invButton} onClick={() => { save([...saved.filter(frame => frame.field !== last.field), last]); setLast(null); setMessage('枠を記憶した'); }}>枠を記憶</button> : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[13px] text-inv-muted" aria-label="記憶した枠の一覧">
        {saved.length ? '記憶した枠' : null}
        {saved.map(frame => {
          const label = fields.find(([field]) => field === frame.field)![1];
          return <span key={frame.field} className="inline-flex items-center rounded-lg border border-dashed border-inv-cyan pl-2 text-inv-cyan">{label}<button type="button" aria-label={`${label}の枠を消す`} className="h-11 w-11" onClick={() => save(saved.filter(entry => entry.field !== frame.field))}>✕</button></span>;
        })}
      </div>
    </aside>
  </div>;
}

export function InventoryPhotoReadDialog({ photos, initialPhotoId, ...props }: Props) {
  const [photoId, setPhotoId] = useState(initialPhotoId);
  const [saved, setSaved] = useState(readFrames);
  const index = Math.max(0, photos.findIndex(photo => photo.id === photoId));
  const photo = photos[index];
  const save = (frames: Frame[]) => {
    setSaved(frames);
    try { localStorage.setItem(framesKey, JSON.stringify(frames)); } catch { /* Storage is optional. */ }
  };
  const go = (offset: number) => setPhotoId(photos[(index + offset + photos.length) % photos.length].id);
  return <Dialog isOpen={Boolean(photo)} onClose={props.onClose} ariaLabel="在庫写真" size="full" className="!my-0 !border-inv-line !bg-inv-bg !p-0 !text-inv-text">
    {photo ? <PhotoReadSession key={photo.id} {...props} photo={photo} count={photos.length > 1 ? `${index + 1} / ${photos.length}` : null} onPrevious={() => go(-1)} onNext={() => go(1)} saved={saved} save={save} /> : null}
  </Dialog>;
}
