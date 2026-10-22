export async function resizeShelfPhoto(file: File): Promise<{ contentType: 'image/jpeg'; dataBase64: string }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('写真を読み込めませんでした'));
      image.src = url;
    });
    const scale = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('写真を処理できませんでした');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { contentType: 'image/jpeg', dataBase64: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
