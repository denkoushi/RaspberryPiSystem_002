import { useEffect, useState } from 'react';

import { api } from '../../api/client';

/**
 * `/api/storage/...` の図面を x-client-key 付きで取得し、Blob URL を返す。
 * `<img src>` ではヘッダを付けられないためこの方式を使う。
 */
export function usePartMeasurementDrawingBlobUrl(drawingImageRelativePath: string | null | undefined): {
  blobUrl: string | null;
  error: string | null;
} {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!drawingImageRelativePath?.trim()) {
      setBlobUrl(null);
      setError(null);
      return;
    }

    let revoked: string | null = null;
    let cancelled = false;

    const run = async () => {
      setError(null);
      try {
        const path = drawingImageRelativePath.replace(/^\/api\//, '');
        const { data } = await api.get<Blob>(path, { responseType: 'blob' });
        if (cancelled) return;
        const url = URL.createObjectURL(data);
        revoked = url;
        setBlobUrl(url);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
          setError('図面の読み込みに失敗しました');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [drawingImageRelativePath]);

  return { blobUrl, error };
}
