import { describe, expect, it, vi } from 'vitest';

import type { Prisma } from '@prisma/client';

import { copyProcedurePages } from '../assembly-procedure-document-page-copy.js';
import { serializeAssemblyProcedureOverlayElement } from '../assembly-procedure-document-revision.serializer.js';
import type { AssemblyProcedureDocumentRevisionRecord } from '../assembly-procedure-document-revision.service.js';

vi.mock('../procedure-video.service.js', () => ({ videosForPage: vi.fn() }));

import {
  elementToCreateData,
  normalizeElement,
  overlayToCreateDataFromRow,
  type AssemblyProcedureOverlayElementInput,
  type AssemblyProcedureOverlayElementRow
} from '../assembly-procedure-overlay.persistence.js';

const bbox = {
  xRatio: 0.1,
  yRatio: 0.2,
  widthRatio: 0.3,
  heightRatio: 0.4
};

describe('assembly procedure overlay persistence helpers', () => {
  it('normalizes text input and maps it to the text database columns', () => {
    const normalized = normalizeElement(
      {
        id: ' text-1 ',
        pageIndex: 0,
        bbox,
        zIndex: 2,
        kind: 'TEXT',
        text: '  確認してください  ',
        style: { fontWeight: 'bold', color: '#123456' }
      } as AssemblyProcedureOverlayElementInput,
      0
    );

    expect(normalized).toMatchObject({
      id: 'text-1',
      text: '確認してください',
      zIndex: 2,
      opacity: 1
    });
    expect(elementToCreateData('document-1', normalized)).toMatchObject({
      id: 'text-1',
      documentId: 'document-1',
      kind: 'TEXT',
      text: '確認してください',
      textStyle: { fontWeight: 'bold', color: '#123456' },
      assetId: null,
      shapeKind: null
    });
  });

  it('maps image and shape variants without changing their persisted fields', () => {
    const image = normalizeElement(
      {
        id: 'image-1',
        pageIndex: 1,
        bbox,
        zIndex: 1,
        kind: 'IMAGE',
        assetId: ' asset-1 ',
        objectFit: 'cover'
      } as AssemblyProcedureOverlayElementInput,
      0
    );
    expect(elementToCreateData('document-1', image)).toMatchObject({
      kind: 'IMAGE',
      assetId: 'asset-1',
      objectFit: 'cover'
    });

    const shape = normalizeElement(
      {
        id: 'shape-1',
        pageIndex: 0,
        bbox,
        zIndex: 3,
        kind: 'SHAPE',
        shape: 'ARROW',
        strokeColor: ' #ff0000 ',
        strokeWidthRatio: 0.01,
        start: { xRatio: 0.2, yRatio: 0.3 },
        end: { xRatio: 0.8, yRatio: 0.9 }
      } as AssemblyProcedureOverlayElementInput,
      1
    );
    expect(elementToCreateData('document-1', shape)).toMatchObject({
      kind: 'SHAPE',
      shapeKind: 'ARROW',
      strokeColor: '#ff0000',
      strokeWidthRatio: 0.01,
      shapeStartXRatio: 0.2,
      shapeStartYRatio: 0.3,
      shapeEndXRatio: 0.8,
      shapeEndYRatio: 0.9
    });
  });

  it('round-trips the confirmed photo transcript through save, revision copy and page copy', async () => {
    const transcript = {
      assetId: 'original-photo', kind: 'list' as const, title: 'シリーズ',
      rows: [['7000'], ['その他']], sel: [0], choices: [{ label: '選ぶ', color: '#ff0000', row: 1 }]
    };
    // The transcript also survives when the current photo has changed.
    const normalized = normalizeElement({
      id: 'image-1', kind: 'IMAGE', pageIndex: 0, bbox, zIndex: 1, assetId: 'replacement-photo', transcript
    }, 0);
    const saved = elementToCreateData('original-document', normalized);
    expect(saved).toMatchObject({ kind: 'IMAGE', transcript });
    const toRow = (data: Prisma.AssemblyProcedureOverlayElementCreateManyInput) =>
      ({ ...data, asset: null }) as unknown as AssemblyProcedureOverlayElementRow;
    expect(serializeAssemblyProcedureOverlayElement(toRow(saved))).toMatchObject({ assetId: 'replacement-photo', transcript });

    const createOverlays = vi.fn(async (_args: { data: Prisma.AssemblyProcedureOverlayElementCreateManyInput[] }) => ({ count: 1 }));
    const tx = {
      assemblyProcedureDocumentPage: { createMany: vi.fn() },
      assemblyProcedureOverlayElement: { createMany: createOverlays },
      procedureVideoLink: { createMany: vi.fn() }
    } as unknown as Prisma.TransactionClient;
    const pages = [{ documentId: 'original-document', pageIndex: 0, imageRelativePath: 'page.png' }] as AssemblyProcedureDocumentRevisionRecord['pages'];
    await copyProcedurePages(tx, 'revision', { pages, overlayElements: [toRow(saved)], procedureVideoLinks: [] });
    const [revisionRow] = createOverlays.mock.calls[0][0].data;
    expect(revisionRow).toMatchObject({ documentId: 'revision', pageIndex: 0, transcript });
    await copyProcedurePages(tx, 'page-destination', { pages, overlayElements: [toRow(revisionRow)], procedureVideoLinks: [] }, new Map([[0, 3]]));
    const [copiedRow] = createOverlays.mock.calls[1][0].data;
    expect(copiedRow).toMatchObject({ documentId: 'page-destination', pageIndex: 3, transcript });
    expect(serializeAssemblyProcedureOverlayElement(toRow(copiedRow))).toMatchObject({ pageIndex: 3, transcript });
  });

  it('copies an existing row into a new document mapping for revision cloning', () => {
    const row = {
      id: 'overlay-1',
      documentId: 'old-document',
      pageIndex: 0,
      kind: 'TEXT',
      xRatio: 0.1,
      yRatio: 0.2,
      widthRatio: 0.3,
      heightRatio: 0.4,
      zIndex: 0,
      opacity: 1,
      maskEnabled: false,
      maskColor: null,
      text: '既存',
      textStyle: { fontWeight: 'bold' },
      assetId: null,
      objectFit: null,
      shapeKind: null,
      strokeColor: null,
      fillColor: null,
      strokeWidthRatio: null,
      shapeStartXRatio: null,
      shapeStartYRatio: null,
      shapeEndXRatio: null,
      shapeEndYRatio: null,
      asset: null
    } as unknown as AssemblyProcedureOverlayElementRow;

    expect(overlayToCreateDataFromRow('new-document', row)).toMatchObject({
      id: 'overlay-1',
      documentId: 'new-document',
      text: '既存',
      textStyle: { fontWeight: 'bold' }
    });
  });
});
