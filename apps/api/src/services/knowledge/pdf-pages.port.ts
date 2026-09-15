export interface PdfPagesPort {
  /** Sequential pages bound memory; callers must consume all pages before marking import complete. */
  extract(pdf: Buffer, signal?: AbortSignal): AsyncIterable<{ pageNumber: number; text: string; jpeg: Buffer }>;
}
