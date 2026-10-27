export type ShelfPhotoData = { contentType: 'image/jpeg'; dataBase64: string };

export function encodeShelfPhoto(source: CanvasImageSource, width: number, height: number): ShelfPhotoData {
  if (!width || !height) throw new Error('写真を処理できませんでした');
  const scale = Math.min(1, 800 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  try {
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('写真を処理できませんでした');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { contentType: 'image/jpeg', dataBase64: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function resizeShelfPhoto(file: File): Promise<ShelfPhotoData> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      // Specify one dimension to preserve the EXIF-oriented aspect ratio without a full-size Image.
      bitmap = await createImageBitmap(file, { resizeWidth: 800, resizeQuality: 'high', imageOrientation: 'from-image' });
    } catch {
      // Older browsers and unsupported image formats use the Image path below.
    }
    if (bitmap) {
      try { return encodeShelfPhoto(bitmap, bitmap.width, bitmap.height); }
      finally { bitmap.close(); }
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('写真を読み込めませんでした'));
      image.src = url;
    });
    return encodeShelfPhoto(image, image.naturalWidth, image.naturalHeight);
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
