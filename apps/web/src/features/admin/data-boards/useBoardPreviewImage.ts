import { useEffect, useState } from 'react';

import { getSignageCsvDashboardPreviewImage } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { api } from '../../../api/http';

import type { BoardSelection } from './boardModel';

/** 選択中のボードを「サイネージに映るのと同じ描画」で取得する */
export function useBoardPreviewImage(selection: BoardSelection | null, refreshToken: number) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const type = selection?.type ?? null;
  const id = selection?.id ?? null;

  useEffect(() => {
    setImageUrl(null);
    setError(null);
    if (!type || !id) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setIsLoading(true);
    const request =
      type === 'table'
        ? getSignageCsvDashboardPreviewImage(id)
        : api.get<Blob>(`/signage/visualization-image/${id}`, { responseType: 'blob' }).then((response) => response.data);
    request
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err, 'プレビューを取得できませんでした'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [type, id, refreshToken]);

  return { imageUrl, error, isLoading };
}
