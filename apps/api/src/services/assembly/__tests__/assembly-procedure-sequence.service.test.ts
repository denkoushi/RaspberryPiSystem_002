import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureSequenceService } from '../assembly-procedure-sequence.service.js';

const OLD_DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const NEW_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const OLD_ASSET_ID = '33333333-3333-4333-8333-333333333333';
const NEW_ASSET_ID = '44444444-4444-4444-8444-444444444444';
const UPDATED_AT = new Date('2026-08-21T00:00:00.000Z');

function sequenceItem(documentId: string, label: string) {
  return {
    id: `item-${documentId}`,
    sortOrder: 0,
    label,
    kioskDocumentId: null,
    assemblyProcedureDocumentId: documentId,
    kioskDocument: null,
    assemblyProcedureDocument: {
      id: documentId,
      name: label,
      imageRelativePath: `/api/storage/assembly-procedure-pages/${documentId}/page-0.jpg`,
      isActive: true,
      status: 'PUBLISHED' as const,
      updatedAt: UPDATED_AT,
      pages: [{ pageIndex: 0, imageRelativePath: `/api/storage/assembly-procedure-pages/${documentId}/page-0.jpg` }]
    }
  };
}

function overlayRow(params: {
  id: string;
  documentId: string;
  zIndex: number;
  text: string;
  assetId: string;
  storageKey: string;
}) {
  return {
    id: params.id,
    documentId: params.documentId,
    pageIndex: 0,
    kind: 'TEXT' as const,
    xRatio: 0.1,
    yRatio: 0.2,
    widthRatio: 0.3,
    heightRatio: 0.1,
    zIndex: params.zIndex,
    opacity: 1,
    maskEnabled: true,
    maskColor: '#ffffff',
    text: params.text,
    textStyle: { fontSize: 16 },
    assetId: params.assetId,
    objectFit: null,
    shapeKind: null,
    strokeColor: null,
    fillColor: null,
    strokeWidthRatio: null,
    shapeStartXRatio: null,
    shapeStartYRatio: null,
    shapeEndXRatio: null,
    shapeEndYRatio: null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    asset: {
      id: params.assetId,
      kind: 'OVERLAY_IMAGE' as const,
      storageKey: params.storageKey,
      sha256: 'a'.repeat(64),
      byteSize: 123,
      contentType: 'image/png',
      originalFileName: 'overlay.png',
      width: 100,
      height: 40,
      createdAt: UPDATED_AT
    }
  };
}

describe('AssemblyProcedureSequenceService overlay integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a session on its pinned document while a different selection gets its own overlays and assets', async () => {
    const documents = new Map([
      [
        OLD_DOCUMENT_ID,
        {
          ...sequenceItem(OLD_DOCUMENT_ID, '旧版手順書'),
          templateId: 'template-old'
        }
      ],
      [
        NEW_DOCUMENT_ID,
        {
          ...sequenceItem(NEW_DOCUMENT_ID, '新版手順書'),
          templateId: 'template-new'
        }
      ]
    ]);
    const sessions = new Map([
      ['old-session', { templateId: 'template-old', documentId: OLD_DOCUMENT_ID }],
      ['new-session', { templateId: 'template-new', documentId: NEW_DOCUMENT_ID }]
    ]);

    vi.spyOn(prisma.assemblyWorkSession, 'findUnique').mockImplementation(async ({ where }: any) => {
      const session = sessions.get(where.id);
      if (!session) return null as never;
      const item = documents.get(session.documentId)!;
      return {
        targetUnit: 'MH-OVERLAY',
        template: {
          id: session.templateId,
          procedureDocument: item.assemblyProcedureDocument,
          procedureItems: [item],
          procedureSteps: []
        }
      } as never;
    });
    vi.spyOn(prisma.assemblyProcedureDocumentPage, 'findMany').mockResolvedValue(
      [OLD_DOCUMENT_ID, NEW_DOCUMENT_ID].map((documentId) => ({
        documentId,
        pageIndex: 0,
        imageRelativePath: `/api/storage/assembly-procedure-pages/${documentId}/page-0.jpg`
      })) as never
    );
    vi.spyOn(prisma.assemblyProcedureOverlayElement, 'findMany').mockResolvedValue([
      overlayRow({
        id: 'old-overlay-first',
        documentId: OLD_DOCUMENT_ID,
        zIndex: 1,
        text: '旧版の先行注記',
        assetId: OLD_ASSET_ID,
        storageKey: `assembly-procedure-assets/${OLD_ASSET_ID}.png`
      }),
      overlayRow({
        id: 'old-overlay',
        documentId: OLD_DOCUMENT_ID,
        zIndex: 2,
        text: '旧版の注記',
        assetId: OLD_ASSET_ID,
        storageKey: `assembly-procedure-assets/${OLD_ASSET_ID}.png`
      }),
      overlayRow({
        id: 'new-overlay',
        documentId: NEW_DOCUMENT_ID,
        zIndex: 1,
        text: '新版の注記',
        assetId: NEW_ASSET_ID,
        storageKey: `assembly-procedure-assets/${NEW_ASSET_ID}.webp`
      })
    ] as never);

    const service = new AssemblyProcedureSequenceService(
      { getByMachineName: vi.fn().mockResolvedValue({ items: [] }) } as never,
      {} as never,
      { mapStoredSteps: vi.fn().mockReturnValue([]) } as never
    );

    const oldSequence = await service.resolveForWorkSession('old-session');
    const newSequence = await service.resolveForWorkSession('new-session');
    const oldDocument = oldSequence?.documents[0];
    const newDocument = newSequence?.documents[0];

    expect(oldDocument?.assemblyProcedureDocumentId).toBe(OLD_DOCUMENT_ID);
    expect(oldDocument?.pages[0]?.overlays.map(({ id }) => id)).toEqual([
      'old-overlay-first',
      'old-overlay'
    ]);
    expect(oldDocument?.assets[OLD_ASSET_ID]).toMatchObject({
      storageKey: `assembly-procedure-assets/${OLD_ASSET_ID}.png`,
      url: `/api/storage/assembly-procedure-assets/${OLD_ASSET_ID}.png`
    });

    expect(newDocument?.assemblyProcedureDocumentId).toBe(NEW_DOCUMENT_ID);
    expect(newDocument?.pages[0]?.overlays.map(({ id }) => id)).toEqual(['new-overlay']);
    expect(newDocument?.assets[NEW_ASSET_ID]).toMatchObject({
      storageKey: `assembly-procedure-assets/${NEW_ASSET_ID}.webp`,
      url: `/api/storage/assembly-procedure-assets/${NEW_ASSET_ID}.webp`
    });
    expect(newDocument?.pages[0]?.overlays).not.toContainEqual(
      expect.objectContaining({ id: 'old-overlay' })
    );
  });
});
