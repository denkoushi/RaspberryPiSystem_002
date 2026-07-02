import { afterEach, describe, expect, it } from 'vitest';

import { getImageOcrPort, resetImageOcrPortForTests, shutdownImageOcrPort } from './image-ocr-runtime.js';

describe('image OCR runtime', () => {
  afterEach(async () => {
    delete process.env.IMAGE_OCR_STUB_TEXT;
    await shutdownImageOcrPort();
    resetImageOcrPortForTests();
  });

  it('shutdownImageOcrPort clears the cached OCR adapter', async () => {
    process.env.IMAGE_OCR_STUB_TEXT = 'first';
    const first = getImageOcrPort();

    await shutdownImageOcrPort();
    process.env.IMAGE_OCR_STUB_TEXT = 'second';
    const second = getImageOcrPort();

    expect(second).not.toBe(first);
    await expect(
      second.runOcrOnImage({
        imageBytes: Buffer.from('stub'),
        mimeType: 'image/png'
      })
    ).resolves.toEqual({
      text: 'second',
      engine: 'stub'
    });
  });
});
