import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderCsvDashboardToBufferMock = vi.hoisted(() => vi.fn());
const getCurrentImageRenderedAtMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/auth.js', () => ({
  authorizeRoles: () => async () => undefined,
}));
vi.mock('../../lib/signage-render-storage.js', () => ({
  SignageRenderStorage: { getCurrentImageRenderedAt: getCurrentImageRenderedAtMock },
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

const service = { listSignageRenderClientApiKeys: vi.fn() };

describe('signage management overview routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSignageDeliveryTrackerForTests();
  });

  it('reports render time and last device fetch per client, null when unknown', async () => {
    service.listSignageRenderClientApiKeys.mockResolvedValue(['key-a', 'key-b']);
    getCurrentImageRenderedAtMock.mockImplementation(async (key: string) =>
      key === 'key-a' ? new Date('2026-10-01T05:00:00.000Z') : null,
    );
    recordSignageImageFetch('key-a', new Date('2026-10-01T05:00:20.000Z'));
    const app = Fastify();
    registerManagementOverviewRoutes(app, service as never);

    const response = await app.inject({ method: 'GET', url: '/management/overview' });

    expect(response.statusCode).toBe(200);
    expect(response.json().clients).toEqual([
      { apiKey: 'key-a', renderedAt: '2026-10-01T05:00:00.000Z', lastFetchedAt: '2026-10-01T05:00:20.000Z' },
      { apiKey: 'key-b', renderedAt: null, lastFetchedAt: null },
    ]);
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
