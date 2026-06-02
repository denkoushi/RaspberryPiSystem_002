import {
  PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES,
  PART_MEASUREMENT_PDF_INPUT_MAX_BYTES
} from './part-measurement-drawing-import.constants.js';

export type DrawingUploadKind = 'image' | 'pdf';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export function resolveDrawingMime(mimetype: string, filename: string): string | null {
  let mime = (mimetype ?? '').trim().toLowerCase();
  const lower = (filename ?? '').trim().toLowerCase();

  if (!mime || mime === 'application/octet-stream') {
    if (lower.endsWith('.png')) mime = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
    else if (lower.endsWith('.webp')) mime = 'image/webp';
    else if (lower.endsWith('.pdf')) mime = 'application/pdf';
    else return null;
  }

  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (IMAGE_MIMES.has(mime) || mime === 'application/pdf') return mime;
  return null;
}

export function classifyDrawingUpload(mimetype: string, filename: string): DrawingUploadKind | null {
  const mime = resolveDrawingMime(mimetype, filename);
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  return 'image';
}

export function getDrawingInputMaxBytes(kind: DrawingUploadKind): number {
  return kind === 'pdf' ? PART_MEASUREMENT_PDF_INPUT_MAX_BYTES : PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES;
}

export function getDrawingInputTooLargeMessage(kind: DrawingUploadKind): string {
  return kind === 'pdf' ? 'PDF ファイルが大きすぎます' : '図面画像が大きすぎます';
}

export function assertPdfMagic(buffer: Buffer): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('PDF_MAGIC_MISMATCH');
  }
}
