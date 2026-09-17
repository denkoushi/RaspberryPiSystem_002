import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { Dialog } from '../ui/Dialog';

type InventoryPhotoDialogProps = {
  photoUrl: string | null;
  alt: string;
  onClose: () => void;
};

export function InventoryPhotoDialog({ photoUrl, alt, onClose }: InventoryPhotoDialogProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImageUrl(null);
    setError(false);
    if (!photoUrl) return undefined;

    void api.get(photoUrl.replace(/^\/api/, ''), { responseType: 'blob' }).then((response) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(response.data);
      setImageUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setError(true);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoUrl]);

  return (
    <Dialog isOpen={Boolean(photoUrl)} onClose={onClose} ariaLabel="在庫写真" size="full" className="bg-slate-950 p-3">
      <div className="flex min-h-[70vh] items-center justify-center">
        {imageUrl ? <img src={imageUrl} alt={alt} className="max-h-[calc(100dvh-5rem)] max-w-full rounded object-contain" /> : null}
        {!imageUrl && !error ? <p className="text-white/75" role="status">画像を読み込み中…</p> : null}
        {error ? <p className="text-red-200" role="alert">画像の取得に失敗しました</p> : null}
      </div>
      <button type="button" className="mt-3 min-h-10 rounded border border-white/30 px-4 text-white hover:bg-white/10" onClick={onClose}>閉じる</button>
    </Dialog>
  );
}
