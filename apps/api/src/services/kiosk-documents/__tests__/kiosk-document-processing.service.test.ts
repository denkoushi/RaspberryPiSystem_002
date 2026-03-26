import { describe, expect, it, vi } from 'vitest';

import { KioskDocumentProcessingService } from '../kiosk-document-processing.service.js';
import type { KioskDocumentRepositoryPort } from '../ports/kiosk-document-repository.port.js';
import type { DocumentTextExtractorPort } from '../ports/document-text-extractor.port.js';
import type { OcrEnginePort } from '../ports/ocr-engine.port.js';
import type { MetadataLabelerPort } from '../ports/metadata-labeler.port.js';
import type { DocumentSearchIndexerPort } from '../ports/document-search-indexer.port.js';

function createRepoStub(): KioskDocumentRepositoryPort {
  const doc = {
    id: '11111111-1111-1111-1111-111111111111',
    title: '元タイトル',
    displayTitle: null,
    filePath: '/tmp/test.pdf',
    confirmedFhincd: null,
    confirmedDrawingNumber: null,
    confirmedProcessName: null,
    confirmedResourceCd: null,
  } as Awaited<ReturnType<KioskDocumentRepositoryPort['findById']>> extends Promise<infer T> ? T : never;

  return {
    create: vi.fn(),
    findById: vi.fn(async () => doc),
    findByGmailDedupeKey: vi.fn(),
    list: vi.fn(),
    listPendingProcessing: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(async (_id, data) => ({ ...doc, ...data })),
    createMetadataHistory: vi.fn(),
  };
}

describe('KioskDocumentProcessingService', () => {
  it('stores raw extracted text while labeling with normalized text', async () => {
    const repo = createRepoStub();
    const textExtractor: DocumentTextExtractorPort = {
      extractText: vi.fn(async () => ({ text: 'ＦＨＩＮＣＤ ZX98\n研削' })),
    };
    const ocrEngine: OcrEnginePort = {
      runOcr: vi.fn(async () => ({ text: '', engine: 'NDLOCR-Lite' })),
    };
    const labeler: MetadataLabelerPort = {
      labelFromText: vi.fn(async () => ({
        candidates: { fhincd: 'zx98', processName: '研削' },
        confidence: { fhincd: 0.99, processName: 0.96 },
        suggestedDisplayTitle: 'ZX98 - 研削',
      })),
    };
    const indexer: DocumentSearchIndexerPort = {
      refreshDocumentIndex: vi.fn(async () => {}),
    };

    const service = new KioskDocumentProcessingService(repo, textExtractor, ocrEngine, labeler, indexer);
    await service.processDocumentById('11111111-1111-1111-1111-111111111111');

    expect(labeler.labelFromText).toHaveBeenCalledWith('fhincd zx98 研削');
    expect(repo.update).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      expect.objectContaining({
        extractedText: 'ＦＨＩＮＣＤ ZX98\n研削',
        confirmedFhincd: 'zx98',
        confirmedProcessName: '研削',
      })
    );
  });
});
