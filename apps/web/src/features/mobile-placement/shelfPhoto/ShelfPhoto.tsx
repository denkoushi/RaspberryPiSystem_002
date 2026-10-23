import { useShelfPhoto } from './useShelfPhoto';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

export function ShelfPhoto({ shelf, className = '', fit = 'cover' }: { shelf: RegisteredShelfEntryDto; className?: string; fit?: 'cover' | 'contain' }) {
  const photo = useShelfPhoto(shelf.shelfCodeRaw, shelf.photoUpdatedAt);
  return photo.url ? <img src={photo.url} alt={`${shelf.shelfCodeRaw} の写真`} className={`${fit === 'contain' ? 'object-contain' : 'object-cover'} ${className}`} />
    : <span aria-label={`${shelf.shelfCodeRaw} 写真なし`} className={`grid place-items-center bg-[var(--hp-panel2)] p-1 text-center font-mono text-sm font-bold text-[var(--hp-shelf)] ${className}`}>{shelf.shelfCodeRaw}</span>;
}
