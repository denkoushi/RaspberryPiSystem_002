import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { defaultBackupConfig, type BackupConfig } from '../../backup/backup-config.js';
import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { prisma } from '../../../lib/prisma.js';
import type { WorkInstructionImportJob, WorkInstructionGmailPort } from '../work-instruction-gmail-ingestion.service.js';
import { WorkInstructionGmailIngestionService } from '../work-instruction-gmail-ingestion.service.js';
import type { ImportJobStore } from '../work-instruction-import-job.store.js';
import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';
import { FileStorageIntegrityCatalog } from '../../file-storage/file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../../file-storage/local-durable-file-store.js';
import { WorkInstructionFileStoreAdapter } from '../work-instruction-file-store.adapter.js';
import { PrismaWorkInstructionRepository } from '../repositories/prisma-work-instruction.repository.js';

const integrationEnabled = process.env.WORK_INSTRUCTION_INTEGRATION === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

if (integrationEnabled) {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(databaseUrl)) {
    throw new Error('WORK_INSTRUCTION_INTEGRATION requires a disposable loopback DATABASE_URL');
  }
}

const fixtureToken = `WIG-${process.pid}-${Date.now()}`;
const sourceSystem = `SharePoint-${fixtureToken}`;
const messagePrefix = `gmail-${fixtureToken}-`;
// Group reads span all source systems; use unique keys so this suite remains
// isolated when integration files share one disposable database.
const fixturePartNumber = `WI-${fixtureToken}`;
const fixtureShootingTarget = `TARGET-${fixtureToken}`;
const movedPartNumber = `WI-MOVED-${fixtureToken}`;
const movedShootingTarget = `MOVED-${fixtureToken}`;
const fixtureAssetIds = new Set<string>();
const baseModified = new Date('2026-08-29T00:00:00.000Z');
const config: BackupConfig = {
  ...defaultBackupConfig,
  workInstructionGmailIngest: {
    enabled: true,
    subjectTokens: ['[Kakou-Dandori-photo]'],
    fromEmail: 'sharepoint@example.com',
  },
};

type FixtureMessage = {
  message: GmailMessage;
  attachments: Map<string, Buffer>;
  imageBytes: Buffer;
  imageNames: string[];
};

function validImageBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 3, height: 2, channels: 3, background: { r: 13, g: 27, b: 39 } },
  }).jpeg({ quality: 92 }).toBuffer();
}

function configForSubject(): BackupConfig {
  return config;
}

function packetManifest(input: {
  itemId: number;
  list: string;
  modified: Date;
  partNumber?: string | null;
  shootingTarget?: string | null;
  imageNames: string[];
}): Record<string, unknown> {
  return {
    schema_version: 1,
    source: {
      system: sourceSystem,
      list: input.list,
      item_id: input.itemId,
      modified: input.modified.toISOString(),
    },
    part_number: input.partNumber === undefined ? fixturePartNumber : input.partNumber,
    shooting_target: input.shootingTarget === undefined ? fixtureShootingTarget : input.shootingTarget,
    steps: input.imageNames.map((image, index) => ({
      step: index + 1,
      text: `${input.itemId}-step-${index + 1}`,
      image,
    })),
  };
}

function fixtureMessage(input: {
  id: string;
  itemId: number;
  list: string;
  modified: Date;
  imageNames: string[];
  imageBytes: Buffer;
  partNumber?: string | null;
  shootingTarget?: string | null;
  invalid?: boolean;
}): FixtureMessage {
  const manifest = packetManifest(input);
  if (input.invalid) {
    manifest.steps = [{ step: 1, text: 'missing image', image: 'not-attached.jpeg' }];
  }
  const attachments = new Map<string, Buffer>();
  const manifestAttachmentId = `${input.id}-manifest`;
  attachments.set(manifestAttachmentId, Buffer.from(JSON.stringify(manifest), 'utf8'));
  const parts = [
    {
      filename: `${input.itemId}_manifest.json`,
      mimeType: 'application/json',
      body: { attachmentId: manifestAttachmentId },
      headers: [{ name: 'Content-Disposition', value: 'attachment' }],
    },
  ];
  if (!input.invalid) {
    for (const imageName of input.imageNames) {
      const attachmentId = `${input.id}-${imageName}`;
      attachments.set(attachmentId, input.imageBytes);
      parts.push({
        filename: imageName,
        // The resolver must validate the bytes, not trust a generic MIME label.
        mimeType: 'application/octet-stream',
        body: { attachmentId },
        headers: [{ name: 'Content-Disposition', value: 'attachment' }],
      });
    }
  }
  return {
    message: {
      id: input.id,
      threadId: `${input.id}-thread`,
      labelIds: ['UNREAD', 'INBOX'],
      snippet: '',
      internalDateMs: input.modified.getTime(),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject', value: `[Kakou-Dandori-photo] ${input.id}` },
          { name: 'From', value: 'SharePoint <sharepoint@example.com>' },
        ],
        parts,
      },
    },
    attachments,
    imageBytes: input.imageBytes,
    imageNames: [...input.imageNames],
  };
}

