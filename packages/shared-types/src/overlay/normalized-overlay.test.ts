import { describe, expect, it } from 'vitest';

import {
  overlayElementInputSchema,
  overlayRegionInputSchema,
  overlaySaveInputSchema,
  projectOverlayBBoxFromCrop,
  projectOverlayBBoxToCrop
} from './normalized-overlay.js';
import {
  clipOverlayLineToCrop,
  normalizeOverlayCropRect
} from './overlay-geometry.js';

describe('domain-neutral normalized overlay contract', () => {
  it('parses overlay variants and shared extraction/save inputs', () => {
    const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 };
    expect(
      overlayElementInputSchema.parse({
        kind: 'TEXT',
        pageIndex: 0,
        bbox,
        text: '加工'
      })
    ).toMatchObject({ kind: 'TEXT', zIndex: 0, opacity: 1 });
    expect(overlayRegionInputSchema.parse({ pageIndex: '2', bbox })).toMatchObject({
      pageIndex: 2,
      bbox
    });
    expect(
      overlaySaveInputSchema.parse({
        expectedEditVersion: '4',
        elements: [{ kind: 'TEXT', pageIndex: 0, bbox, text: '改訂' }]
      })
    ).toMatchObject({ expectedEditVersion: 4, accessPassword: '' });
  });

  it('projects bboxes in both directions without mutating source values', () => {
    const crop = { xRatio: 0.2, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.6 };
    const source = { xRatio: 0.3, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.3 };
    const local = projectOverlayBBoxToCrop(source, crop);
    expect(local).toMatchObject({ widthRatio: 0.4, heightRatio: 0.5 });
    expect(local?.xRatio).toBeCloseTo(0.2);
    expect(local?.yRatio).toBeCloseTo(1 / 6);
    expect(projectOverlayBBoxFromCrop(local!, crop)).toMatchObject(source);
    expect(projectOverlayBBoxFromCrop(local!, crop).xRatio).toBeCloseTo(source.xRatio);
    expect(projectOverlayBBoxFromCrop(local!, crop).yRatio).toBeCloseTo(source.yRatio);
  });

  it('normalizes and clips crop geometry in normalized coordinates', () => {
    const crop = normalizeOverlayCropRect(
      { xRatio: 0.8, yRatio: 0.8 },
      { xRatio: 0.8, yRatio: 0.8 }
    );
    expect(crop).toEqual({
      xRatio: 0.8,
      yRatio: 0.8,
      widthRatio: 0.02,
      heightRatio: 0.02
    });
    expect(
      clipOverlayLineToCrop(
        {
          start: { xRatio: 0, yRatio: 0.5 },
          end: { xRatio: 1, yRatio: 0.5 }
        },
        { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.5 }
      )
    ).toEqual({
      start: { xRatio: 0, yRatio: 0.5 },
      end: { xRatio: 1, yRatio: 0.5 }
    });
  });
});
