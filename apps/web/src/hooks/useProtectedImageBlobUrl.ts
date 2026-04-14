import { useEffect, useState } from 'react';

import { api } from '../api/client';

/**
 * `/api/storage/...` の保護画像を `x-client-key` 付きで取得し、Blob URL を返す。
 * `<img src>` ではヘッダを付けられないため、このフック経由で表示する。
 */
export function useProtectedImageBlobUrl(imagePath: string | null | undefined): {
  blobUrl: string | null;
  error: string | null;
} {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath?.trim()) {
      setBlobUrl(null);
      setError(null);
      return;
    }

    let revoked: string | null = null;
    let cancelled = false;

    const run = async () => {
      setError(null);
      try {
        const path = imagePath.replace(/^\/api\//, '');
        const { data } = await api.get<Blob>(path, { responseType: 'blob' });
        if (cancelled) return;
        const nextBlobUrl = URL.createObjectURL(data);
        revoked = nextBlobUrl;
        setBlobUrl(nextBlobUrl);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
          setError('画像の読み込みに失敗しました');
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
  }, [imagePath]);

  return { blobUrl, error };
}