function mailbox(fixtures: ReadonlyArray<FixtureMessage>, options?: { failFirstMarkAsRead?: boolean }) {
  const byId = new Map(fixtures.map((fixture) => [fixture.message.id, fixture]));
  let failedMark = false;
  const searchMessagesAll = vi.fn(async () => fixtures.map((fixture) => fixture.message.id));
  const getMessage = vi.fn(async (messageId: string) => {
    const fixture = byId.get(messageId);
    if (!fixture) throw new Error(`unknown fixture message ${messageId}`);
    return fixture.message;
  });
  const getAttachment = vi.fn(async (messageId: string, attachmentId: string) => {
    const fixture = byId.get(messageId);
    const bytes = fixture?.attachments.get(attachmentId);
    if (!bytes) throw new Error(`unknown fixture attachment ${messageId}/${attachmentId}`);
    return bytes;
  });
  const markAsRead = vi.fn(async (_messageId: string) => {
    if (options?.failFirstMarkAsRead && !failedMark) {
      failedMark = true;
      throw new Error('simulated mark-as-read outage');
    }
  });
  const trashMessage = vi.fn(async (_messageId: string) => undefined);
  const client: WorkInstructionGmailPort = {
    searchMessagesAll,
    getMessage,
    getAttachment,
    markAsRead,
    trashMessage,
  };
  return { client, searchMessagesAll, getMessage, getAttachment, markAsRead, trashMessage };
}

function memoryJobStore(): ImportJobStore {
  const jobs = new Map<string, WorkInstructionImportJob>();
  return {
    async create(input) {
      const job: WorkInstructionImportJob = {
        id: randomUUID(),
        type: input.type,
        status: input.status,
        summary: input.summary,
        createdAt: new Date(),
        completedAt: null,
      };
      jobs.set(job.id, job);
      return job;
    },
    async update(id, input) {
      const current = jobs.get(id);
      if (!current) throw new Error(`unknown job ${id}`);
      const updated = {
        ...current,
        status: input.status,
        summary: input.summary,
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      };
      jobs.set(id, updated);
      return updated;
    },
    async find(id, type) {
      const job = jobs.get(id);
      return job?.type === type ? job : null;
    },
  };
}

function makeService(gmail: WorkInstructionGmailPort, files: WorkInstructionFileStoreAdapter): WorkInstructionGmailIngestionService {
  const delegate = new PrismaWorkInstructionRepository();
  // Resolver-generated asset ids are random UUIDs. Track exactly the ids
  // staged by this suite so cleanup never relies on a timestamp/broad query.
  const repository = delegate as PrismaWorkInstructionRepository & WorkInstructionRepository;
  const stageAssets = delegate.stageAssets.bind(delegate);
  repository.stageAssets = async (input) => {
    const staged = await stageAssets(input);
    staged.forEach((asset) => fixtureAssetIds.add(asset.assetId));
    return staged;
  };
  return new WorkInstructionGmailIngestionService({
    repository,
    fileStore: files,
    jobStore: memoryJobStore(),
    gmailFactory: async () => gmail,
  });
}

