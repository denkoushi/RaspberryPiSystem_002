/** 選択ファイルが PDF かどうか（MIME または拡張子） */
export function isPartMeasurementDrawingPdfFile(file: File): boolean {
  const mime = (file.type ?? '').trim().toLowerCase();
  if (mime === 'application/pdf') return true;
  return file.name.trim().toLowerCase().endsWith('.pdf');
}

/** PDF プレビュー変換結果を保存用 JPEG File に変換 */
export function partMeasurementDrawingPreviewJpegFile(
  jpegBlob: Blob,
  originalPdfName: string
): File {
  const baseName = originalPdfName.replace(/\.pdf$/i, '') || 'drawing';
  return new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
}

function revokeBlobUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

export function revokePartMeasurementDrawingPreviewUrl(url: string | null | undefined): void {
  revokeBlobUrl(url);
}
