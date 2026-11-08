import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), render: vi.fn(async () => Buffer.from('image')) }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { visualizationDashboard: { findUnique: mocks.findUnique } } }));
vi.mock('../../../lib/device-or-viewer.js', () => ({ requireDeviceKeyOrViewer: vi.fn() }));
vi.mock('../../../services/signage/signage.renderer.js', () => ({ SignageRenderer: class { renderVisualizationToBuffer = mocks.render; } }));
import { registerVisualizationImageRoute } from '../visualization-image.js';

const url = '/visualization-image/11111111-1111-4111-8111-111111111111';
describe('visualization image existence', () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(() => { vi.clearAllMocks(); app = Fastify(); registerVisualizationImageRoute(app, {} as never); });
  afterEach(async () => { await app.close(); });
  it('returns 404 without rendering an unknown dashboard', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await app.inject({ url })).statusCode).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('keeps cache and concurrent render deduplication for an existing dashboard', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'dashboard' });
    const results = await Promise.all([app.inject({ url }), app.inject({ url })]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    expect((await app.inject({ url })).body).toBe('image');
    expect(mocks.render).toHaveBeenCalledOnce();
    mocks.findUnique.mockResolvedValue(null);
    expect((await app.inject({ url })).statusCode).toBe(404);
    expect(mocks.render).toHaveBeenCalledOnce();
  });
});
