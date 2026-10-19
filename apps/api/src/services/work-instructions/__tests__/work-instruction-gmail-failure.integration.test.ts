import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { defaultBackupConfig, type BackupConfig } from '../../backup/backup-config.js';
import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { prisma } from '../../../lib/prisma.js';
import { FileStorageIntegrityCatalog } from '../../file-storage/file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../../file-storage/local-durable-file-store.js';
import type { WorkInstructionImportJob, WorkInstructionGmailPort } from '../work-instruction-gmail-ingestion.service.js';
import { WorkInstructionGmailIngestionService } from '../work-instruction-gmail-ingestion.service.js';
import type { ImportJobStore } from '../work-instruction-import-job.store.js';
import { WorkInstructionFileStoreAdapter, type WorkInstructionFileStorePort } from '../work-instruction-file-store.adapter.js';
import { PrismaWorkInstructionRepository } from '../repositories/prisma-work-instruction.repository.js';
import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';

const integrationEnabled = process.env.WORK_INSTRUCTION_INTEGRATION === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

if (integrationEnabled) {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(databaseUrl)) {
    throw new Error('WORK_INSTRUCTION_INTEGRATION requires a disposable loopback DATABASE_URL');
  }
}

const fixtureToken = `WIF-${process.pid}-${Date.now()}`;
const sourceSystem = `SharePoint-${fixtureToken}`;
const messagePrefix = `gmail-${fixtureToken}-`;
// readRows is intentionally a cross-source query, so keep this integration
// fixture's group key unique even when another suite uses the same database.
const fixturePartNumber = `WI-${fixtureToken}`;
const fixtureShootingTarget = `target-${fixtureToken}`;
const assetIds = new Set<string>();
const baseModified = new Date('2026-08-29T00:00:00.000Z');
const config: BackupConfig = {
  ...defaultBackupConfig,
  workInstructionGmailIngest: {
    enabled: true,
    subjectTokens: ['[Kakou-Dandori-photo]'],
    fromEmail: 'sharepoint@example.com',
  },
};

type Fixture = {
  message: GmailMessage;
  attachments: Map<string, Buffer>;
  bytes: Buffer;
};

function memoryJobStore(): ImportJobStore {
  const jobs = new Map<string, WorkInstructionImportJob>();
  return {
    async create(input) {
      const job: WorkInstructionImportJob = {
        id: randomUUID(), type: input.type, status: input.status, summary: input.summary,
        createdAt: new Date(), completedAt: null,
      };
      jobs.set(job.id, job);
      return job;
    },
    async update(id, input) {
      const current = jobs.get(id);
      if (!current) throw new Error(`unknown job ${id}`);
      const updated = { ...current, status: input.status, summary: input.summary,
        ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }) };
      jobs.set(id, updated);
      return updated;
    },
    async find(id, type) {
      const job = jobs.get(id);
      return job?.type === type ? job : null;
    },
  };
}

