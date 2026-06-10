import {
  PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES,
  PART_MEASUREMENT_PDF_INPUT_MAX_BYTES,
  PART_MEASUREMENT_TIFF_INPUT_MAX_BYTES
} from './part-measurement-drawing-import.constants.js';

export type DrawingUploadKind = 'image' | 'pdf' | 'tiff';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const TIFF_MIMES = new Set(['image/tiff', 'image/tif', 'image/x-tiff']);

function isTiffExtension(lowerFilename: string): boolean {
  return lowerFilename.endsWith('.tif') || lowerFilename.endsWith('.tiff');
}

export function isTiffMime(mime: string): boolean {
  return TIFF_MIMES.has(mime.trim().toLowerCase());
}

export function assertTiffMagic(buffer: Buffer): void {
  if (buffer.length < 4) {
    throw new Error('TIFF_MAGIC_MISMATCH');
  }
  const le = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
  const be = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
  if (!le && !be) {
    throw new Error('TIFF_MAGIC_MISMATCH');
  }
}

export function resolveDrawingMime(mimetype: string, filename: string): string | null {
  let mime = (mimetype ?? '').trim().toLowerCase();
  const lower = (filename ?? '').trim().toLowerCase();

  if (!mime || mime === 'application/octet-stream') {
    if (lower.endsWith('.png')) mime = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
    else if (lower.endsWith('.webp')) mime = 'image/webp';
    else if (lower.endsWith('.pdf')) mime = 'application/pdf';
    else if (isTiffExtension(lower)) mime = 'image/tiff';
    else return null;
  }

  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (IMAGE_MIMES.has(mime) || mime === 'application/pdf' || isTiffMime(mime)) return mime;
  return null;
}

export function classifyDrawingUpload(mimetype: string, filename: string): DrawingUploadKind | null {
  const mime = resolveDrawingMime(mimetype, filename);
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  if (isTiffMime(mime)) return 'tiff';
  return 'image';
}

export function getDrawingInputMaxBytes(kind: DrawingUploadKind): number {
  if (kind === 'pdf') return PART_MEASUREMENT_PDF_INPUT_MAX_BYTES;
  if (kind === 'tiff') return PART_MEASUREMENT_TIFF_INPUT_MAX_BYTES;
  return PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES;
}

export function getDrawingInputTooLargeMessage(kind: DrawingUploadKind): string {
  if (kind === 'pdf') return 'PDF ファイルが大きすぎます';
  if (kind === 'tiff') return 'TIFF ファイルが大きすぎます';
  return '図面画像が大きすぎます';
}

export function assertPdfMagic(buffer: Buffer): void {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('PDF_MAGIC_MISMATCH');
  }
}
