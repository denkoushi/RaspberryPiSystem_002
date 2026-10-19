import { useEffect, useRef, useState } from 'react';

import { useProtectedImageBlobUrl } from '../../../hooks/useProtectedImageBlobUrl';

function ManualThumbnailImage({ url }: { url: string }) {
  const { blobUrl } = useProtectedImageBlobUrl(url);
  return blobUrl ? <img src={blobUrl} alt="1ページ目" className="h-full w-full object-contain" /> : null;
}

export function ManualThumbnail({ url }: { url: string | null }) {
  const thumbnailRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (requested || !url) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    if (thumbnailRef.current) observer.observe(thumbnailRef.current);
    return () => observer.disconnect();
  }, [requested, url]);
  return <div ref={thumbnailRef} className="h-[26px] w-9 overflow-hidden rounded-[3px] border border-[#777] bg-white">
    {requested && url ? <ManualThumbnailImage url={url} /> : null}
  </div>;
}

