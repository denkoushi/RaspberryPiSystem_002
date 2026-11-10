import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerPartMeasurementRoutes } from '../part-measurement/index.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';
import {
  encodePartMeasurementDrawingDimensionMapPayload,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION
} from '../../services/part-measurement/part-measurement-drawing-dimension-map-payload.js';
import { SIBLING_MATCH_VERSION } from '../../services/part-measurement/part-measurement-drawing-sibling-match.js';
import { PartMeasurementDrawingPlacementService, getPartMeasurementDrawingPlacementService } from '../../services/part-measurement/part-measurement-drawing-placement.service.js';

// Uses the migrated CI Postgres database, like part-measurement.integration.test.ts.
// Only image storage is stubbed; fingerprinting, map decoding, transactions and auth are real.
describe('placement proposals API / Postgres', () => {
  let app: ReturnType<typeof Fastify>;
  let client: Awaited<ReturnType<typeof createTestClientDevice>>;
  let viewer: Awaited<ReturnType<typeof createTestUser>>;
  let ids: string[];
  let targetId: string;
  let sourceId: string;
  let family: string;
  let image: Buffer;
  const semanticDefault = env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED;
  const url = () => `/api/part-measurement/visual-templates/${targetId}/placement-proposals`;
  const fingerprint = () => createHash('sha256').update(image).digest('hex');

  async function completedMap(visualTemplateId: string, hash = fingerprint()) {
    await prisma.partMeasurementDrawingSiblingMatch.create({ data: {
      visualTemplateId, drawingImageFingerprint: hash, matchVersion: SIBLING_MATCH_VERSION,
      status: 'MATCHED', method: 'dgx-vision', siblings: [{ visualTemplateId: sourceId, confidence: 0.9 }]
    } });
    return prisma.partMeasurementDrawingDimensionMap.create({
      data: {
        visualTemplateId, drawingImageFingerprint: hash, analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
        status: 'COMPLETED', payloadEncoding: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
        payloadCompressed: new Uint8Array(await encodePartMeasurementDrawingDimensionMapPayload({
          schemaVersion: 1, analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
          createdAt: new Date().toISOString(), image: { width: 2000, height: 1000 }, tiles: [],
          dimensions: [{
            text: '10±0.5', nominal: 10, upperTolerance: 0.5, lowerTolerance: -0.5, kind: 'len',
            depth: null, xRatio: 0.5, yRatio: 0.5, tileId: 'tile'
          }]
        }))
      }
    });
  }

  async function template(visualTemplateId: string, labels: string[], processGroup: 'CUTTING' | 'GRINDING' = 'CUTTING') {
    return prisma.partMeasurementTemplate.create({
      data: {
        visualTemplateId, name: family, fhincd: randomUUID(), resourceCd: 'PLACEMENT_TEST', processGroup,
        items: { create: labels.map((measurementLabel, sortOrder) => ({
          measurementLabel, sortOrder, datumSurface: 'A', measurementPoint: 'P',
          nominalValue: measurementLabel === 'missing' ? 99 : 10,
          lowerLimit: 9.5, upperLimit: 10.5, markerXRatio: 0.5, markerYRatio: 0.5
        })) }
      }
    });
  }

  beforeAll(async () => {
    client = await createTestClientDevice();
    viewer = await createTestUser('VIEWER');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(registerPartMeasurementRoutes, { prefix: '/api' });
    await app.ready();
  });

  beforeEach(async () => {
    // These cases cover the position transfer; semantic transfer needs the business LLM and is unit-tested.
    env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = false;
    ids = [randomUUID(), randomUUID()];
    [targetId, sourceId] = ids;
    family = `placement-${randomUUID()}`;
    image = Buffer.from(`drawing-${randomUUID()}`);
    vi.spyOn(PartMeasurementDrawingStorage, 'readDrawing').mockImplementation(async () => ({
      buffer: image, contentType: 'image/png'
    }));
    await prisma.partMeasurementVisualTemplate.createMany({
      data: ids.map((id, index) => {
        const name = `${index ? '足' : 'スタンド'} ${family}`;
        return { id, name, searchDigits: name.replace(/[^0-9]/g, ''), drawingImageRelativePath: `/api/storage/part-measurement-drawings/${id}.png` };
      })
    });
    await template(sourceId, ['長さ', '幅', 'missing']);
  });

  afterEach(async () => {
    env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = semanticDefault;
    vi.restoreAllMocks();
    await prisma.partMeasurementTemplate.deleteMany({ where: { visualTemplateId: { in: ids } } });
    await prisma.partMeasurementVisualTemplate.deleteMany({ where: { id: { in: ids } } });
  });
  afterAll(async () => {
    await app?.close();
    if (client) await prisma.clientDevice.delete({ where: { id: client.id } });
    if (viewer) await prisma.user.delete({ where: { id: viewer.user.id } });
    await prisma.$disconnect();
  });

  it('requires the same user token or client key as OCR candidates, and ignores stale maps', async () => {
    await completedMap(targetId, 'stale');
    expect((await app.inject({ method: 'GET', url: url() })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: url(), headers: { 'x-client-key': 'invalid' } })).statusCode).toBe(403);
    for (const headers of [createAuthHeader(viewer.token), { 'x-client-key': client.apiKey }]) {
      const response = await app.inject({ method: 'GET', url: url(), headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'map-pending', sourceDrawingName: null, proposals: [], unplaced: [] });
    }
    expect(await prisma.partMeasurementDrawingPlacementRun.count({ where: { visualTemplateId: targetId } })).toBe(0);
  });

  it('leaves semantic runs to the nightly backfill instead of creating them on request', async () => {
    env.INSPECTION_DRAWING_SEMANTIC_PLACEMENT_ENABLED = true;
    await completedMap(targetId);
    const response = await app.inject({ method: 'GET', url: url(), headers: { 'x-client-key': client.apiKey } });
    expect(response.json()).toEqual({ status: 'map-pending', sourceDrawingName: null, proposals: [], unplaced: [] });
    expect(await prisma.partMeasurementDrawingPlacementRun.count({ where: { visualTemplateId: targetId } })).toBe(0);
  });

  it('creates one versioned run under concurrent requests without creating template items', async () => {
    await completedMap(targetId);
    const requests = await Promise.all(Array.from({ length: 2 }, () => app.inject({
      method: 'GET', url: url(), headers: { 'x-client-key': client.apiKey }
    })));
    for (const response of requests) {
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ready');
      expect(body.sourceDrawingName).toContain(family);
      expect(body.proposals).toHaveLength(2);
      expect(body.proposals[0]).toMatchObject({
        measurementLabel: '長さ', measurementPoint: 'P', decimalPlaces: 6, nominalValue: 10, lowerLimit: 9.5, upperLimit: 10.5,
        depthMode: 'measured', valueKind: 'numeric', markerXRatio: 0.52, markerYRatio: 0.48, dimensionText: '10±0.5'
      });
      expect(body.unplaced).toEqual([{ id: expect.any(String), measurementLabel: 'missing', measurementPoint: 'P', decimalPlaces: 6, nominalValue: 99, lowerLimit: 9.5, upperLimit: 10.5, depthMode: 'measured', valueKind: 'numeric', reason: 'no-candidate' }]);
    }
    expect(requests[0].json()).toEqual(requests[1].json());
    expect(await prisma.partMeasurementDrawingPlacementRun.count({ where: { visualTemplateId: targetId } })).toBe(1);
    expect(await prisma.partMeasurementTemplateItem.count({ where: { template: { visualTemplateId: targetId } } })).toBe(0);
    // A changed image gets its own run rather than reusing proposals from the previous image.
    image = Buffer.from('replacement image');
    await completedMap(targetId);
    expect((await app.inject({ method: 'GET', url: url(), headers: createAuthHeader(viewer.token) })).json().status).toBe('ready');
    expect(await prisma.partMeasurementDrawingPlacementRun.count({ where: { visualTemplateId: targetId } })).toBe(2);
  });

  it('separates process runs and existing items, ignores v1 and never falls back across processes', async () => {
    await completedMap(targetId);
    await prisma.partMeasurementDrawingPlacementRun.create({ data: {
      visualTemplateId: targetId, drawingImageFingerprint: fingerprint(),
      analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION, placementVersion: 'transfer-v1', rankingMethod: 'position'
    } });
    await template(targetId, ['長さ'], 'GRINDING');
    const headers = { 'x-client-key': client.apiKey };
    const cutting = (await app.inject({ method: 'GET', url: url(), headers })).json();
    expect(cutting.status).toBe('ready');
    expect(cutting.proposals).toHaveLength(2);
    const grinding = (await app.inject({ method: 'GET', url: `${url()}?processGroup=grinding`, headers })).json();
    expect(grinding.status).toBe('no-sibling');
    expect(grinding.proposals).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `${url()}?processGroup=invalid`, headers })).statusCode).toBe(400);
    const runs = await prisma.partMeasurementDrawingPlacementRun.findMany({ where: { visualTemplateId: targetId, placementVersion: { startsWith: 'transfer-v2:' } } });
    expect(runs.map((run) => run.placementVersion).sort()).toEqual(['transfer-v2:CUTTING', 'transfer-v2:GRINDING']);
  });

  it('transfers and filters the grinding process independently of cutting', async () => {
    await completedMap(targetId);
    const source = await template(sourceId, ['長さ', '幅'], 'GRINDING');
    await template(targetId, ['長さ'], 'GRINDING');
    const headers = { 'x-client-key': client.apiKey };
    const result = (await app.inject({ method: 'GET', url: `${url()}?processGroup=grinding`, headers })).json();
    expect(result.status).toBe('ready');
    expect(result.proposals.map((row: { measurementLabel: string }) => row.measurementLabel)).toEqual(['幅']);
    const run = await prisma.partMeasurementDrawingPlacementRun.findFirstOrThrow({ where: { visualTemplateId: targetId } });
    expect(run.sourceTemplateId).toBe(source.id);
  });

  it('filters saved items, scopes decisions to the drawing and PROPOSED state, and is idempotent', async () => {
    await completedMap(targetId);
    const headers = { 'x-client-key': client.apiKey };
    const initial = (await app.inject({ method: 'GET', url: url(), headers })).json();
    await template(targetId, ['長さ']);
    const filtered = (await app.inject({ method: 'GET', url: url(), headers })).json();
    expect(filtered.proposals.map((p: { measurementLabel: string }) => p.measurementLabel)).toEqual(['幅']);
    const sourceRun = await prisma.partMeasurementDrawingPlacementRun.create({
      data: {
        visualTemplateId: sourceId, drawingImageFingerprint: 'foreign', analysisVersion: 'test', placementVersion: 'test',
        rankingMethod: 'position', proposals: { create: {
          visualTemplateId: sourceId, sourceItemId: 'foreign-item', sortOrder: 1, measurementLabel: '長さ', nominalValue: 10, candidates: []
        } }
      }, include: { proposals: true }
    });
    const payload = {
      approvedIds: [initial.proposals[0].id, sourceRun.proposals[0].id, initial.unplaced[0].id],
      rejectedIds: [initial.proposals[1].id]
    };
    expect((await app.inject({ method: 'POST', url: `${url()}/decisions`, payload })).statusCode).toBe(401);
    const decision = await app.inject({ method: 'POST', url: `${url()}/decisions`, headers, payload });
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toEqual({ updated: 2 });
    expect((await app.inject({ method: 'POST', url: `${url()}/decisions`, headers, payload })).json()).toEqual({ updated: 0 });
    const rows = await prisma.partMeasurementDrawingPlacementProposal.findMany({ where: { visualTemplateId: targetId } });
    expect(rows.filter((row) => row.decidedAt !== null)).toHaveLength(2);
    expect(rows.find((row) => row.id === initial.unplaced[0].id)?.status).toBe('UNPLACED');
    expect((await prisma.partMeasurementDrawingPlacementProposal.findUniqueOrThrow({
      where: { id: sourceRun.proposals[0].id }
    })).status).toBe('PROPOSED');
    expect((await app.inject({ method: 'GET', url: url(), headers })).json().proposals).toEqual([]);
  });

  it('caches no-sibling runs and cascades proposal ownership while setting deleted sources null', async () => {
    await completedMap(targetId);
    const headers = { 'x-client-key': client.apiKey };
    await prisma.partMeasurementVisualTemplate.update({ where: { id: sourceId }, data: { isActive: false } });
    const first = await app.inject({ method: 'GET', url: url(), headers });
    expect(first.json()).toEqual({ status: 'no-sibling', sourceDrawingName: null, proposals: [], unplaced: [] });
    await prisma.partMeasurementVisualTemplate.update({ where: { id: sourceId }, data: { isActive: true } });
    expect((await app.inject({ method: 'GET', url: url(), headers })).json()).toEqual(first.json());
    image = Buffer.from('new image with sibling');
    await completedMap(targetId);
    const current = (await app.inject({ method: 'GET', url: url(), headers })).json();
    expect(current.proposals).toHaveLength(2);
    await prisma.partMeasurementVisualTemplate.delete({ where: { id: sourceId } });
    const activeRun = await prisma.partMeasurementDrawingPlacementRun.findFirstOrThrow({
      where: { visualTemplateId: targetId, drawingImageFingerprint: fingerprint() }
    });
    expect(activeRun.sourceVisualTemplateId).toBeNull();
    expect(activeRun.sourceTemplateId).not.toBeNull();
    // Source template FK uses SetNull; clean up the now-detached fixture explicitly.
    await prisma.partMeasurementTemplate.delete({ where: { id: activeRun.sourceTemplateId! } });
    await prisma.partMeasurementVisualTemplate.delete({ where: { id: targetId } });
    expect(await prisma.partMeasurementDrawingPlacementRun.count({ where: { visualTemplateId: targetId } })).toBe(0);
    expect(await prisma.partMeasurementDrawingPlacementProposal.count({ where: { visualTemplateId: targetId } })).toBe(0);
  });

  it('backfills both matched processes and a single CUTTING run for NO_MATCH', async () => {
    await completedMap(targetId);
    await template(sourceId, ['長さ'], 'GRINDING');
    const service = getPartMeasurementDrawingPlacementService();
    await service.backfill(1000);
    const runs = await prisma.partMeasurementDrawingPlacementRun.findMany({ where: { visualTemplateId: targetId } });
    expect(runs.map((run) => run.placementVersion).sort()).toEqual(['transfer-v2:CUTTING', 'transfer-v2:GRINDING']);
    image = Buffer.from('no match image');
    await completedMap(targetId);
    await prisma.partMeasurementDrawingSiblingMatch.updateMany({
      where: { visualTemplateId: targetId, drawingImageFingerprint: fingerprint() },
      data: { status: 'NO_MATCH', siblings: [] }
    });
    await service.backfill(1000);
    const empty = await prisma.partMeasurementDrawingPlacementRun.findMany({
      where: { visualTemplateId: targetId, drawingImageFingerprint: fingerprint() }
    });
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ placementVersion: 'transfer-v2:CUTTING', sourceTemplateId: null });
  });

  it('retries a PENDING sibling match before an older never-visited drawing with batch limit 1', async () => {
    await completedMap(targetId);
    const pending = await prisma.partMeasurementDrawingSiblingMatch.updateMany({
      where: { visualTemplateId: targetId },
      data: { status: 'PENDING', attempts: 1, siblings: [], updatedAt: new Date(1000) }
    });
    expect(pending.count).toBe(1);
    const olderMap = await completedMap(sourceId);
    await prisma.partMeasurementDrawingDimensionMap.update({
      where: { id: olderMap.id }, data: { createdAt: new Date(0) }
    });
    await prisma.partMeasurementDrawingSiblingMatch.deleteMany({ where: { visualTemplateId: sourceId } });
    const matcher = { match: vi.fn().mockResolvedValue({ status: 'PENDING', method: null }) };
    const service = new PartMeasurementDrawingPlacementService(undefined, undefined, matcher as never);

    await service.backfill(1);

    expect(matcher.match).toHaveBeenCalledExactlyOnceWith(targetId);
  });

  it('backfills only the latest map without repeatedly selecting an older unhandled fingerprint', async () => {
    const oldMap = await completedMap(targetId, 'old-unhandled');
    await prisma.partMeasurementDrawingDimensionMap.update({ where: { id: oldMap.id }, data: { createdAt: new Date(0) } });
    await completedMap(targetId);
    const service = getPartMeasurementDrawingPlacementService();
    await service.ensureRun(targetId, { processGroup: 'CUTTING' });
    const ensure = vi.spyOn(service, 'ensureRun').mockResolvedValue({ status: 'map-pending', run: null });
    await service.backfill(1000);
    expect(ensure.mock.calls.map(([id]) => id)).not.toContain(targetId);
  });
});
