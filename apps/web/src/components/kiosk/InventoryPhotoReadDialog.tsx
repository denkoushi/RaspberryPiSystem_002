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

/** A photo change remounts the session, aborting work and discarding its current frame. */
function PhotoReadSession({ photo, count, onPrevious, onNext, saved, save, filled, candidates, selected, setSelected, addCandidates, ...props }: Omit<Props, 'photos' | 'initialPhotoId'> & {
  photo: Photo; count: string | null; onPrevious: () => void; onNext: () => void;
  saved: Frame[]; save: (frames: Frame[]) => void; filled: Set<InventoryOptionField>;
  candidates: string[]; selected: number; setSelected: (index: number) => void; addCandidates: (values: string[]) => void;
}) {
  const { imageUrl, error } = useInventoryFullPhoto(photo.photoUrl);
  const [loaded, setLoaded] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [busy, setBusy] = useState(false);
  const [bbox, setBBox] = useState<OverlayBBox | null>(null);
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
      addCandidates(result.candidates);
      setMessage(result.candidates.length ? '入れる先を押す' : '文字なし。囲み直す');
    } catch {
      if (!controller.signal.aborted) { setMessage('読み取れませんでした'); setFailed(true); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const readSaved = async () => {
    const controller = start();
    let applied = 0;
    let unavailable = false;
    for (const frame of saved) {
      try {
        const result = await readInventoryPhotoRegion({ ...props.source, photoId: photo.id, bbox: frame.bbox }, props.accessPassword, controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === 'unavailable') unavailable = true;
        else {
          addCandidates(result.candidates);
          if (result.candidates[0]) { props.onApply(frame.field, result.candidates[0]); applied += 1; }
        }
      } catch { if (controller.signal.aborted) return; unavailable = true; }
    }
    setBusy(false);
    setFailed(unavailable);
    setMessage(applied ? `${applied} 件入れた` : unavailable ? '読み取れませんでした' : '文字なし');
  };

  return <div className="grid h-dvh grid-cols-[minmax(0,1fr)_480px] overflow-hidden">
    <div className="flex min-h-0 min-w-0 items-center justify-center">
      {imageUrl ? <div className="relative shrink-0" aria-label="読み取り写真" style={{ width: `min(100%, calc(100dvh * ${aspectRatio}))`, aspectRatio }}>
        <img src={imageUrl} alt={photo.alt} draggable={false} onLoad={event => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth && naturalHeight) setAspectRatio(naturalWidth / naturalHeight);
          setLoaded(true);
        }} className="block h-full w-full object-contain" />
        {loaded ? <>
          {saved.map(frame => <FrameBox key={frame.field} bbox={frame.bbox} saved />)}
          {bbox ? <FrameBox bbox={bbox} /> : null}
          <OverlayRangeSelectionSurface selectionMode={!busy} onRangeSelected={region => void read(region)} ariaLabel="文字を囲む" data-kiosk-sop-target="inventory-photo-read-range" previewTestId="inventory-photo-read-pending-range" previewClassName="border-inv-amber bg-inv-amber/20" />
        </> : null}
      </div> : null}
      {!imageUrl && !error ? <p role="status" className="text-inv-muted">画像を読み込み中…</p> : null}
      {error ? <p role="alert" className="text-inv-red">画像の取得に失敗しました</p> : null}
    </div>
    <aside className="flex min-h-0 min-w-0 flex-col gap-3.5 overflow-hidden border-l border-inv-line bg-inv-s1 p-[18px]">
      <div className="flex shrink-0 items-center gap-2.5">
        {count ? <div role="group" aria-label="写真の切り替え" className="flex items-center gap-2.5">
          <button type="button" aria-label="前の写真" className={`${invButton} !h-[60px] w-[72px] text-2xl`} onClick={onPrevious}>＜</button>
          <span aria-label="写真の枚数" className="min-w-[84px] text-center text-2xl font-extrabold tabular-nums">{count}</span>
          <button type="button" aria-label="次の写真" className={`${invButton} !h-[60px] w-[72px] text-2xl`} onClick={onNext}>＞</button>
        </div> : null}
        <button type="button" className={`${invButtonGhost} ml-auto !h-14 !text-lg`} onClick={props.onClose}>閉じる</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain">
        <p role="status" className={`min-h-9 shrink-0 text-[22px] font-extrabold ${failed ? 'text-inv-red' : ''}`}>{message}</p>
        {failed && message !== '読み取れませんでした' ? <p role="alert" className="text-inv-red">読み取れませんでした</p> : null}
        <div className="flex shrink-0 flex-col gap-2" role="group" aria-label="読み取り候補">
          {candidates.map((candidate, index) => <button key={candidate} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={`min-h-14 rounded-xl border-2 border-inv-cyan px-3.5 py-2 text-left text-[21px] font-extrabold [overflow-wrap:anywhere] ${selected === index ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-cyan/10'}`}>{candidate}</button>)}
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-1.5" role="group" aria-label="入れる先">
          {fields.map(([field, label]) => <div key={field} className={`grid min-h-14 min-w-0 grid-cols-[86px_minmax(0,1fr)_76px] items-stretch gap-2 rounded-xl border bg-inv-bg p-1 pl-3 text-left ${filled.has(field) ? 'border-inv-green' : 'border-inv-line2'}`}>
            <small className="self-center text-[15px] text-inv-faint">{label}</small>
            <textarea aria-label={`${label}の値`} rows={1} placeholder="—" value={props.values[field] ?? ''}
              ref={element => {
                if (!element) return;
                element.style.height = 'auto';
                element.style.height = `${element.scrollHeight}px`;
              }}
              onChange={event => props.onApply(field, event.currentTarget.value)}
              onKeyDown={event => {
                // Keep editing (including IME Escape) local, but retain the dialog's Tab focus trap.
                if (event.key !== 'Tab') event.stopPropagation();
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault();
              }}
              className="min-h-[46px] min-w-0 resize-none overflow-hidden rounded-lg border-0 bg-transparent px-1.5 py-2.5 text-[19px] font-bold leading-[1.3] text-inv-text [field-sizing:content] [overflow-wrap:anywhere] focus:bg-inv-s2 focus:outline focus:outline-2 focus:outline-inv-cyan"
            />
            <button type="button" aria-label={`${label}に入れる`} disabled={busy || !candidates.length} className="min-h-11 min-w-11 rounded-[9px] border border-inv-cyan bg-inv-cyan/10 text-[17px] font-extrabold disabled:cursor-default disabled:border-inv-line2 disabled:bg-transparent disabled:text-inv-faint" onClick={() => {
              if (!candidates[selected]) return;
              props.onApply(field, candidates[selected]);
              setLast(bbox ? { field, bbox } : null);
              setMessage(`${label}に入れた`);
            }}>{filled.has(field) ? <b className="text-xl text-inv-green">✓ </b> : null}入れる</button>
          </div>)}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[15px] text-inv-muted" aria-label="記憶した枠の一覧">
          {saved.length ? '記憶した枠' : null}
          {saved.map(frame => {
            const label = fields.find(([field]) => field === frame.field)![1];
            return <span key={frame.field} className="inline-flex items-center rounded-lg border border-dashed border-inv-cyan pl-2 text-inv-cyan">{label}<button type="button" aria-label={`${label}の枠を消す`} className="h-11 w-11" onClick={() => save(saved.filter(entry => entry.field !== frame.field))}>✕</button></span>;
          })}
        </div>
        <div className="flex gap-2.5">
          <button type="button" className={`${invButton} !h-14 !text-lg`} disabled={!last} onClick={() => { if (!last) return; save([...saved.filter(frame => frame.field !== last.field), last]); setLast(null); setMessage('枠を記憶した'); }}>枠を記憶</button>
          <button type="button" className={`${invButton} !h-14 !text-lg`} disabled={!saved.length || busy || !loaded} onClick={() => void readSaved()}>記憶した枠で読む{saved.length ? `（${saved.length}）` : ''}</button>
        </div>
      </div>
    </aside>
  </div>;
}

