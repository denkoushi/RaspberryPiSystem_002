import { useEffect, useRef, useState } from 'react';

import { getProcedureVideoPoster } from '../../../api/client';

export function ProcedureVideoThumbnail({ id, title }: { id: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let requested = false;
    let objectUrl: string | undefined;
    const load = () => {
      if (requested || cancelled) return;
      requested = true;
      void getProcedureVideoPoster(id).then((blob) => {
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
  }, [id]);
  return <div ref={ref} className="flex h-16 w-24 shrink-0 items-center justify-center rounded bg-slate-200 text-xs text-slate-600">{url ? <img src={url} alt={title} className="h-full w-full object-contain" /> : failed ? '画像なし' : '読込中…'}</div>;
}
