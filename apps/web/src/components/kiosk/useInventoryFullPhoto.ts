import { useEffect, useState } from 'react';

import { api } from '../../api/client';

/** Loads a full-size inventory photo through the authenticated API as an object URL. */
export function useInventoryFullPhoto(photoUrl: string | null): { imageUrl: string | null; error: boolean } {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImageUrl(null);
    setError(false);
    if (!photoUrl) return undefined;

    Promise.resolve()
      .then(() => api.get(photoUrl.replace(/^\/api/, ''), { responseType: 'blob' }))
      .then((response) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(response.data);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoUrl]);

  return { imageUrl, error };
}
