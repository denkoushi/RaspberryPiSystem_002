import type { DocumentTextExtractorPort } from '../kiosk-documents/ports/document-text-extractor.port.js';
import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';

export type TextCandidateBounds = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type TextCandidate = {
  text: string;
  confidence: number | null;
  bounds: TextCandidateBounds | null;
  pageIndex: number | null;
  source: 'coordinate-ocr' | 'poppler' | 'none';
};

export type TextCandidateInput = {
  imageBytes?: Buffer;
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Immutable PDF path supplied by the service for Poppler-first extraction. */
  pdfPath?: string;
  pageIndex?: number;
  /** Bounds of the selected source-page ROI. Candidate bounds are ROI-local. */
  roi?: TextCandidateBounds;
  /** Compatibility spelling for callers that model the selection as a bbox. */
  bbox?: TextCandidateBounds;
};

export type PdfTextCandidateInput = Pick<
  TextCandidateInput,
  'pdfPath' | 'pageIndex' | 'roi' | 'bbox'
> & {
  pdfPath: string;
  pageIndex: number;
};

/**
 * Candidate extraction is best-effort. An empty list means the editor should
 * offer manual text entry; it is not an import failure.
 */
export interface TextCandidatePort {
  extractCandidates(input: TextCandidateInput): Promise<TextCandidate[]>;
}

/**
 * Dedicated PDF boundary for adapters that can expose coordinate candidates.
 * The generic text-candidate port remains the composition boundary used by an
 * editor service, so existing OCR adapters do not need to know about PDF.
 */
export interface PdfTextCandidatePort {
  extractPdfCandidates(input: PdfTextCandidateInput): Promise<TextCandidate[]>;
}

/** Stable aliases for composition roots that already own these dependencies. */
export type CoordinateOcrPort = ImageOcrLayoutPort;
export type PdfTextPort = DocumentTextExtractorPort;
