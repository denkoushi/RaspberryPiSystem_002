import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));

import type { AssemblyProcedureAssetGcService } from '../../../services/assembly-procedure-assets/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const hasTestDatabase = Boolean(testDatabaseUrl);
const originalDatabaseUrl = process.env.DATABASE_URL;

// The API test setup intentionally has a localhost fallback. This focused
// integration test opts in only to an explicitly supplied test database.
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

const { prisma } = await import('../../../lib/prisma.js');
const { AssemblyProcedureDocumentService } = await import('../assembly-procedure-document.service.js');
const { AssemblyProcedureDocumentRevisionService } = await import('../assembly-procedure-document-revision.service.js');
const { AssemblyTemplateAccessService } = await import('../assembly-template-access.service.js');

const describeIntegration = hasTestDatabase ? describe : describe.skip;

const ACCESS_PASSWORD = 'integration-test-access';

type FixtureIds = {
  documentIds: string[];
  templateId: string;
};

function textOverlay(text: string) {
  return {
    kind: 'TEXT' as const,
    pageIndex: 0,
    bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.35, heightRatio: 0.12 },
    text,
    zIndex: 1,
    opacity: 1
  };
}

async function snapshotDocumentState(documentId: string) {
  const [document, revision, overlays] = await Promise.all([
    prisma.assemblyProcedureDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { status: true, updatedAt: true }
    }),
    prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({
      where: { documentId },
      select: { editVersion: true, isRevisionHead: true }
    }),
    prisma.assemblyProcedureOverlayElement.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        pageIndex: true,
        kind: true,
        xRatio: true,
        yRatio: true,
        widthRatio: true,
        heightRatio: true,
        zIndex: true,
        opacity: true,
        maskEnabled: true,
        maskColor: true,
        text: true,
        textStyle: true,
        assetId: true,
        objectFit: true,
        shapeKind: true,
        strokeColor: true,
        fillColor: true,
        strokeWidthRatio: true,
        shapeStartXRatio: true,
        shapeStartYRatio: true,
        shapeEndXRatio: true,
        shapeEndYRatio: true
      }
    })
  ]);

  return {
    document: { status: document.status, updatedAt: document.updatedAt.toISOString() },
    revision,
    overlays: overlays.map((overlay) => ({
      ...overlay,
      xRatio: overlay.xRatio.toString(),
      yRatio: overlay.yRatio.toString(),
      widthRatio: overlay.widthRatio.toString(),
      heightRatio: overlay.heightRatio.toString(),
      opacity: overlay.opacity.toString(),
      strokeWidthRatio: overlay.strokeWidthRatio?.toString() ?? null,
      shapeStartXRatio: overlay.shapeStartXRatio?.toString() ?? null,
      shapeStartYRatio: overlay.shapeStartYRatio?.toString() ?? null,
      shapeEndXRatio: overlay.shapeEndXRatio?.toString() ?? null,
      shapeEndYRatio: overlay.shapeEndYRatio?.toString() ?? null
    }))
  };
}

async function cleanFixtures(fixture: FixtureIds): Promise<void> {
  await prisma.assemblyTemplate.deleteMany({ where: { id: fixture.templateId } });
  if (fixture.documentIds.length > 0) {
    // A revision row points both to its own document and to the series root.
    // Remove the sidecars first so the root document is no longer protected by
    // the intentional RESTRICT foreign key used by production lifecycle rules.
    await prisma.assemblyProcedureDocumentRevision.deleteMany({
      where: { documentId: { in: fixture.documentIds } }
    });
    await prisma.assemblyProcedureDocument.deleteMany({
      where: { id: { in: fixture.documentIds } }
    });
  }
}

