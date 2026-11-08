import { beforeEach, describe, expect, it, vi } from 'vitest';
type InterceptedRoute = { request: () => { url: () => string }; abort: () => unknown; continue: () => unknown };
const mocks = vi.hoisted(() => ({ route: vi.fn<(pattern: string, handler: (route: InterceptedRoute) => Promise<void>) => Promise<void>>(), setContent: vi.fn(), close: vi.fn(async () => undefined), screenshot: vi.fn(async () => Buffer.from('png')) }));
vi.mock('../playwright-browser-pool.js', () => ({ getSharedChromium: async () => ({ newContext: async () => ({ newPage: async () => mocks, close: mocks.close }) }) }));
vi.mock('../../html/loan-grid-document.js', () => ({ buildLoanGridHtmlDocument: () => '<html></html>' }));
import { PlaywrightLoanGridRasterizer } from '../playwright-loan-grid-rasterizer.js';
import type { LoanGridRenderRequest } from '../../loan-grid-rasterizer.port.js';

describe('loan grid browser network isolation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('installs interception before rendering and preserves screenshot output', async () => {
    const result = await new PlaywrightLoanGridRasterizer().render({ config: { width: 100, height: 50 }, layout: { overflowCount: 2 } } as LoanGridRenderRequest);
    expect(mocks.route.mock.invocationCallOrder[0]).toBeLessThan(mocks.setContent.mock.invocationCallOrder[0]!);
    expect(result).toMatchObject({ kind: 'raster_png', pngBuffer: Buffer.from('png'), overflowCount: 2 });
    const intercept = mocks.route.mock.calls[0]![1]!;
    for (const url of ['https://example.com/image', 'http://127.0.0.1/', 'file:///tmp/image']) {
      const route = { request: () => ({ url: () => url }), abort: vi.fn(), continue: vi.fn() };
      await intercept(route);
      expect(route.abort).toHaveBeenCalledOnce();
      expect(route.continue).not.toHaveBeenCalled();
    }
    for (const url of ['data:image/png;base64,AA==', 'about:blank']) {
      const route = { request: () => ({ url: () => url }), abort: vi.fn(), continue: vi.fn() };
      await intercept(route);
      expect(route.continue).toHaveBeenCalledOnce();
      expect(route.abort).not.toHaveBeenCalled();
    }
  });
});
