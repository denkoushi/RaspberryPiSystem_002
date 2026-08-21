import type { DocumentTextExtractorPort } from '../kiosk-documents/ports/document-text-extractor.port.js';
import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';

export type AssemblyProcedureTextCandidateBounds = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AssemblyProcedureTextCandidate = {
  text: string;
  confidence: number | null;
  bounds: AssemblyProcedureTextCandidateBounds | null;
  pageIndex: number | null;
  source: 'coordinate-ocr' | 'poppler' | 'none';
};

export type AssemblyProcedureTextCandidateInput = {
  imageBytes?: Buffer;
  imageMimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Immutable PDF path supplied by the service for Poppler-first extraction. */
  pdfPath?: string;
  pageIndex?: number;
  /** Bounds of the selected source-page ROI. Candidate bounds are ROI-local. */
  roi?: AssemblyProcedureTextCandidateBounds;
  /** Compatibility spelling for callers that model the selection as a bbox. */
  bbox?: AssemblyProcedureTextCandidateBounds;
};

export type AssemblyProcedurePdfTextCandidateInput = Pick<
  AssemblyProcedureTextCandidateInput,
  'pdfPath' | 'pageIndex' | 'roi' | 'bbox'
> & {
  pdfPath: string;
  pageIndex: number;
};

/**
 * Candidate extraction is best-effort. An empty list means the editor should
 * offer manual text entry; it is not an import failure.
 */
export interface AssemblyProcedureTextCandidatePort {
  extractCandidates(
    input: AssemblyProcedureTextCandidateInput,
  ): Promise<AssemblyProcedureTextCandidate[]>;
}

/**
 * Dedicated PDF boundary for adapters that can expose coordinate candidates.
 * The generic text-candidate port remains the composition boundary used by
 * the editor service, so existing OCR adapters do not need to know about PDF.
 */
export interface AssemblyProcedurePdfTextCandidatePort {
  extractPdfCandidates(
    input: AssemblyProcedurePdfTextCandidateInput,
  ): Promise<AssemblyProcedureTextCandidate[]>;
}

/** Stable dependency aliases for composition roots that already own these ports. */
export type AssemblyProcedureCoordinateOcrPort = ImageOcrLayoutPort;
export type AssemblyProcedurePdfTextPort = DocumentTextExtractorPort;
export type PdfTextCandidatePort = AssemblyProcedurePdfTextCandidatePort;
export type PopplerTextCandidatePort = AssemblyProcedurePdfTextCandidatePort;
