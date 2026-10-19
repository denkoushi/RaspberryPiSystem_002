import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const renderCanvasPreviewToBufferMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/kiosk-document-auth.js', () => ({
  authorizeKioskClientKeyOrJwtRoles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/signage/signage.renderer.js', () => ({
  SignageRenderer: class {
    renderCanvasPreviewToBuffer = renderCanvasPreviewToBufferMock;
  },
}));

import { registerCanvasPreviewRoute } from './canvas-preview.js';

describe('canvas preview route', () => {
  it('returns a non-success response when a visualization element cannot render', async () => {
    renderCanvasPreviewToBufferMock.mockRejectedValueOnce(new Error('renderer unavailable'));
    const app = Fastify();
    registerCanvasPreviewRoute(app, {} as never);

    const response = await app.inject({
      method: 'POST',
      url: '/canvas-preview',
      payload: {
        width: 1920,
        height: 1080,
        backgroundColor: '#020617',
        elements: [{
          id: 'kpi', kind: 'visualization', x: 0, y: 0, width: 900, height: 900,
          dataSourceType: 'production_schedule', dataSourceConfig: { view: 'kpi' },
          rendererType: 'kpi_cards', rendererConfig: {}
        }]
      }
    });

    expect(response.statusCode).toBe(500);
    expect(renderCanvasPreviewToBufferMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