async function cleanupFixtures(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.workInstructionRow.findMany({
      where: { sourceSystem },
      select: { id: true, steps: { select: { assetId: true } } },
    });
    const assetIds = new Set(fixtureAssetIds);
    rows.forEach((row) => row.steps.forEach((step) => {
      if (step.assetId) assetIds.add(step.assetId);
    }));
    const rowIds = rows.map((row) => row.id);
    if (rowIds.length > 0) {
      const versions = await tx.workInstructionSourceVersion.findMany({
        where: { rowId: { in: rowIds } },
        select: { id: true },
      });
      const versionIds = versions.map((version) => version.id);
      const revisions = versionIds.length > 0
        ? await tx.workInstructionEditRevision.findMany({
          where: { sourceVersionId: { in: versionIds } },
          select: { id: true },
        })
        : [];
      const revisionIds = revisions.map((revision) => revision.id);
      const ownedEditAssets = revisionIds.length > 0
        ? await tx.workInstructionEditAsset.findMany({
          where: { ownerRevisionId: { in: revisionIds } },
          select: { id: true },
        })
        : [];

      await tx.workInstructionSourcePublication.deleteMany({ where: { rowId: { in: rowIds } } });
      if (revisionIds.length > 0) {
        await tx.workInstructionEditOverlay.deleteMany({ where: { revisionId: { in: revisionIds } } });
        await tx.workInstructionEditRevision.deleteMany({ where: { id: { in: revisionIds } } });
      }
      if (ownedEditAssets.length > 0) {
        await tx.workInstructionEditAsset.deleteMany({
          where: { id: { in: ownedEditAssets.map((asset) => asset.id) }, overlays: { none: {} } },
        });
      }
      if (versionIds.length > 0) {
        await tx.workInstructionSourceAssetDeletionAudit.deleteMany({ where: { sourceVersionId: { in: versionIds } } });
        await tx.workInstructionSourceVersionStep.deleteMany({ where: { sourceVersionId: { in: versionIds } } });
        await tx.workInstructionSourceVersion.deleteMany({ where: { id: { in: versionIds } } });
      }
      await tx.workInstructionRow.deleteMany({ where: { id: { in: rowIds } } });
    }
    if (assetIds.size > 0) {
      await tx.workInstructionAsset.deleteMany({
        where: {
          id: { in: [...assetIds] },
          steps: { none: {} },
          sourceVersionSteps: { none: {} },
        },
      });
    }
    await tx.workInstructionImportMessage.deleteMany({
      where: { gmailMessageId: { startsWith: messagePrefix } },
    });
  });
  fixtureAssetIds.clear();
}

