import { describe, expect, it } from 'vitest';

import { formatPhotoToolEmbeddingFingerprint } from '../photo-tool-embedding-fingerprint.js';

describe('formatPhotoToolEmbeddingFingerprint', () => {
  it('formats host model pipeline and dim without secrets', () => {
    expect(
      formatPhotoToolEmbeddingFingerprint({
        embeddingUrl: 'http://100.118.82.72:38081/embed',
        modelId: 'clip-ViT-B-32',
        pipelineVersion: 'vision_jpeg_v1',
        dimension: 512,
      })
    ).toBe('urlHost=100.118.82.72:38081 modelId=clip-ViT-B-32 dim=512 pipeline=vision_jpeg_v1');
  });
});
