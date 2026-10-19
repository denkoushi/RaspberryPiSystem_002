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
    return <div className="flex h-full min-h-64 items-center justify-center rounded-[18px] border border-inv-line bg-inv-s1 text-xl text-inv-faint">写真なし</div>;
  }

  // Show the thumbnail until the full-size photo arrives, so the pane is never empty.
  const src = imageUrl ?? inventoryThumbnailUrl(photo.photoUrl);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5" aria-label="品物写真">
      {photos.length > 1 ? <button
        type="button"
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[18px] border border-inv-line bg-inv-s1 focus:outline-none focus-visible:border-inv-cyan"
        aria-label={zoomed ? '写真を元の大きさに戻す' : '写真を拡大'}
        aria-pressed={zoomed}
        onClick={() => setZoomed((current) => !current)}
      >
        <img src={src} alt={photo.originalFilename} className="h-full w-full object-contain" />
      </button> : <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[18px] border border-inv-line bg-inv-s1"><img src={src} alt={photo.originalFilename} className="h-full w-full object-contain" /></div>}
      {!zoomed && photos.length > 1 ? (
        <div className="flex shrink-0 gap-3 overflow-x-auto">
          {photos.map((entry, entryIndex) => (
            <button
              key={entry.id}
              type="button"
              aria-label={`写真${entryIndex + 1}を表示`}
              aria-pressed={entry.id === photo.id}
              className={`shrink-0 overflow-hidden rounded-xl border-2 ${entry.id === photo.id ? 'border-inv-cyan' : 'border-inv-line'}`}
              onClick={() => setIndex(entryIndex)}
            >
              <img src={inventoryThumbnailUrl(entry.photoUrl)} alt="" className="h-[150px] w-[200px] object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
