import type {
  AssemblyProcedureTextCandidate,
  AssemblyProcedureTextCandidateInput,
  AssemblyProcedureTextCandidatePort,
} from './assembly-procedure-text-candidate.port.js';

/**
 * Prefers coordinate-aware extraction from the immutable PDF when one is
 * supplied, and only invokes image OCR when Poppler has no usable result.
 * This keeps Pi4 devices from doing OCR for ordinary text PDFs and avoids
 * returning duplicate candidates from both engines.
 */
export class CompositeTextCandidateAdapter implements AssemblyProcedureTextCandidatePort {
  constructor(
    private readonly coordinateOcr: AssemblyProcedureTextCandidatePort,
    private readonly poppler: AssemblyProcedureTextCandidatePort,
  ) {}

  async extractCandidates(
    input: AssemblyProcedureTextCandidateInput,
  ): Promise<AssemblyProcedureTextCandidate[]> {
    if (input.pdfPath?.trim()) {
      const poppler = await this.poppler.extractCandidates(input).catch(() => []);
      if (poppler.length > 0) return poppler;
    }
    return this.coordinateOcr.extractCandidates(input).catch(() => []);
  }
}
