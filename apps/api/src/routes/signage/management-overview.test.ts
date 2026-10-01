import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { registerManagementOverviewRoutes } from './management-overview.js';

const rotation = { scheduleIds: ['s1', 's2'], currentIndex: 1, secondsUntilSwitch: 12, isFallback: false };
const service = { listSignageRenderClientApiKeys: vi.fn(), getRotationForClient: vi.fn() };

describe('signage management overview routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getRotationForClient.mockResolvedValue(rotation);
    resetSignageDeliveryTrackerForTests();
  });

  it('reports the last device fetch and rotation per client', async () => {
    service.listSignageRenderClientApiKeys.mockResolvedValue(['key-a', 'key-b']);
    recordSignageImageFetch('key-a', new Date('2026-10-01T05:00:20.000Z'));
    const app = Fastify();
    registerManagementOverviewRoutes(app, service as never);

    const response = await app.inject({ method: 'GET', url: '/management/overview' });

    expect(response.statusCode).toBe(200);
    expect(response.json().clients).toEqual([
      { apiKey: 'key-a', lastFetchedAt: '2026-10-01T05:00:20.000Z', rotation },
      { apiKey: 'key-b', lastFetchedAt: null, rotation },
    ]);
    expect(response.json().scheduleSwitchIntervalSeconds).toBeGreaterThan(0);
    await app.close();
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