function trackedRepository(delegate: WorkInstructionRepository): WorkInstructionRepository {
  const stageAssets = delegate.stageAssets.bind(delegate);
  return new Proxy(delegate, {
    get(target, property, receiver) {
      if (property === 'stageAssets') {
        return async (input: Parameters<WorkInstructionRepository['stageAssets']>[0]) => {
          const staged = await stageAssets(input);
          staged.forEach((asset) => assetIds.add(asset.assetId));
          return staged;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as WorkInstructionRepository;
}

function makeService(
  gmail: WorkInstructionGmailPort,
  files: WorkInstructionFileStorePort,
  repository: WorkInstructionRepository = new PrismaWorkInstructionRepository(),
): WorkInstructionGmailIngestionService {
  return new WorkInstructionGmailIngestionService({
    repository: trackedRepository(repository),
    fileStore: files,
    jobStore: memoryJobStore(),
    gmailFactory: async () => gmail,
  });
}

function fixtureMessage(input: { id: string; itemId: number; bytes: Buffer }): Fixture {
  const manifestAttachmentId = `${input.id}-manifest`;
  const imageAttachmentId = `${input.id}-image`;
  const manifest = {
    schema_version: 1,
    source: {
      system: sourceSystem,
      list: 'List-A',
      item_id: input.itemId,
      modified: baseModified.toISOString(),
    },
    part_number: fixturePartNumber,
    shooting_target: fixtureShootingTarget,
    steps: [{ step: 1, text: 'failure fixture', image: 'photo.jpeg' }],
  };
  const attachments = new Map<string, Buffer>([
    [manifestAttachmentId, Buffer.from(JSON.stringify(manifest), 'utf8')],
    [imageAttachmentId, input.bytes],
  ]);
  return {
    message: {
      id: input.id, threadId: `${input.id}-thread`, labelIds: ['UNREAD', 'INBOX'], snippet: '', internalDateMs: baseModified.getTime(),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject', value: `[Kakou-Dandori-photo] ${input.id}` },
          { name: 'From', value: 'SharePoint <sharepoint@example.com>' },
        ],
        parts: [
          { filename: `${input.itemId}_manifest.json`, mimeType: 'application/json', body: { attachmentId: manifestAttachmentId }, headers: [{ name: 'Content-Disposition', value: 'attachment' }] },
          { filename: 'photo.jpeg', mimeType: 'application/octet-stream', body: { attachmentId: imageAttachmentId }, headers: [{ name: 'Content-Disposition', value: 'attachment' }] },
        ],
      },
    },
    attachments,
    bytes: input.bytes,
  };
}

function mailbox(fixture: Fixture): WorkInstructionGmailPort {
  return {
    searchMessagesAll: vi.fn(async () => [fixture.message.id]),
    getMessage: vi.fn(async (messageId: string) => {
      if (messageId !== fixture.message.id) throw new Error(`unknown message ${messageId}`);
      return fixture.message;
    }),
    getAttachment: vi.fn(async (_messageId: string, attachmentId: string) => {
      const bytes = fixture.attachments.get(attachmentId);
      if (!bytes) throw new Error(`unknown attachment ${attachmentId}`);
      return bytes;
    }),
    markAsRead: vi.fn(async () => undefined),
    trashMessage: vi.fn(async () => undefined),
  };
}

async function cleanupFixtures(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.workInstructionRow.findMany({
      where: { sourceSystem },
      select: { id: true, steps: { select: { assetId: true } } },
    });
    const ids = new Set(assetIds);
    rows.forEach((row) => row.steps.forEach((step) => {
      if (step.assetId) ids.add(step.assetId);
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
    if (ids.size > 0) {
      await tx.workInstructionAsset.deleteMany({
        where: {
          id: { in: [...ids] },
          steps: { none: {} },
          sourceVersionSteps: { none: {} },
        },
      });
    }
    await tx.workInstructionImportMessage.deleteMany({ where: { gmailMessageId: { startsWith: messagePrefix } } });
  });
  assetIds.clear();
}

describeIntegration('work-instruction ingest failure boundaries (isolated integration)', () => {
  const repository = new PrismaWorkInstructionRepository();
  let storageRoot: string;
  let localStore: LocalDurableFileStore;
  let files: WorkInstructionFileStoreAdapter;

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rps-wi-failure-'));
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

  it('leaves a staged asset recoverable when the filesystem write fails before apply', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).jpeg().toBuffer();
    const fixture = fixtureMessage({ id: `${messagePrefix}write-fail`, itemId: 680, bytes });
    const gmail = mailbox(fixture);
    const failingFiles: WorkInstructionFileStorePort = {
      writeStagedAssets: vi.fn(async () => { throw new Error('simulated filesystem write failure'); }),
      read: files.read.bind(files),
      delete: files.delete.bind(files),
    };
    const service = makeService(gmail, failingFiles, repository);
    const result = await service.ingestMessage({ config, allowWait: false, messageId: fixture.message.id });
    expect(result).toMatchObject({ retryable: 1, applied: 0, acknowledged: 0 });
    expect(await repository.readRows({ limit: 10, offset: 0, partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget })).toHaveLength(0);
    const stagedId = [...assetIds][0]!;
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: stagedId } })).toMatchObject({ status: 'STAGED' });
    const cleanup = await service.cleanupAssets(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(cleanup).toMatchObject({ deleted: 1, failed: 0 });
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: stagedId } })).toBeNull();
  });

  it('keeps the row unchanged and collects a staged asset after DB apply failure', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).jpeg().toBuffer();
    const fixture = fixtureMessage({ id: `${messagePrefix}db-fail`, itemId: 681, bytes });
    const failingRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === 'applyPacket') return async () => { throw new Error('simulated database apply failure'); };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as WorkInstructionRepository;
    const gmail = mailbox(fixture);
    const service = makeService(gmail, files, failingRepository);
    const result = await service.ingestMessage({ config, allowWait: false, messageId: fixture.message.id });
    expect(result).toMatchObject({ retryable: 1, applied: 0, acknowledged: 0 });
    expect(await repository.readRows({ limit: 10, offset: 0, partNumber: fixturePartNumber, shootingTarget: fixtureShootingTarget })).toHaveLength(0);
    const stagedId = [...assetIds][0]!;
    const staged = await prisma.workInstructionAsset.findUnique({ where: { id: stagedId } });
    expect(staged).toMatchObject({ status: 'STAGED' });
    await expect(files.read({ storageKey: staged!.storageKey })).resolves.toEqual(bytes);
    const cleanup = await service.cleanupAssets(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(cleanup).toMatchObject({ deleted: 1, failed: 0 });
    await expect(localStore.stat(staged!.storageKey)).rejects.toThrow();
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: stagedId } })).toBeNull();
  });

  it('keeps the DELETE_PENDING record after file delete failure and retries it later', async () => {
    const bytes = Buffer.from('orphan-failure-fixture');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const asset = {
      assetId: `${fixtureToken}-delete-fail`,
      imageName: 'orphan.jpeg',
      storageKey: `work-instruction-assets/${fixtureToken}/orphan.jpeg`,
      mimeType: 'image/jpeg' as const,
      sizeBytes: bytes.length,
      sha256: digest,
    };
    const staged = await repository.stageAssets({ assets: [asset], now: new Date(baseModified.getTime() - 2 * 60 * 60 * 1000) });
    assetIds.add(asset.assetId);
    await files.writeStagedAssets(staged, new Map([[asset.assetId, bytes]]));
    let failDelete = true;
    const flakyFiles: WorkInstructionFileStorePort = {
      writeStagedAssets: files.writeStagedAssets.bind(files),
      read: files.read.bind(files),
      delete: vi.fn(async (candidate) => {
        if (failDelete) {
          failDelete = false;
          throw new Error('simulated delete failure');
        }
        return files.delete(candidate);
      }),
    };
    const service = makeService(mailbox(fixtureMessage({ id: `${messagePrefix}delete-fail`, itemId: 682, bytes })), flakyFiles, repository);
    const first = await service.cleanupAssets(baseModified);
    expect(first).toMatchObject({ deleted: 0, failed: 1 });
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: asset.assetId } })).toMatchObject({ status: 'DELETE_PENDING' });
    await expect(localStore.stat(asset.storageKey)).resolves.toBeTruthy();
    const second = await service.cleanupAssets(new Date(baseModified.getTime() + 60 * 60 * 1000));
    expect(second).toMatchObject({ deleted: 1, failed: 0 });
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: asset.assetId } })).toBeNull();
    await expect(localStore.stat(asset.storageKey)).rejects.toThrow();
  });
});
