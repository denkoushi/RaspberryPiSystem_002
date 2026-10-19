import { useEffect, useRef, useState } from 'react';

import { getProcedureVideoPoster } from '../../../api/client';

import { procedureVideoTime } from './procedure-video-types';

export function ProcedureVideoThumbnail({ id, title, durationSeconds, className, sceneId, hasScenePoster }: { id: string; title: string; durationSeconds?: number | null; className?: string; sceneId?: string | null; hasScenePoster?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null); setFailed(false);
    let cancelled = false;
    let requested = false;
    let objectUrl: string | undefined;
    const load = () => {
      if (requested || cancelled) return;
      requested = true;
      void getProcedureVideoPoster(id, sceneId && hasScenePoster ? sceneId : undefined).then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      }).catch(() => { if (!cancelled) setFailed(true); });
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') load();
    else {
      observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); load(); } });
      if (ref.current) observer.observe(ref.current);
    }
    return () => { cancelled = true; observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, sceneId, hasScenePoster]);
  return <div ref={ref} className={`relative flex ${className ?? 'h-16 w-24'} shrink-0 items-center justify-center rounded bg-slate-200 text-xs text-slate-600`}>{url ? <img src={url} alt={title} className="h-full w-full object-contain" /> : failed ? '画像なし' : '読込中…'}{durationSeconds != null ? <span className="absolute bottom-0 right-0 rounded bg-black/75 px-1 text-white">{procedureVideoTime(durationSeconds)}</span> : null}</div>;
}