export function InventoryPhotoReadDialog({ photos, initialPhotoId, ...props }: Props) {
  const [photoId, setPhotoId] = useState(initialPhotoId);
  const [saved, setSaved] = useState(readFrames);
  const [filled, setFilled] = useState<Set<InventoryOptionField>>(() => new Set());
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const addCandidates = (values: string[]) => {
    if (!values.length) return;
    setCandidates(current => [...new Set([...values, ...current])]);
    setSelected(0);
  };
  const apply = (field: InventoryOptionField, value: string) => {
    props.onApply(field, value);
    setFilled(current => new Set(current).add(field));
  };
  const index = Math.max(0, photos.findIndex(photo => photo.id === photoId));
  const photo = photos[index];
  const save = (frames: Frame[]) => {
    setSaved(frames);
    try { localStorage.setItem(framesKey, JSON.stringify(frames)); } catch { /* Storage is optional. */ }
  };
  const go = (offset: number) => setPhotoId(photos[(index + offset + photos.length) % photos.length].id);
  return <Dialog isOpen={Boolean(photo)} onClose={props.onClose} ariaLabel="在庫写真" size="full" className="!fixed !inset-0 !m-0 !h-dvh !max-h-none !w-full !rounded-none !border-0 !bg-inv-bg !p-0 !text-inv-text overflow-hidden">
    {photo ? <PhotoReadSession key={photo.id} {...props} onApply={apply} filled={filled} candidates={candidates} selected={selected} setSelected={setSelected} addCandidates={addCandidates} photo={photo} count={photos.length > 1 ? `${index + 1} / ${photos.length}` : null} onPrevious={() => go(-1)} onNext={() => go(1)} saved={saved} save={save} /> : null}
  </Dialog>;
}
