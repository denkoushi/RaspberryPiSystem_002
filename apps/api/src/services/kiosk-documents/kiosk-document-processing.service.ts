import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { normalizeDocumentText } from './kiosk-document-text-normalizer.js';
import type { KioskDocumentRepositoryPort } from './ports/kiosk-document-repository.port.js';
import type { DocumentTextExtractorPort } from './ports/document-text-extractor.port.js';
import type { MetadataLabelerPort } from './ports/metadata-labeler.port.js';
import type { OcrEnginePort } from './ports/ocr-engine.port.js';
import type { DocumentSearchIndexerPort } from './ports/document-search-indexer.port.js';

const OCR_HIGH_CONFIDENCE_THRESHOLD = 0.95;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.KIOSK_DOCUMENT_PROCESS_TIMEOUT_MS || '180000', 10);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ApiError(500, 'OCR処理がタイムアウトしました', undefined, 'KIOSK_DOC_OCR_TIMEOUT')), timeoutMs);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class KioskDocumentProcessingService {
  constructor(
    private readonly repo: KioskDocumentRepositoryPort,
    private readonly textExtractor: DocumentTextExtractorPort,
    private readonly ocrEngine: OcrEnginePort,
    private readonly labeler: MetadataLabelerPort,
    private readonly indexer: DocumentSearchIndexerPort
  ) {}

  async processDocumentById(
    documentId: string,
    options?: { maxRetry?: number; timeoutMs?: number }
  ): Promise<void> {
    const maxRetry = options?.maxRetry ?? 1;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const document = await this.repo.findById(documentId);
    if (!document) {
      throw new ApiError(404, '要領書が見つかりません', undefined, 'KIOSK_DOC_NOT_FOUND');
    }

    await this.repo.update(documentId, {
      ocrStatus: 'PROCESSING',
      ocrStartedAt: new Date(),
      ocrFinishedAt: null,
      ocrFailureReason: null,
    });

    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt <= maxRetry) {
      attempt += 1;
      try {
        const extracted = await withTimeout(this.textExtractor.extractText(document.filePath), timeoutMs);
        let mergedText = extracted.text ?? '';
        let ocrEngine = 'pdftotext';

        if (mergedText.trim().length === 0) {
          // OCR 実装側がページ単位で child process timeout を管理する。
          const ocr = await this.ocrEngine.runOcr(document.filePath);
          mergedText = ocr.text;
          ocrEngine = ocr.engine;
        }

        const normalizedText = normalizeDocumentText(mergedText);
        const labels = await this.labeler.labelFromText(normalizedText);
        const canAutoConfirm = (score?: number) => typeof score === 'number' && score >= OCR_HIGH_CONFIDENCE_THRESHOLD;

        const previous = await this.repo.findById(documentId);
        await this.repo.update(documentId, {
          extractedText: mergedText,
          ocrEngine,
          ocrStatus: 'COMPLETED',
          ocrFinishedAt: new Date(),
          ocrRetryCount: Math.max(0, attempt - 1),
          ocrFailureReason: null,
          candidateFhincd: labels.candidates.fhincd ?? null,
          candidateDrawingNumber: labels.candidates.drawingNumber ?? null,
          candidateProcessName: labels.candidates.processName ?? null,
          candidateResourceCd: labels.candidates.resourceCd ?? null,
          confidenceFhincd: labels.confidence.fhincd ?? null,
          confidenceDrawingNumber: labels.confidence.drawingNumber ?? null,
          confidenceProcessName: labels.confidence.processName ?? null,
          confidenceResourceCd: labels.confidence.resourceCd ?? null,
          documentCategory: labels.candidates.documentCategory ?? null,
          displayTitle: previous?.displayTitle || labels.suggestedDisplayTitle || previous?.title || null,
          confirmedFhincd: previous?.confirmedFhincd ?? (canAutoConfirm(labels.confidence.fhincd) ? labels.candidates.fhincd ?? null : null),
          confirmedDrawingNumber: previous?.confirmedDrawingNumber ?? (canAutoConfirm(labels.confidence.drawingNumber) ? labels.candidates.drawingNumber ?? null : null),
          confirmedProcessName: previous?.confirmedProcessName ?? (canAutoConfirm(labels.confidence.processName) ? labels.candidates.processName ?? null : null),
          confirmedResourceCd: previous?.confirmedResourceCd ?? (canAutoConfirm(labels.confidence.resourceCd) ? labels.candidates.resourceCd ?? null : null),
        });

        await this.indexer.refreshDocumentIndex(documentId);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          { err: error, documentId, attempt, maxRetry },
          '[KioskDocumentProcessing] processing attempt failed'
        );
      }
    }

    await this.repo.update(documentId, {
      ocrStatus: 'FAILED',
      ocrFinishedAt: new Date(),
      ocrRetryCount: Math.max(0, attempt - 1),
      ocrFailureReason: lastError?.message ?? 'unknown',
    });
    throw lastError ?? new ApiError(500, 'OCR処理に失敗しました', undefined, 'KIOSK_DOC_OCR_FAILED');
  }
}
