import { describe, expect, it } from 'vitest';

import { serializeProcedureSequence } from '../index.js';

describe('serializeProcedureSequence', () => {
  it('keeps document overlays/assets and page identity for full and crop consumers', () => {
    const sequence = serializeProcedureSequence({
      mode: 'configured',
      source: 'template_version',
      machineName: 'MH-OVERLAY',
      machineNameKey: 'MH-OVERLAY',
      stepSource: 'template_steps',
      steps: [],
      fallbackProcedureDocument: null,
      documents: [
        {
          orderItemId: 'old-item',
          sortOrder: 0,
          label: '旧テンプレートの文書',
          documentType: 'assembly_procedure_document',
          kioskDocumentId: null,
          assemblyProcedureDocumentId: 'old-document',
          title: '旧版',
          displayTitle: null,
          filename: 'old.png',
          confirmedDocumentNumber: null,
          confirmedSummaryText: null,
          pageCount: 1,
          updatedAt: new Date('2026-08-21T00:00:00.000Z'),
          pageUrls: ['/old-page.jpg'],
          pages: [
            {
              source: 'assembly_procedure_document',
              documentId: 'old-document',
              pageIndex: 0,
              pageUrl: '/old-page.jpg',
              overlays: [
                {
                  id: 'old-overlay',
                  kind: 'TEXT',
                  pageIndex: 0,
                  bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
                  zIndex: 0,
                  text: '旧版'
                }
              ]
            }
          ],
          overlays: [],
          assets: {
            'old-asset': {
              assetId: 'old-asset',
              storageKey: 'assembly-procedure-assets/old.png',
              contentType: 'image/png',
              byteSize: 10,
              url: '/api/storage/assembly-procedure-assets/old.png'
            }
          }
        },
        {
          orderItemId: 'new-item',
          sortOrder: 1,
          label: '新版文書',
          documentType: 'assembly_procedure_document',
          kioskDocumentId: null,
          assemblyProcedureDocumentId: 'new-document',
          title: '新版',
          displayTitle: null,
          filename: 'new.png',
          confirmedDocumentNumber: null,
          confirmedSummaryText: null,
          pageCount: 1,
          updatedAt: new Date('2026-08-21T00:00:00.000Z'),
          pageUrls: ['/new-page.jpg'],
          pages: [
            {
              source: 'assembly_procedure_document',
              documentId: 'new-document',
              pageIndex: 0,
              pageUrl: '/new-page.jpg',
              overlays: [
                {
                  id: 'new-overlay',
                  kind: 'SHAPE',
                  pageIndex: 0,
                  bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 },
                  zIndex: 3,
                  shape: 'ARROW'
                }
              ]
            }
          ],
          overlays: [],
          assets: {
            'new-asset': {
              assetId: 'new-asset',
              storageKey: 'assembly-procedure-assets/new.webp',
              contentType: 'image/webp',
              byteSize: 20,
              url: '/api/storage/assembly-procedure-assets/new.webp'
            }
          }
        }
      ]
    });

    expect(sequence.documents[0]).toMatchObject({
      assemblyProcedureDocumentId: 'old-document',
      assets: { 'old-asset': { url: '/api/storage/assembly-procedure-assets/old.png' } },
      pages: [{ overlays: [{ id: 'old-overlay' }] }]
    });
    expect(sequence.documents[1]).toMatchObject({
      assemblyProcedureDocumentId: 'new-document',
      assets: { 'new-asset': { url: '/api/storage/assembly-procedure-assets/new.webp' } },
      pages: [{ overlays: [{ id: 'new-overlay' }] }]
    });
  });
});
