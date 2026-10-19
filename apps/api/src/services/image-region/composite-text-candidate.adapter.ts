import type {
  TextCandidate,
  TextCandidateInput,
  TextCandidatePort
} from './text-candidate.port.js';

/**
 * Prefers coordinate-aware extraction from an immutable PDF when one is
 * supplied, and only invokes image OCR when Poppler has no usable result.
 * This avoids duplicate candidates from both engines.
 */
export class CompositeTextCandidateAdapter implements TextCandidatePort {
  constructor(
    private readonly coordinateOcr: TextCandidatePort,
    private readonly poppler: TextCandidatePort
  ) {}

  async extractCandidates(input: TextCandidateInput): Promise<TextCandidate[]> {
    if (input.pdfPath?.trim()) {
      const poppler = await this.poppler.extractCandidates(input).catch(() => []);
      if (poppler.length > 0) return poppler;
    }
    return this.coordinateOcr.extractCandidates(input).catch(() => []);
  }
}
