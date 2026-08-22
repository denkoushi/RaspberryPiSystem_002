import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

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
