export type ShelfPhotoData = { contentType: 'image/jpeg'; dataBase64: string };

export type ShelfPhotoOrientation = { portrait: boolean; angle?: number };

// Keep orientation decisions and drawing geometry independent of browser state.
export function shelfPhotoDrawPlan(width: number, height: number, orientation?: ShelfPhotoOrientation) {
  const mismatch = orientation && width !== height && (height > width) !== orientation.portrait;
  const rotation = mismatch ? (orientation.angle === 270 ? Math.PI / 2 : -Math.PI / 2) : 0;
  const scale = Math.min(1, 800 / Math.max(width, height));
  const drawWidth = Math.max(1, Math.round(width * scale));
  const drawHeight = Math.max(1, Math.round(height * scale));
  return {
    width: rotation ? drawHeight : drawWidth,
    height: rotation ? drawWidth : drawHeight,
    drawWidth, drawHeight, rotation,
    translateX: rotation > 0 ? drawHeight : 0,
    translateY: rotation < 0 ? drawWidth : 0
  };
}

export function encodeShelfPhoto(source: CanvasImageSource, width: number, height: number, orientation?: ShelfPhotoOrientation): ShelfPhotoData {
  if (!width || !height) throw new Error('写真を処理できませんでした');
  const plan = shelfPhotoDrawPlan(width, height, orientation);
  const canvas = document.createElement('canvas');
  try {
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('写真を処理できませんでした');
    if (plan.rotation) {
      ctx.translate(plan.translateX, plan.translateY);
      ctx.rotate(plan.rotation);
    }
    ctx.drawImage(source, 0, 0, plan.drawWidth, plan.drawHeight);
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