describeIntegration('work-instruction Gmail → Prisma → durable filesystem integration', () => {
  const repository = new PrismaWorkInstructionRepository();
  let storageRoot: string;
  let files: WorkInstructionFileStoreAdapter;
  let localStore: LocalDurableFileStore;

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rps-wi-ingest-'));
    const catalog = new FileStorageIntegrityCatalog(storageRoot);
    localStore = new LocalDurableFileStore(storageRoot, catalog, { minimumFreeBytes: 0 });
    await localStore.initialize(['work-instruction-assets', '.integrity']);
    files = new WorkInstructionFileStoreAdapter(localStore);
    await cleanupFixtures();
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it('imports two rows with more than eight original images and cleans displaced files after a move', async () => {
    const imageBytes = await validImageBytes();
    const first = fixtureMessage({
      id: `${messagePrefix}first`,
      itemId: 640,
      list: 'List-A',
      modified: baseModified,
      imageNames: Array.from({ length: 5 }, (_, index) => `640_photo_${index + 1}.jpeg`),
      imageBytes,
    });
    const second = fixtureMessage({
      id: `${messagePrefix}second`,
      itemId: 641,
      list: 'List-B',
      modified: new Date(baseModified.getTime() + 1_000),
      imageNames: Array.from({ length: 5 }, (_, index) => `641_photo_${index + 1}.jpeg`),
      imageBytes,
    });
    const mail = mailbox([first, second]);
    const service = makeService(mail.client, files);

    const firstSummary = await service.ingestMessage({ config: configForSubject(), allowWait: false, messageId: first.message.id });
    const secondSummary = await service.ingestMessage({ config: configForSubject(), allowWait: false, messageId: second.message.id });
    expect(firstSummary).toMatchObject({ applied: 1, acknowledged: 1, acknowledgementPending: 0 });
    expect(secondSummary).toMatchObject({ applied: 1, acknowledged: 1, acknowledgementPending: 0 });
    expect(mail.getAttachment).toHaveBeenCalledTimes(12);
    expect(mail.markAsRead).toHaveBeenCalledTimes(2);
    expect(mail.trashMessage).toHaveBeenCalledTimes(2);

    const rows = await repository.readRows({
      partNumber: fixturePartNumber,
      shootingTarget: fixtureShootingTarget,
      includeUnclassified: false,
      limit: 20,
      offset: 0,
    });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((count, row) => count + row.steps.length, 0)).toBe(10);
    for (const row of rows) {
      for (const step of row.steps) {
        expect(step.imageStorageKey).toBeTruthy();
        // The bytes are read through the integrity-checking durable adapter;
        // the resolver/repository path never transforms the original JPEG.
        await expect(files.read({ storageKey: step.imageStorageKey! })).resolves.toEqual(imageBytes);
      }
    }
    expect(await repository.readGroups({ partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget, limit: 10, offset: 0 })).toContainEqual(
      expect.objectContaining({ partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget, rowCount: 2, stepCount: 10 }),
    );

    const oldStorageKeys = rows.find((row) => row.source.itemId === 640)!.steps
      .map((step) => step.imageStorageKey!)
      .filter(Boolean);
    const moved = fixtureMessage({
      id: `${messagePrefix}moved`,
      itemId: 640,
      list: 'List-A',
      modified: new Date(baseModified.getTime() + 60_000),
      imageNames: [],
      imageBytes,
      partNumber: movedPartNumber,
      shootingTarget: movedShootingTarget,
    });
    const movedMail = mailbox([moved]);
    const movedService = makeService(movedMail.client, files);
    const movedSummary = await movedService.ingestMessage({ config: configForSubject(), allowWait: false, messageId: moved.message.id });
    expect(movedSummary).toMatchObject({ applied: 1, acknowledged: 1 });
    expect(await repository.readGroup({ partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget })).not.toBeNull();
    expect((await repository.readGroup({ partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget }))!.rows).toHaveLength(1);
    expect((await repository.readGroup({ partNumber: movedPartNumber, shootingTarget: movedShootingTarget }))!.rows).toHaveLength(1);
    const cleanup = await movedService.cleanupAssets(new Date(Date.now() + 60 * 60 * 1000));
    // v1 is retained as an immutable source snapshot, so its images are still
    // referenced and must not be collected by the latest-row GC.
    expect(cleanup.deleted).toBe(0);
    for (const storageKey of oldStorageKeys) {
      await expect(localStore.stat(storageKey)).resolves.toBeTruthy();
    }
  });

  it('records the terminal result before an acknowledgement failure and retries cleanup without reapplying', async () => {
    const imageBytes = await validImageBytes();
    const fixture = fixtureMessage({
      id: `${messagePrefix}ack`,
      itemId: 650,
      list: 'List-A',
      modified: baseModified,
      imageNames: ['650_photo.jpeg'],
      imageBytes,
    });
    const mail = mailbox([fixture], { failFirstMarkAsRead: true });
    const service = makeService(mail.client, files);
    const first = await service.ingestMessage({ config: configForSubject(), allowWait: false, messageId: fixture.message.id });
    expect(first).toMatchObject({ applied: 1, acknowledged: 0, acknowledgementPending: 1 });
    expect(mail.getMessage).toHaveBeenCalledTimes(1);
    expect(mail.getAttachment).toHaveBeenCalledTimes(2);
    expect(mail.trashMessage).not.toHaveBeenCalled();
    expect(await repository.readImportMessage(fixture.message.id)).toMatchObject({
      outcome: 'APPLIED',
      mailCleanupPending: true,
    });
    expect(await repository.readRows({ limit: 10, offset: 0, partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget })).toHaveLength(1);

    const second = await service.ingestMessage({ config: configForSubject(), allowWait: false, messageId: fixture.message.id });
    expect(second).toMatchObject({ applied: 1, acknowledged: 1, acknowledgementPending: 0 });
    expect(mail.getMessage).toHaveBeenCalledTimes(1);
    expect(mail.getAttachment).toHaveBeenCalledTimes(2);
    expect(mail.markAsRead).toHaveBeenCalledTimes(2);
    expect(mail.trashMessage).toHaveBeenCalledTimes(1);
    expect(await repository.readImportMessage(fixture.message.id)).toMatchObject({
      outcome: 'APPLIED',
      mailCleanupPending: false,
      nextRetryAt: null,
    });
    expect(await repository.readRows({ limit: 10, offset: 0, partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget })).toHaveLength(1);
  });

  it('records and trashes an invalid packet, continues the cycle, and does not let old history hide due retries', async () => {
    const imageBytes = await validImageBytes();
    const invalid = fixtureMessage({
      id: `${messagePrefix}invalid`,
      itemId: 660,
      list: 'List-A',
      modified: baseModified,
      imageNames: [],
      imageBytes,
      invalid: true,
    });
    const valid = fixtureMessage({
      id: `${messagePrefix}cycle-valid`,
      itemId: 661,
      list: 'List-A',
      modified: new Date(baseModified.getTime() + 1_000),
      imageNames: ['661_photo.jpeg'],
      imageBytes,
    });
    const cycleMail = mailbox([invalid, valid]);
    const service = makeService(cycleMail.client, files);
    const cycle = await service.ingestCycle({ config: configForSubject(), allowWait: false });
    expect(cycle).toMatchObject({ scanned: 2, selected: 2, invalid: 1, applied: 1, acknowledged: 2 });
    expect(await repository.readImportMessage(invalid.message.id)).toMatchObject({
      outcome: 'INVALID',
      mailCleanupPending: false,
    });
    expect(await repository.readImportMessage(valid.message.id)).toMatchObject({ outcome: 'APPLIED' });
    expect(await repository.readRows({ limit: 20, offset: 0, partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget })).toHaveLength(1);
    expect(cycleMail.trashMessage).toHaveBeenCalledWith(valid.message.id);
    expect(cycleMail.trashMessage).toHaveBeenCalledWith(invalid.message.id);

    const oldIds = Array.from({ length: 1001 }, (_, index) => `${messagePrefix}old-invalid-${index}`);
    await prisma.workInstructionImportMessage.createMany({
      data: oldIds.map((gmailMessageId) => ({
        gmailMessageId,
        outcome: 'INVALID' as const,
        error: 'historical invalid fixture',
        nextRetryAt: null,
        mailCleanupPending: false,
      })),
    });
    const retryId = `${messagePrefix}history-retry`;
    await prisma.workInstructionImportMessage.create({
      data: {
        gmailMessageId: retryId,
        outcome: 'RETRYABLE',
        error: 'transient fixture',
        nextRetryAt: new Date(baseModified.getTime() - 1_000),
        mailCleanupPending: false,
      },
    });
    const historyRetry = fixtureMessage({
      id: retryId,
      itemId: 662,
      list: 'List-A',
      modified: new Date(baseModified.getTime() + 2_000),
      imageNames: [],
      imageBytes,
    });
    const freshId = `${messagePrefix}history-new`;
    const fresh = fixtureMessage({
      id: freshId,
      itemId: 663,
      list: 'List-A',
      modified: new Date(baseModified.getTime() + 3_000),
      imageNames: [],
      imageBytes,
    });
    const historyMail = mailbox([historyRetry, fresh]);
    historyMail.searchMessagesAll.mockResolvedValue([...oldIds, retryId, freshId]);
    const historyService = makeService(historyMail.client, files);
    const history = await historyService.ingestCycle({ config: configForSubject(), allowWait: false });
    expect(history).toMatchObject({ scanned: 1_003, selected: 2, newSelected: 1, retrySelected: 1, applied: 2 });
    expect(historyMail.getMessage).toHaveBeenCalledTimes(2);
    expect(await repository.readImportMessage(oldIds[0]!)).toMatchObject({ outcome: 'INVALID' });
    expect(await repository.readImportMessage(retryId)).toMatchObject({ outcome: 'APPLIED' });
    expect(await repository.readImportMessage(freshId)).toMatchObject({ outcome: 'APPLIED' });
  });

  it('keeps an unclassified row readable while excluding it from groups', async () => {
    const imageBytes = await validImageBytes();
    const fixture = fixtureMessage({
      id: `${messagePrefix}unclassified`,
      itemId: 670,
      list: 'List-A',
      modified: baseModified,
      imageNames: [],
      imageBytes,
      partNumber: null,
      shootingTarget: null,
    });
    const mail = mailbox([fixture]);
    const service = makeService(mail.client, files);
    await expect(service.ingestMessage({ config: configForSubject(), allowWait: false, messageId: fixture.message.id })).resolves.toMatchObject({ applied: 1 });
    const fixtureRows = (await repository.readRows({ limit: 100, offset: 0 }))
      .filter((row) => row.source.system === sourceSystem);
    const classifiedFixtureRows = (await repository.readRows({ includeUnclassified: false, limit: 100, offset: 0 }))
      .filter((row) => row.source.system === sourceSystem);
    const fixtureGroups = (await repository.readGroups({ limit: 100, offset: 0 }))
      .filter((group) => group.partNumber === fixturePartNumber || group.shootingTarget === fixtureShootingTarget);
    expect(fixtureRows).toHaveLength(1);
    expect(classifiedFixtureRows).toHaveLength(0);
    expect(fixtureGroups).toHaveLength(0);
  });
});
