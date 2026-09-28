import { useState } from 'react';

import { inventoryThumbnailUrl, type InventoryPhoto } from '../../../api/client';
import { useInventoryFullPhoto } from '../../../components/kiosk/useInventoryFullPhoto';

type Props = {
  photos: InventoryPhoto[];
};

/**
 * Large photo area for the daily screen. The chosen photo fills most of the pane; tapping it
 * enlarges it to the whole pane (never over the information pane), and tapping again returns.
 */
export function InventoryPhotoPane({ photos }: Props) {
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const photo = photos[Math.min(index, photos.length - 1)] ?? null;
  const { imageUrl } = useInventoryFullPhoto(photo?.photoUrl ?? null);

  if (!photo) {
    return <div className="flex h-full min-h-64 items-center justify-center rounded-lg bg-slate-950/50 text-xl text-white/40">写真なし</div>;
  }

  // Show the thumbnail until the full-size photo arrives, so the pane is never empty.
  const src = imageUrl ?? inventoryThumbnailUrl(photo.photoUrl);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" aria-label="品物写真">
      <button
        type="button"
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-slate-950/60 focus:outline-none focus:ring-2 focus:ring-sky-300"
        aria-label={zoomed ? '写真を元の大きさに戻す' : '写真を拡大'}
        aria-pressed={zoomed}
        onClick={() => setZoomed((current) => !current)}
      >
        <img src={src} alt={photo.originalFilename} className="h-full w-full object-contain" />
      </button>
      {!zoomed && photos.length > 1 ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto">
          {photos.map((entry, entryIndex) => (
            <button
              key={entry.id}
              type="button"
              aria-label={`写真${entryIndex + 1}を表示`}
              aria-pressed={entry.id === photo.id}
              className={`shrink-0 rounded border-2 ${entry.id === photo.id ? 'border-sky-400' : 'border-transparent'}`}
              onClick={() => setIndex(entryIndex)}
            >
              <img src={inventoryThumbnailUrl(entry.photoUrl)} alt="" className="h-24 w-24 rounded object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
