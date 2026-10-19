import { useSyncExternalStore } from 'react';

const query = '(max-width: 767px)';
const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const getSnapshot = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

export function useIsPhoneViewport() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
