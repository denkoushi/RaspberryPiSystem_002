import sharp from 'sharp';

import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';
import type {
  TextCandidate,
  TextCandidateInput,
  TextCandidatePort
} from './text-candidate.port.js';

function ratio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, value / total));
}

/** Reuses the coordinate OCR port without coupling it to a document domain. */
export class CoordinateOcrTextCandidateAdapter implements TextCandidatePort {
  constructor(private readonly layoutOcr: ImageOcrLayoutPort) {}

  async extractCandidates(input: TextCandidateInput): Promise<TextCandidate[]> {
    if (!input.imageBytes?.length) return [];
    try {
      const metadata = await sharp(input.imageBytes, { failOn: 'none' }).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0) return [];
      const ocr = await this.layoutOcr.runLayoutOcrOnImage({
        imageBytes: input.imageBytes,
        mimeType: input.imageMimeType ?? 'image/jpeg'
      });
      return ocr.words
        .map((word) => {
          const text = word.text.trim();
          const x0 = Math.min(word.bbox.x0, word.bbox.x1);
          const y0 = Math.min(word.bbox.y0, word.bbox.y1);
          const x1 = Math.max(word.bbox.x0, word.bbox.x1);
          const y1 = Math.max(word.bbox.y0, word.bbox.y1);
          if (!text || x1 <= x0 || y1 <= y0) return null;
          const candidate: TextCandidate = {
            text,
            confidence: word.confidence,
            bounds: {
              xRatio: ratio(x0, width),
              yRatio: ratio(y0, height),
              widthRatio: ratio(x1 - x0, width),
              heightRatio: ratio(y1 - y0, height)
            },
            pageIndex: input.pageIndex ?? null,
            source: 'coordinate-ocr'
          };
          return candidate;
        })
        .filter((candidate): candidate is TextCandidate => candidate !== null);
    } catch {
      return [];
    }
  }
}
