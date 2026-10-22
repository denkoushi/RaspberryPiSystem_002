import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getMobilePlacementShelfPhoto } from '../../../api/client';

export function useShelfPhoto(shelfCodeRaw: string, photoUpdatedAt?: string | null) {
  const query = useQuery({
    queryKey: ['mobile-placement', 'shelf-photo', shelfCodeRaw, photoUpdatedAt],
    queryFn: () => getMobilePlacementShelfPhoto(shelfCodeRaw, photoUpdatedAt!),
    enabled: Boolean(photoUpdatedAt),
    staleTime: Infinity
  });
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const url = URL.createObjectURL(query.data);
    setImage({ blob: query.data, url });
    return () => URL.revokeObjectURL(url);
  }, [query.data]);
  return { url: image?.blob === query.data ? image?.url : undefined, isError: query.isError, refetch: query.refetch };
}
