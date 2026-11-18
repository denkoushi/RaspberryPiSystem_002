import * as fc from 'fast-check';
import { expect, it } from 'vitest';

import { eraseText } from '../text-erase.js';

it('leaves a uniform image unchanged at any patch position and infers no ink', () => {
  fc.assert(fc.property(
    fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255)),
    fc.record({ left: fc.nat(15), top: fc.nat(15), width: fc.integer({ min: 1, max: 16 }), height: fc.integer({ min: 1, max: 16 }) }),
    (color, erase) => {
      const width = 32;
      const height = 32;
      const rgb = Uint8Array.from({ length: width * height * 3 }, (_, i) => color[i % 3]);
      expect(eraseText({ width, height, rgb, erase, candidates: [erase] })).toEqual({ rgb, color: '#000000' });
    }
  ));
});
