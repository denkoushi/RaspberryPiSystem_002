import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getMobilePlacementShelfPhoto } from '../../../api/client';

import { enqueueBackgroundShelfPhoto } from './shelfPhotoPriority';

function shelfPhotoQueryOptions(shelfCodeRaw: string, photoUpdatedAt?: string | null) {
  return {
    queryKey: ['mobile-placement', 'shelf-photo', shelfCodeRaw, photoUpdatedAt],
    queryFn: () => getMobilePlacementShelfPhoto(shelfCodeRaw, photoUpdatedAt!),
    staleTime: Infinity,
    // Same as the useQuery default; prefetchQuery would otherwise not retry background photos.
    retry: 3
  };
}

/** `active: false` defers the fetch to the idle background queue and skips the object URL until the tile becomes active. */
export function useShelfPhoto(shelfCodeRaw: string, photoUpdatedAt?: string | null, active = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...shelfPhotoQueryOptions(shelfCodeRaw, photoUpdatedAt),
    enabled: Boolean(photoUpdatedAt) && active
  });
  useEffect(() => {
    if (active || !photoUpdatedAt) return;
    return enqueueBackgroundShelfPhoto(() => queryClient.prefetchQuery(shelfPhotoQueryOptions(shelfCodeRaw, photoUpdatedAt)));
  }, [active, queryClient, shelfCodeRaw, photoUpdatedAt]);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!active || !query.data) return;
    const url = URL.createObjectURL(query.data);
    setImage({ blob: query.data, url });
    return () => URL.revokeObjectURL(url);
  }, [query.data, active]);
  return { url: active && image?.blob === query.data ? image?.url : undefined, isError: query.isError, refetch: query.refetch };
}
