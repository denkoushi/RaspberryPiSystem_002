import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignageRenderStorage } from '../../../lib/signage-render-storage.js';

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) {
    for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
    await fs.rmdir(directory);
    directory = undefined;
  }
});

describe('device ID render storage', () => {
  it('keeps terminal images isolated and reuses the same image after credential rotation', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signage-device-id-'));
    vi.stubEnv('SIGNAGE_RENDER_DIR', directory);
    const imageA = Buffer.from('terminal A');
    const imageB = Buffer.from('terminal B');
    await SignageRenderStorage.saveRenderedImageForClient(imageA, 'device-a');
    await SignageRenderStorage.saveRenderedImageForClient(imageB, 'device-b');
    expect(await SignageRenderStorage.readCurrentImage('device-a')).toEqual(imageA);
    expect(await SignageRenderStorage.readCurrentImage('device-b')).toEqual(imageB);
    expect(await SignageRenderStorage.readCurrentImage('fixture-old-api-key')).toBeNull();
    expect(await SignageRenderStorage.readCurrentImage('fixture-rotated-api-key')).toBeNull();
    expect(await SignageRenderStorage.readCurrentImage()).toBeNull();
    await SignageRenderStorage.saveRenderedImageForClient(Buffer.from('updated A'), 'device-a');
    expect(await SignageRenderStorage.readCurrentImage('device-a')).toEqual(Buffer.from('updated A'));
    expect(await SignageRenderStorage.readCurrentImage('device-b')).toEqual(imageB);
  });
});
