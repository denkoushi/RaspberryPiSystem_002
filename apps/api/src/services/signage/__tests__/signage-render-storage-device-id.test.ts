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

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('device ID render storage', () => {
  it('keeps terminal images isolated and reuses the same image after credential rotation', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signage-device-id-'));
    vi.stubEnv('SIGNAGE_RENDER_DIR', directory);
    const imageA = Buffer.from('terminal A');
    const imageB = Buffer.from('terminal B');
    await SignageRenderStorage.saveRenderedImageForClient(imageA, A);
    await SignageRenderStorage.saveRenderedImageForClient(imageB, B);
    expect(await SignageRenderStorage.readCurrentImage(A)).toEqual(imageA);
    expect(await SignageRenderStorage.readCurrentImage(B)).toEqual(imageB);
    expect(await SignageRenderStorage.readCurrentImage('fixture-old-api-key')).toBeNull();
    expect(await SignageRenderStorage.readCurrentImage('fixture-rotated-api-key')).toBeNull();
    expect(await SignageRenderStorage.readCurrentImage()).toBeNull();
    await expect(SignageRenderStorage.saveRenderedImageForClient(imageA, '../escape')).rejects.toThrow();
    await SignageRenderStorage.saveRenderedImageForClient(Buffer.from('updated A'), A);
    expect(await SignageRenderStorage.readCurrentImage(A)).toEqual(Buffer.from('updated A'));
    expect(await SignageRenderStorage.readCurrentImage(B)).toEqual(imageB);
  });
});
