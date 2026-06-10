/** 部品測定・検査図面: サーバー preview 変換が必要なファイルか（PDF / TIFF） */
export function isPartMeasurementDrawingPreviewConversionFile(file: File): boolean {
  return isPartMeasurementDrawingPdfFile(file) || isPartMeasurementDrawingTiffFile(file);
}

/** 選択ファイルが PDF かどうか（MIME または拡張子） */
export function isPartMeasurementDrawingPdfFile(file: File): boolean {
  const mime = (file.type ?? '').trim().toLowerCase();
  if (mime === 'application/pdf') return true;
  return file.name.trim().toLowerCase().endsWith('.pdf');
}

/** 選択ファイルが TIFF/TIF かどうか（MIME または拡張子） */
export function isPartMeasurementDrawingTiffFile(file: File): boolean {
  const mime = (file.type ?? '').trim().toLowerCase();
  if (mime === 'image/tiff' || mime === 'image/tif' || mime === 'image/x-tiff') return true;
  const lower = file.name.trim().toLowerCase();
  return lower.endsWith('.tif') || lower.endsWith('.tiff');
}

/** preview 変換中の表示文言 */
export function partMeasurementDrawingPreviewConvertingLabel(file: File | null): string {
  if (file && isPartMeasurementDrawingTiffFile(file)) {
    return 'TIFF を変換中…';
  }
  return 'PDF を変換中…';
}

/** preview 変換結果を保存用 JPEG File に変換 */
export function partMeasurementDrawingPreviewJpegFile(
  jpegBlob: Blob,
  originalName: string
): File {
  const baseName =
    originalName.replace(/\.(pdf|tiff?)$/i, '') || 'drawing';
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
