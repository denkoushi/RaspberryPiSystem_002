import { useCallback, useSyncExternalStore } from 'react';

const readMediaQuery = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const media = window.matchMedia(query);
      media.addEventListener?.('change', onChange);
      return () => media.removeEventListener?.('change', onChange);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => readMediaQuery(query), () => false);
}
