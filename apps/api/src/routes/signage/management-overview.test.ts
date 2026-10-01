import { mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderCsvDashboardToBufferMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth.js', () => ({
  authorizeRoles: () => async () => undefined,
}));
vi.mock('../../services/signage/signage.renderer.js', () => ({
  SignageRenderer: class {
    renderCsvDashboardToBuffer = renderCsvDashboardToBufferMock;
  },
}));

import {
  recordSignageImageFetch,
  resetSignageDeliveryTrackerForTests,
} from '../../services/signage/signage-delivery-tracker.js';
import { readLastRenderedAt, registerManagementOverviewRoutes } from './management-overview.js';

const rotation = { scheduleIds: ['s1', 's2'], currentIndex: 1, secondsUntilSwitch: 12, isFallback: false };
const service = { listSignageRenderClientApiKeys: vi.fn(), getRotationForClient: vi.fn() };

describe('signage management overview routes', () => {
  let renderDir: string;
  const previousRenderDir = process.env.SIGNAGE_RENDER_DIR;

  beforeEach(async () => {
    vi.clearAllMocks();
    service.getRotationForClient.mockResolvedValue(rotation);
    resetSignageDeliveryTrackerForTests();
    renderDir = await mkdtemp(path.join(os.tmpdir(), 'signage-overview-'));
    process.env.SIGNAGE_RENDER_DIR = renderDir;
  });

  afterEach(async () => {
    if (previousRenderDir === undefined) delete process.env.SIGNAGE_RENDER_DIR;
    else process.env.SIGNAGE_RENDER_DIR = previousRenderDir;
    await rm(renderDir, { recursive: true, force: true });
  });

  it('reports the latest render time, and the last device fetch and rotation per client', async () => {
    const older = path.join(renderDir, `current-${'a'.repeat(64)}.jpg`);
    const newer = path.join(renderDir, `current-${'b'.repeat(64)}.jpg`);
    await writeFile(older, 'x');
    await writeFile(newer, 'x');
    await writeFile(path.join(renderDir, 'notes.txt'), 'ignored');
    await utimes(older, new Date('2026-10-01T04:59:00.000Z'), new Date('2026-10-01T04:59:00.000Z'));
    await utimes(newer, new Date('2026-10-01T05:00:00.000Z'), new Date('2026-10-01T05:00:00.000Z'));
    service.listSignageRenderClientApiKeys.mockResolvedValue(['key-a', 'key-b']);
    recordSignageImageFetch('key-a', new Date('2026-10-01T05:00:20.000Z'));
    const app = Fastify();
    registerManagementOverviewRoutes(app, service as never);

    const response = await app.inject({ method: 'GET', url: '/management/overview' });

    expect(response.statusCode).toBe(200);
    expect(response.json().lastRenderedAt).toBe('2026-10-01T05:00:00.000Z');
    expect(response.json().clients).toEqual([
      { apiKey: 'key-a', lastFetchedAt: '2026-10-01T05:00:20.000Z', rotation },
      { apiKey: 'key-b', lastFetchedAt: null, rotation },
    ]);
    await app.close();
  });

  it('returns null for the render time when nothing has been rendered or the folder is missing', async () => {
    await expect(readLastRenderedAt(renderDir)).resolves.toBeNull();
    await expect(readLastRenderedAt(path.join(renderDir, 'missing'))).resolves.toBeNull();
  });

  it('returns the CSV dashboard preview as a JPEG and rejects a non-uuid id', async () => {
    renderCsvDashboardToBufferMock.mockResolvedValue(Buffer.from('jpeg'));
    const app = Fastify();
    registerManagementOverviewRoutes(app, service as never);

    const ok = await app.inject({ method: 'GET', url: '/preview/csv-dashboard/11111111-1111-4111-8111-111111111111' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(renderCsvDashboardToBufferMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');

    const bad = await app.inject({ method: 'GET', url: '/preview/csv-dashboard/nope' });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(renderCsvDashboardToBufferMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
