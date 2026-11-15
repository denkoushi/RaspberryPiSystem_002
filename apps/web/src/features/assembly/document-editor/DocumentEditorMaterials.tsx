import { useEffect, useRef, useState } from 'react';

import { getProcedureMaterialThumbnail, listProcedureMaterials } from '../../../api/client';
import { ProcedureMaterialPhotoCache } from '../procedure-manuals/procedure-material-photo-cache';

import type { useMaterialDrag } from './useMaterialDrag';
import type { ProcedureMaterialDto } from '../procedure-manuals/procedure-material-types';

export function DocumentEditorMaterials({ revision, disabled, drag }: {
  revision: number;
  disabled: boolean;
  drag: Pick<ReturnType<typeof useMaterialDrag>, 'onPointerDown' | 'onClick'> & { activeMaterialId?: string | null };
}) {
  const [materials, setMaterials] = useState<ProcedureMaterialDto[]>([]);
  const [photoCache] = useState(() => new ProcedureMaterialPhotoCache());
  useEffect(() => () => photoCache.clear(), [photoCache]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    void listProcedureMaterials({ state: 'unplaced', limit: 500 }).then(rows => {
      if (!cancelled) setMaterials(rows.filter(row => row.kind !== 'PDF' && !row.placedAt && !row.documentId && !row.discardedAt));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [revision]);
  return <div className="grid content-start gap-2">
    {error ? <p role="alert">素材を取得できませんでした。</p> : null}
    {materials.map(material => <button key={material.id} type="button" disabled={disabled}
      aria-label={`素材を置く: ${material.text || material.originalFileName || material.subjectHint || '写真'}`}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => drag.onPointerDown(material, event)} onClick={() => drag.onClick(material)}
      className={`select-none overflow-hidden rounded-lg border bg-white text-left text-slate-900 disabled:opacity-40 ${drag.activeMaterialId === material.id ? 'border-blue-400 ring-2 ring-blue-400' : 'border-[#344252]'}`} style={{ touchAction: 'pan-y', userSelect: 'none' }}>
      {material.kind === 'PHOTO' ? <MaterialPhoto id={material.id} cache={photoCache} /> : <span className="block h-28 overflow-hidden whitespace-pre-wrap break-words p-3">{material.text}</span>}
    </button>)}
  </div>;
}

function MaterialPhoto({ id, cache }: { id: string; cache: ProcedureMaterialPhotoCache }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let request: ReturnType<ProcedureMaterialPhotoCache['request']> | undefined;
    const load = () => {
      if (request || cancelled) return;
      request = cache.request(id, () => getProcedureMaterialThumbnail(id));
      void request.promise.then(value => { if (!cancelled) setUrl(value); }).catch(() => { /* Keep the card usable if its thumbnail fails. */ });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect(); }
    });
    if (observer && ref.current) observer.observe(ref.current);
    else load();
    return () => { cancelled = true; observer?.disconnect(); request?.release(); };
  }, [id, cache]);
  return <span ref={ref} className="block h-28">{url ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" /> : null}</span>;
}
