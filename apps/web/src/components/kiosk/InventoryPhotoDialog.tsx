import { Dialog } from '../ui/Dialog';

import { useInventoryFullPhoto } from './useInventoryFullPhoto';

type InventoryPhotoDialogProps = {
  photoUrl: string | null;
  alt: string;
  onClose: () => void;
};

export function InventoryPhotoDialog({ photoUrl, alt, onClose }: InventoryPhotoDialogProps) {
  const { imageUrl, error } = useInventoryFullPhoto(photoUrl);

  return (
    <Dialog isOpen={Boolean(photoUrl)} onClose={onClose} ariaLabel="在庫写真" size="full" className="bg-slate-950 p-3">
      <div className="flex min-h-[70vh] items-center justify-center">
        {/* Tapping the enlarged photo returns to the previous screen. */}
        {imageUrl ? (
          <button type="button" className="block" aria-label="写真を閉じる" onClick={onClose}>
            <img src={imageUrl} alt={alt} className="max-h-[calc(100dvh-5rem)] max-w-full rounded object-contain" />
          </button>
        ) : null}
        {!imageUrl && !error ? <p className="text-white/75" role="status">画像を読み込み中…</p> : null}
        {error ? <p className="text-red-200" role="alert">画像の取得に失敗しました</p> : null}
      </div>
      <button type="button" className="mt-3 min-h-10 rounded border border-white/30 px-4 text-white hover:bg-white/10" onClick={onClose}>閉じる</button>
    </Dialog>
  );
}
