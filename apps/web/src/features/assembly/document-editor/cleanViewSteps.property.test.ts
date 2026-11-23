import fc from 'fast-check';
import { expect, it } from 'vitest';

import { buildCleanSteps } from './cleanViewSteps';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

it('preserves every text and assigns each photo exactly once when text exists', () => {
  const region = fc.record({ y: fc.integer({ min: 0, max: 9 }), height: fc.integer({ min: 1, max: 10 }) });
  fc.assert(fc.property(fc.array(region, { minLength: 1, maxLength: 20 }), fc.array(region, { maxLength: 20 }), (texts, photos) => {
    const base = ({ y, height }: { y: number; height: number }, id: string) => ({
      id, pageIndex: 0, zIndex: 0,
      bbox: { xRatio: 0.1, yRatio: y / 10, widthRatio: 0.2, heightRatio: Math.min(height, 10 - y) / 10 }
    });
    const elements: AssemblyProcedureOverlayElement[] = [
      ...texts.map((region, index) => ({ ...base(region, `text-${index}`), kind: 'TEXT' as const, text: '手順' })),
      ...photos.map((region, index) => ({ ...base(region, `photo-${index}`), kind: 'IMAGE' as const, assetId: `asset-${index}` }))
    ];
    const steps = buildCleanSteps(elements);
    expect(steps.map(step => step.id).sort()).toEqual(elements.filter(element => element.kind === 'TEXT').map(element => element.id).sort());
    expect(steps.flatMap(step => step.images.map(image => image.id)).sort())
      .toEqual(elements.filter(element => element.kind === 'IMAGE').map(element => element.id).sort());
  }));
});
