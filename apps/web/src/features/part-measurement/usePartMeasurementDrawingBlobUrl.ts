import { useEffect, useState } from 'react';

import { api } from '../../api/client';

/**
 * `/api/storage/...` の図面を x-client-key 付きで取得し、Blob URL を返す。
 * `<img src>` ではヘッダを付けられないためこの方式を使う。
 *
 * パス変更時は取得完了まで blobUrl を null にし、旧図面と新測定点の重なりを防ぐ。
 */
export function usePartMeasurementDrawingBlobUrl(drawingImageRelativePath: string | null | undefined): {
  blobUrl: string | null;
  error: string | null;
} {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!drawingImageRelativePath?.trim()) {
      setBlobUrl((prev) => {
        if (prev) revokePartMeasurementDrawingBlobUrl(prev);
        return null;
      });
      setError(null);
      return;
    }

    setBlobUrl((prev) => {
      if (prev) revokePartMeasurementDrawingBlobUrl(prev);
      return null;
    });
    setError(null);

    let objectUrl: string | null = null;
    let cancelled = false;

    const run = async () => {
      try {
        const path = drawingImageRelativePath.replace(/^\/api\//, '');
        const { data } = await api.get<Blob>(path, { responseType: 'blob' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setBlobUrl(objectUrl);
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
      if (objectUrl) {
        revokePartMeasurementDrawingBlobUrl(objectUrl);
      }
    };
  }, [drawingImageRelativePath]);

  return { blobUrl, error };
}

function revokePartMeasurementDrawingBlobUrl(url: string): void {
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}