describeIntegration('AssemblyProcedureDocumentRevisionService real Postgres integration', () => {
  const accessService = {
    verifyAccessPassword: vi.fn(async () => ({ success: true })),
    requireAccessPassword: vi.fn(async (password: string | undefined) => {
      expect(password).toBe(ACCESS_PASSWORD);
    })
  };
  const assetGc = {
    collect: vi.fn(async () => ({
      claimed: 0,
      physicallyDeleted: 0,
      physicalDeleteFailures: []
    }))
  } as unknown as AssemblyProcedureAssetGcService;
  const publicationAccessCheck = vi
    .spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword')
    .mockResolvedValue(undefined);

  afterAll(async () => {
    publicationAccessCheck.mockRestore();
    await prisma.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('deletes imported page rows and cascades later overlays without deleting shared assets', async () => {
    const documentId = randomUUID();
    const assetId = randomUUID();
    const videoId = randomUUID();
    const overlayIds = [randomUUID(), randomUUID(), randomUUID()];
    const revisionService = new AssemblyProcedureDocumentRevisionService(accessService, assetGc);
    try {
      await prisma.assemblyProcedureDocument.create({ data: {
        id: documentId, name: 'delete-page-integration', imageRelativePath: '/imported-0.png', status: 'DRAFT',
        pages: { create: [0, 1, 2].map(pageIndex => ({ pageIndex, imageRelativePath: `/imported-${pageIndex}.png` })) }
      } });
      await revisionService.createRevision(documentId, ACCESS_PASSWORD);
      await prisma.assemblyProcedureAsset.create({ data: { id: assetId, kind: 'OVERLAY_IMAGE', storageKey: `delete-page-${assetId}`, sha256: 'a'.repeat(64), byteSize: 1, contentType: 'image/png' } });
      await prisma.procedureVideo.create({ data: { id: videoId, title: 'delete-page-test', gmailDedupeKey: videoId, receivedAt: new Date(), sourceFileName: 'test.mp4', sourceContentType: 'video/mp4', sourceByteSize: 1 } });
      for (const pageIndex of [0, 1, 2]) {
        await prisma.assemblyProcedureOverlayElement.create({ data: { id: overlayIds[pageIndex], documentId, pageIndex, kind: 'IMAGE', assetId, xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5, zIndex: 0 } });
        await prisma.procedureVideoLink.create({ data: { videoId, assemblyProcedureDocumentId: documentId, pageIndex, sortOrder: 0 } });
        await prisma.assemblyProcedureCaptionFeedback.create({ data: { documentId, pageIndex, elementId: overlayIds[pageIndex], assetId, documentName: 'delete-page-test', aiText: 'caption' } });
        await prisma.assemblyProcedureTextFeedback.create({ data: { documentId, pageIndex, elementId: overlayIds[pageIndex], documentName: 'delete-page-test', originalText: 'original', aiText: 'rewritten' } });
      }
      const result = await revisionService.deletePage({ documentId, pageIndex: 0, expectedEditVersion: 0, accessPassword: ACCESS_PASSWORD });
      expect(result.pages.map(page => page.pageIndex)).toEqual([0, 1]);
      expect(result.imageRelativePath).toBe('/imported-1.png');
      expect(result.overlayElements.map(element => [element.id, element.pageIndex])).toEqual([[overlayIds[1], 0], [overlayIds[2], 1]]);
      expect(result.procedureVideoLinks.map(link => link.pageIndex).sort()).toEqual([0, 1]);
      expect(result.revisionMetadata?.editVersion).toBe(1);
      for (const model of [prisma.assemblyProcedureCaptionFeedback, prisma.assemblyProcedureTextFeedback]) {
        const rows = await model.findMany({ where: { documentId } });
        expect(rows).toHaveLength(3);
        expect(rows.filter(row => row.elementId !== overlayIds[0]).map(row => row.pageIndex).sort()).toEqual([0, 1]);
      }
      expect(await prisma.assemblyProcedureTextFeedback.findFirst({ where: { documentId, elementId: overlayIds[0] } })).toMatchObject({ outcome: 'REVERTED' });
      expect(await prisma.assemblyProcedureAsset.findUnique({ where: { id: assetId } })).not.toBeNull();
      expect(await prisma.procedureVideo.findUnique({ where: { id: videoId } })).not.toBeNull();
      await expect(revisionService.deletePage({ documentId, pageIndex: 0, expectedEditVersion: 0, accessPassword: ACCESS_PASSWORD })).rejects.toMatchObject({ code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT' });
    } finally {
      await prisma.assemblyProcedureCaptionFeedback.deleteMany({ where: { documentId } });
      await prisma.assemblyProcedureTextFeedback.deleteMany({ where: { documentId } });
      await prisma.procedureVideoLink.deleteMany({ where: { assemblyProcedureDocumentId: documentId } });
      await prisma.assemblyProcedureDocumentRevision.deleteMany({ where: { documentId } });
      await prisma.assemblyProcedureDocument.deleteMany({ where: { id: documentId } });
      await prisma.assemblyProcedureAsset.deleteMany({ where: { id: assetId } });
      await prisma.procedureVideo.deleteMany({ where: { id: videoId } });
    }
  });

  it('keeps legacy references pinned across draft, publish, and discard lifecycle', async () => {
    const fixtureName = `revision-service-integration-${randomUUID()}`;
    const modelCode = `REVISION-IT-${randomUUID()}`;
    const legacyId = randomUUID();
    const templateId = randomUUID();
    const fixture: FixtureIds = { documentIds: [legacyId], templateId };
    const pagePath = `/api/storage/assembly-procedure-images/${fixtureName}.png`;
    const revisionService = new AssemblyProcedureDocumentRevisionService(accessService, assetGc);
    const documentService = new AssemblyProcedureDocumentService(assetGc);

    try {
      await prisma.assemblyProcedureDocument.create({
        data: {
          id: legacyId,
          name: fixtureName,
          imageRelativePath: pagePath,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-21T00:00:00.000Z'),
          pages: {
            create: {
              pageIndex: 0,
              imageRelativePath: pagePath
            }
          }
        }
      });
      await prisma.assemblyProcedureOverlayElement.createMany({
        data: {
          id: randomUUID(),
          documentId: legacyId,
          pageIndex: 0,
          kind: 'TEXT',
          xRatio: 0.1,
          yRatio: 0.1,
          widthRatio: 0.35,
          heightRatio: 0.12,
          zIndex: 0,
          opacity: 1,
          maskEnabled: false,
          text: 'legacy overlay'
        }
      });
      await prisma.assemblyTemplate.create({
        data: {
          id: templateId,
          modelCode,
          procedurePattern: 'revision-integration',
          name: `${fixtureName} template`,
          version: 1,
          isActive: true,
          procedureDocumentId: legacyId
        }
      });

      const v2 = await revisionService.createRevision(legacyId, ACCESS_PASSWORD);
      fixture.documentIds.push(v2.id);
      expect(v2.id).not.toBe(legacyId);
      expect(v2.status).toBe('DRAFT');
      expect(v2.revisionMetadata).toMatchObject({
        revisionRootId: legacyId,
        revisionNumber: 2,
        supersedesDocumentId: legacyId,
        isRevisionHead: true,
        editVersion: 0
      });
      expect(v2.overlayElements).toHaveLength(1);
      expect(v2.overlayElements[0]).toMatchObject({ kind: 'TEXT', text: 'legacy overlay' });

      const v1Metadata = await prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({
        where: { documentId: legacyId }
      });
      expect(v1Metadata).toMatchObject({
        revisionRootId: legacyId,
        revisionNumber: 1,
        isRevisionHead: false,
        editVersion: 0
      });

      const repeatedDraft = await revisionService.createRevision(v2.id, ACCESS_PASSWORD);
      expect(repeatedDraft.id).toBe(v2.id);
      expect(await prisma.assemblyProcedureDocument.count({ where: { id: v2.id } })).toBe(1);
      expect(await prisma.assemblyProcedureDocumentRevision.count({ where: { revisionRootId: legacyId } })).toBe(2);

      const saved = await revisionService.saveOverlays({
        documentId: v2.id,
        expectedEditVersion: 0,
        elements: [textOverlay('edited overlay')],
        accessPassword: ACCESS_PASSWORD
      });
      expect(saved.revisionMetadata?.editVersion).toBe(1);
      expect(saved.overlayElements).toHaveLength(1);
      expect(saved.overlayElements[0]).toMatchObject({ kind: 'TEXT', text: 'edited overlay' });

      const beforeStaleSave = await snapshotDocumentState(v2.id);
      await expect(
        revisionService.saveOverlays({
          documentId: v2.id,
          expectedEditVersion: 0,
          elements: [textOverlay('stale overlay')],
          accessPassword: ACCESS_PASSWORD
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT',
        details: { currentEditVersion: 1 }
      });
      expect(await snapshotDocumentState(v2.id)).toEqual(beforeStaleSave);

      const publishedV2 = await documentService.publish(v2.id, {
        accessPassword: ACCESS_PASSWORD,
        expectedEditVersion: 1
      });
      expect(publishedV2.status).toBe('PUBLISHED');
      expect((await prisma.assemblyProcedureDocument.findUniqueOrThrow({ where: { id: legacyId } })).status).toBe('PUBLISHED');
      expect((await prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({ where: { documentId: legacyId } })).isRevisionHead).toBe(false);
      expect((await prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({ where: { documentId: v2.id } })).isRevisionHead).toBe(true);

      const templateBeforeV3 = await prisma.assemblyTemplate.findUniqueOrThrow({
        where: { id: templateId },
        select: { procedureDocumentId: true }
      });
      expect(templateBeforeV3.procedureDocumentId).toBe(legacyId);

      const v3 = await revisionService.createRevision(v2.id, ACCESS_PASSWORD);
      fixture.documentIds.push(v3.id);
      expect(v3.status).toBe('DRAFT');
      expect(v3.revisionMetadata).toMatchObject({
        revisionRootId: legacyId,
        revisionNumber: 3,
        supersedesDocumentId: v2.id,
        isRevisionHead: true,
        editVersion: 0
      });
      expect((await prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({ where: { documentId: v2.id } })).isRevisionHead).toBe(false);

      const discarded = await revisionService.discardRevision({
        documentId: v3.id,
        expectedEditVersion: 0,
        accessPassword: ACCESS_PASSWORD
      });
      expect(discarded.id).toBe(v2.id);
      expect(discarded.status).toBe('PUBLISHED');
      expect(await prisma.assemblyProcedureDocument.findUnique({ where: { id: v3.id } })).toBeNull();
      expect((await prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({ where: { documentId: v2.id } })).isRevisionHead).toBe(true);
      expect((await prisma.assemblyProcedureDocumentRevision.findUniqueOrThrow({ where: { documentId: legacyId } })).isRevisionHead).toBe(false);

      const templateAfterDiscard = await prisma.assemblyTemplate.findUniqueOrThrow({
        where: { id: templateId },
        select: { procedureDocumentId: true }
      });
      expect(templateAfterDiscard.procedureDocumentId).toBe(legacyId);
    } finally {
      await cleanFixtures(fixture);
    }
  });
});
