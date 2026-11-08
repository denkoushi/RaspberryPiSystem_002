import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  path: string | null | undefined;
  fallback?: ReactNode;
  refreshIntervalMs?: number;
};

export function ProtectedImage({ path, fallback = null, refreshIntervalMs, loading, onError, ...props }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(loading !== 'lazy' || typeof IntersectionObserver === 'undefined');
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { blobUrl, error } = useProtectedImageBlobUrl(visible ? path : null, refreshIntervalMs);

  useEffect(() => {
    if (visible || !imageRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [visible]);

  if (error || (blobUrl && failedUrl === blobUrl)) return <>{fallback}</>;
  // Keep the image's dimensions while waiting for lazy images to enter the viewport.
  return (
    <img
      {...props}
      ref={imageRef}
      loading={loading}
      src={blobUrl ?? undefined}
      style={{ ...props.style, ...(!blobUrl ? { visibility: 'hidden' } : {}) }}
      onError={(event) => {
        setFailedUrl(blobUrl);
        onError?.(event);
      }}
    />
  );
}
