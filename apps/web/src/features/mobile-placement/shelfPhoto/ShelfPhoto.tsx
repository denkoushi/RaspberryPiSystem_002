import { useEffect, useLayoutEffect, useState } from 'react';

import { isNearViewport, observeNearViewport } from './shelfPhotoPriority';
import { useShelfPhoto } from './useShelfPhoto';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

const canObserve = () => typeof IntersectionObserver !== 'undefined';

export function ShelfPhoto({ shelf, className = '', fit = 'cover', label = shelf.shelfCodeRaw }: { shelf: RegisteredShelfEntryDto; className?: string; fit?: 'cover' | 'contain'; label?: string }) {
  const [element, setElement] = useState<Element | null>(null);
  const [near, setNear] = useState(() => !canObserve());
  useLayoutEffect(() => {
    if (!near && element && isNearViewport(element)) setNear(true);
  }, [near, element]);
  useEffect(() => {
    if (near || !element) return;
    return observeNearViewport(element, () => setNear(true));
  }, [near, element]);
  const photo = useShelfPhoto(shelf.shelfCodeRaw, shelf.photoUpdatedAt, near);
  return photo.url ? <img ref={setElement} src={photo.url} alt={`${label} の写真`} className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} ${className}`} />
    : <span ref={setElement} aria-label={`${label} 写真なし`} className={`grid place-items-center bg-[var(--hp-panel2)] p-1 text-center font-mono text-sm font-bold text-[var(--hp-shelf)] ${className}`}>{label}</span>;
}
