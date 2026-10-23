import { useEffect, useRef, useState } from 'react';

import { useShelfPhoto } from '../../mobile-placement/shelfPhoto/useShelfPhoto';

import type { MobilePlacementRegisteredShelfEntry } from '../../../api/domains/mobile-placement';

export function HaizenShelfPhoto({ shelf, dimmed = false }: { shelf: MobilePlacementRegisteredShelfEntry; dimmed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const photo = useShelfPhoto(shelf.shelfCodeRaw, visible ? shelf.photoUpdatedAt : null);
  const [failedUrl, setFailedUrl] = useState<string>();
  return <div ref={ref} className={`aspect-[4/3] w-full bg-inv-s3 ${dimmed ? 'grayscale brightness-[.55]' : ''}`}>
    {photo.url && failedUrl !== photo.url ? <img loading="lazy" decoding="async" src={photo.url} alt={`棚 ${shelf.shelfCodeRaw} の外観写真`} className="h-full w-full object-cover" onError={() => setFailedUrl(photo.url)} />
      : <span className="grid h-full place-items-center text-base text-inv-muted">{shelf.photoUpdatedAt ? (photo.isError || failedUrl ? '写真を表示できません' : '写真を読み込み中…') : '写真なし'}</span>}
  </div>;
}
