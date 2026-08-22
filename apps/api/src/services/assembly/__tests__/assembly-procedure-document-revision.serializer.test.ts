import { describe, expect, it } from 'vitest';

import type { AssemblyProcedureDocumentRevisionRecord } from '../assembly-procedure-document-revision.service.js';
import {
  assemblyProcedureAssetUrl,
  serializeAssemblyProcedureDocumentRevision,
  serializeAssemblyProcedureOverlayElement
} from '../assembly-procedure-document-revision.serializer.js';
import type { AssemblyProcedureOverlayElementRow } from '../assembly-procedure-overlay.persistence.js';

const now = new Date('2026-08-21T00:00:00.000Z');

function makeImageOverlayRow(): AssemblyProcedureOverlayElementRow {
  return {
    id: 'overlay-image',
    documentId: 'document-1',
    pageIndex: 0,
    kind: 'IMAGE',
    xRatio: '0.1',
    yRatio: '0.2',
    widthRatio: '0.3',
    heightRatio: '0.4',
    zIndex: 2,
    opacity: '0.75',
    maskEnabled: true,
    maskColor: null,
    text: null,
    textStyle: null,
    assetId: 'asset-1',
    objectFit: 'cover',
    shapeKind: null,
    strokeColor: null,
    fillColor: null,
    strokeWidthRatio: null,
    shapeStartXRatio: null,
    shapeStartYRatio: null,
    shapeEndXRatio: null,
    shapeEndYRatio: null,
    createdAt: now,
    updatedAt: now,
    asset: {
      id: 'asset-1',
      storageKey: 'assembly-procedure-assets/nested/image.png',
      contentType: 'image/png',
      byteSize: 42,
      kind: 'OVERLAY_IMAGE',
      sha256: 'a'.repeat(64),
      ownerDocumentId: null,
      metadata: null,
      createdAt: now,
      updatedAt: now
    }
  } as unknown as AssemblyProcedureOverlayElementRow;
}

describe('assembly procedure document revision serializers', () => {
  it('builds stable asset URLs from storage keys and falls back to asset IDs', () => {
    expect(assemblyProcedureAssetUrl('asset-1', 'assembly-procedure-assets/image.png')).toBe(
      '/api/storage/assembly-procedure-assets/image.png'
    );
    expect(assemblyProcedureAssetUrl('asset-2', '')).toBe(
      '/api/storage/assembly-procedure-assets/asset-2'
    );
  });

  it('serializes overlay numeric values and variant fields', () => {
    expect(serializeAssemblyProcedureOverlayElement(makeImageOverlayRow())).toEqual({
      id: 'overlay-image',
      pageIndex: 0,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 },
      zIndex: 2,
      opacity: 0.75,
      mask: { enabled: true, color: '#ffffff' },
      kind: 'IMAGE',
      assetId: 'asset-1',
      objectFit: 'cover'
    });
  });

  it('serializes a revision with page grouping and the shared asset URL', () => {
    const row = makeImageOverlayRow();
    const document = {
      id: 'document-1',
      name: '手順書',
      imageRelativePath: '/api/storage/assembly-procedure-images/page-0.jpg',
      status: 'DRAFT',
      publishedAt: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      pages: [
        {
          id: 'page-1',
          documentId: 'document-1',
          pageIndex: 0,
          imageRelativePath: '/api/storage/assembly-procedure-images/page-0.jpg',
          createdAt: now
        }
      ],
      overlayElements: [row],
      revisionMetadata: {
        id: 'revision-1',
        documentId: 'document-1',
        revisionRootId: 'document-1',
        revisionNumber: 1,
        supersedesDocumentId: null,
        isRevisionHead: true,
        editVersion: 3,
        sourceAssetId: null,
        createdAt: now,
        updatedAt: now
      }
    } as unknown as AssemblyProcedureDocumentRevisionRecord;

    expect(serializeAssemblyProcedureDocumentRevision(document)).toMatchObject({
      id: 'document-1',
      status: 'draft',
      revisionNumber: 1,
      editVersion: 3,
      pages: [{ pageIndex: 0, overlays: [{ id: 'overlay-image', kind: 'IMAGE' }] }],
      assets: {
        'asset-1': {
          url: '/api/storage/assembly-procedure-assets/image.png',
          storageKey: 'assembly-procedure-assets/nested/image.png'
        }
      }
    });
  });
});
