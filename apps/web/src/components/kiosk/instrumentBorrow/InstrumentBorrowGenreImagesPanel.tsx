import { ProtectedImage } from '../../ProtectedImage';

export type InstrumentBorrowGenreImagesPanelProps = {
  imageUrls: string[];
};

/**
 * ジャンル点検画像を縦に分割し、利用可能な高さいっぱいに伸ばす（flex 1:1）
 */
export function InstrumentBorrowGenreImagesPanel({ imageUrls }: InstrumentBorrowGenreImagesPanelProps) {
  if (imageUrls.length === 0) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {imageUrls.map((url, index) => (
        <div
          key={`${url}-${index}`}
          className="flex min-h-0 flex-1 basis-0 flex-col rounded-md border-2 border-slate-300 bg-white p-2"
        >
          <ProtectedImage
            imagePath={url}
            alt={`計測機器ジャンル点検画像 ${index + 1}`}
            className="h-full min-h-0 w-full object-contain"
          />
        </div>
      ))}
    </div>
  );
}
