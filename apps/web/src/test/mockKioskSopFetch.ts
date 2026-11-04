import { beforeEach, vi } from 'vitest';

import assemblyHtml from '../generated/kiosk-sop/assembly-procedure-template/manual.html?raw';
import inspectionHtml from '../generated/kiosk-sop/inspection-drawing/manual.html?raw';

// Vitest resolves ?url to a path but jsdom does not serve Vite assets.
export function mockKioskSopFetch() {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes('/kiosk-sop/') || !url.endsWith('/manual.html')) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      return new Response(url.includes('/inspection-drawing/') ? inspectionHtml : assemblyHtml);
    });
  });
}
