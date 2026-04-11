import { env } from '../../config/env.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';

import { OpenAiCompatibleDocumentSummaryInferenceAdapter } from './adapters/openai-document-summary-inference.adapter.js';
import { NdlOcrEngineAdapter } from '../ocr/adapters/ndlocr-engine.adapter.js';
import { PdfToTextExtractorAdapter } from './adapters/pdftotext-extractor.adapter.js';
import { PostgresDocumentSearchIndexerAdapter } from './adapters/postgres-document-search-indexer.adapter.js';
import { PrismaKioskDocumentRepository } from './adapters/prisma-kiosk-document.repository.js';
import { RegexMetadataLabelerAdapter } from './adapters/regex-metadata-labeler.adapter.js';
import { KioskDocumentProcessingService } from './kiosk-document-processing.service.js';
import type { KioskDocumentRepositoryPort } from './ports/kiosk-document-repository.port.js';

export function createDefaultKioskDocumentProcessingService(
  repo?: KioskDocumentRepositoryPort
): KioskDocumentProcessingService {
  const repository = repo ?? new PrismaKioskDocumentRepository();
  const rt = getInferenceRuntime();
  const summaryInference =
    env.KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED && rt.isDocumentSummaryInferenceConfigured()
      ? new OpenAiCompatibleDocumentSummaryInferenceAdapter(rt.createTextCompletionPort())
      : undefined;

  return new KioskDocumentProcessingService(
    repository,
    new PdfToTextExtractorAdapter(),
    new NdlOcrEngineAdapter(),
    new RegexMetadataLabelerAdapter(),
    new PostgresDocumentSearchIndexerAdapter(),
    summaryInference
  );
}
