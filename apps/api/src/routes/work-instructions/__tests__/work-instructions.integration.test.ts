import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { FileStorageIntegrityCatalog } from '../../../services/file-storage/file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../../../services/file-storage/local-durable-file-store.js';
import { WorkInstructionFileStoreAdapter } from '../../../services/work-instructions/work-instruction-file-store.adapter.js';
import { WorkInstructionReadService } from '../../../services/work-instructions/work-instruction-read.service.js';
import { PrismaWorkInstructionRepository } from '../../../services/work-instructions/repositories/prisma-work-instruction.repository.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from '../../__tests__/helpers.js';
import { registerWorkInstructionRoutes } from '../index.js';

const integrationEnabled = process.env.WORK_INSTRUCTION_INTEGRATION === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

if (integrationEnabled) {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(databaseUrl)) {
    throw new Error('WORK_INSTRUCTION_INTEGRATION requires a disposable loopback DATABASE_URL');
  }
}

describeIntegration('work-instruction Fastify API with Prisma and durable files', () => {
  const fixtureSystem = `SharePoint-API-${process.pid}-${Date.now()}`;
  const assetId = randomUUID();
  const storageKey = `work-instruction-assets/${assetId}`;
  const bytes = Buffer.from('api-original-image-bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const repository = new PrismaWorkInstructionRepository();
  const app = Fastify();
  let securedApp: Awaited<ReturnType<typeof buildServer>>;
  let storageRoot = '';
  let clientDeviceId = '';
  let clientApiKey = '';
  let viewerUserId = '';
  let viewerToken = '';
  let adminUserId = '';
  let adminToken = '';

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rps-wi-api-'));
    const localStore = new LocalDurableFileStore(
      storageRoot,
      new FileStorageIntegrityCatalog(storageRoot),
      { minimumFreeBytes: 0 }
    );
    await localStore.initialize(['work-instruction-assets', '.integrity']);
    const files = new WorkInstructionFileStoreAdapter(localStore);
    const staged = await repository.stageAssets({
      assets: [{
        assetId,
        imageName: '640_photo.jpeg',
        storageKey,
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
        sha256,
      }],
    });
    await files.writeStagedAssets(staged, new Map([[assetId, bytes]]));
    await repository.applyPacket({
      packet: {
        source: {
          system: fixtureSystem,
          list: 'List-A',
          itemId: 640,
          modified: new Date('2026-08-29T00:00:00Z'),
        },
        partNumber: 'MD004121632',
        shootingTarget: '研削',
        rawManifest: { schema_version: 1 },
        contentHash: 'a'.repeat(64),
        steps: [{
          step: 1,
          text: 'API boundary',
          imageName: '640_photo.jpeg',
          imageHash: sha256,
        }],
      },
      stagedAssets: staged,
    });

    const job = {
      id: '00000000-0000-0000-0000-000000000640',
      type: 'WORK_INSTRUCTION_GMAIL',
      status: 'PENDING' as const,
      summary: {},
      createdAt: new Date('2026-08-29T00:00:00Z'),
      completedAt: null,
    };
    registerWorkInstructionRoutes(app, {
      services: {
        ingestion: {
          startJob: vi.fn(async () => job),
          getJob: vi.fn(async () => job),
        },
        read: new WorkInstructionReadService(repository, files),
      },
      managePreHandler: async () => undefined,
      readPreHandler: async () => undefined,
    });
    await app.ready();

    const client = await createTestClientDevice();
    const viewer = await createTestUser('VIEWER');
    const admin = await createTestUser('ADMIN');
    clientDeviceId = client.id;
    clientApiKey = client.apiKey;
    viewerUserId = viewer.user.id;
    viewerToken = viewer.token;
    adminUserId = admin.user.id;
    adminToken = admin.token;
    securedApp = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await securedApp.close();
    await prisma.workInstructionRow.deleteMany({ where: { sourceSystem: fixtureSystem } });
    await prisma.workInstructionAsset.deleteMany({ where: { id: assetId, steps: { none: {} } } });
    await prisma.clientDevice.deleteMany({ where: { id: clientDeviceId } });
    await prisma.user.deleteMany({ where: { id: { in: [viewerUserId, adminUserId] } } });
    await prisma.$disconnect();
    if (storageRoot) await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it('returns grouped rows and original asset bytes and starts an asynchronous job', async () => {
    const group = await app.inject({
      method: 'GET',
      url: '/work-instructions/group?partNumber=md004121632&resource=%E7%A0%94%E5%89%8A%E5%B7%A5%E7%A8%8B',
    });
    expect(group.statusCode).toBe(200);
    expect(group.json()).toMatchObject({
      partNumber: 'MD004121632',
      shootingTarget: '研削',
      steps: [{
        step: 1,
        imageUrl: `/api/work-instructions/assets/${assetId}`,
      }],
    });
    expect(JSON.stringify(group.json())).not.toContain(storageKey);

    const rows = await app.inject({ method: 'GET', url: '/work-instructions/rows' });
    expect(rows.statusCode).toBe(200);
    expect(rows.json().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ system: fixtureSystem, itemId: 640 }) }),
    ]));

    const asset = await app.inject({ method: 'GET', url: `/work-instructions/assets/${assetId}` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('image/jpeg');
    expect(asset.rawPayload).toEqual(bytes);

    const ingest = await app.inject({ method: 'POST', url: '/work-instructions/ingest', payload: {} });
    expect(ingest.statusCode).toBe(202);
    expect(ingest.json()).toEqual({
      jobId: '00000000-0000-0000-0000-000000000640',
      status: 'PENDING',
    });
  });

  it('enforces content and management authorization on the default API wiring', async () => {
    expect((await securedApp.inject({
      method: 'GET',
      url: '/api/work-instructions/groups',
    })).statusCode).toBe(401);

    const deviceRead = await securedApp.inject({
      method: 'GET',
      url: '/api/work-instructions/groups',
      headers: { 'x-client-key': clientApiKey },
    });
    expect(deviceRead.statusCode).toBe(200);
    expect(deviceRead.json().groups).toContainEqual(expect.objectContaining({
      partNumber: 'MD004121632',
      shootingTarget: '研削',
    }));

    expect((await securedApp.inject({
      method: 'GET',
      url: '/api/work-instructions/ingest/messages',
      headers: createAuthHeader(viewerToken),
    })).statusCode).toBe(403);

    expect((await securedApp.inject({
      method: 'GET',
      url: '/api/work-instructions/ingest/messages',
      headers: createAuthHeader(adminToken),
    })).statusCode).toBe(200);
  });
});
