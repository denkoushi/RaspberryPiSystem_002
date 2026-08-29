import { describe, expect, it } from 'vitest';

import { toRowDto } from '../dto.js';

describe('work-instruction response DTOs', () => {
  it('exposes an asset API URL without leaking the internal storage key', () => {
    const dto = toRowDto({
      id: 'row-1',
      source: {
        system: 'SharePoint',
        list: 'WorkInstructions',
        itemId: 640,
        modified: new Date('2026-08-29T00:00:00Z'),
      },
      partNumber: 'PART-1',
      shootingTarget: '研削',
      contentHash: 'hash',
      rawManifest: { schema_version: 1 },
      steps: [{
        id: 'step-1',
        step: 1,
        text: '確認',
        imageName: 'photo.webp',
        imageAssetId: 'asset-1',
        imageStorageKey: 'work-instruction-assets/asset-1',
        imageMimeType: 'image/webp',
        imageSha256: 'a'.repeat(64),
      }],
      createdAt: new Date('2026-08-29T00:00:00Z'),
      updatedAt: new Date('2026-08-29T00:00:00Z'),
    });

    expect(dto.steps[0]).toMatchObject({
      imageAssetId: 'asset-1',
      imageUrl: '/api/work-instructions/assets/asset-1',
    });
    expect(dto.steps[0]).not.toHaveProperty('imageStorageKey');
  });
});
