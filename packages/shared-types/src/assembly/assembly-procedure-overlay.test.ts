import { describe, expect, it } from 'vitest';

import {
  assemblyProcedureOverlayBBoxSchema,
  assemblyProcedureOverlayElementInputSchema,
  assemblyProcedureOverlayRegionInputSchema,
  assemblyProcedureOverlaySaveInputSchema
} from './assembly-procedure-overlay.js';

describe('assembly procedure overlay schemas', () => {
  it('accepts a normalized bbox and rejects an out-of-page bbox', () => {
    expect(
      assemblyProcedureOverlayBBoxSchema.parse({
        xRatio: '0.1',
        yRatio: 0.2,
        widthRatio: 0.3,
        heightRatio: 0.4
      })
    ).toEqual({
      xRatio: 0.1,
      yRatio: 0.2,
      widthRatio: 0.3,
      heightRatio: 0.4
    });

    expect(() =>
      assemblyProcedureOverlayBBoxSchema.parse({
        xRatio: 0.8,
        yRatio: 0,
        widthRatio: 0.3,
        heightRatio: 0.2
      })
    ).toThrow();
  });

  it('parses each discriminated overlay variant with defaults', () => {
    expect(
      assemblyProcedureOverlayElementInputSchema.parse({
        kind: 'TEXT',
        pageIndex: 0,
        bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.4, heightRatio: 0.2 },
        text: '検査'
      })
    ).toMatchObject({ kind: 'TEXT', text: '検査', zIndex: 0, opacity: 1 });

    expect(
      assemblyProcedureOverlayElementInputSchema.parse({
        kind: 'IMAGE',
        pageIndex: 1,
        bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 },
        assetId: 'asset-1'
      })
    ).toMatchObject({ kind: 'IMAGE', assetId: 'asset-1', objectFit: 'contain' });

    expect(
      assemblyProcedureOverlayElementInputSchema.parse({
        kind: 'SHAPE',
        pageIndex: 2,
        bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 },
        shape: 'ARROW',
        start: { xRatio: 0.2, yRatio: 0.2 },
        end: { xRatio: 0.6, yRatio: 0.6 }
      })
    ).toMatchObject({ kind: 'SHAPE', shape: 'ARROW' });
  });

  it('shares the same bbox contract for save and region requests', () => {
    const bbox = { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5 };
    expect(
      assemblyProcedureOverlayRegionInputSchema.parse({ pageIndex: '3', bbox })
    ).toMatchObject({ pageIndex: 3, bbox });
    expect(
      assemblyProcedureOverlaySaveInputSchema.parse({
        expectedEditVersion: '2',
        elements: [{ kind: 'TEXT', pageIndex: 0, bbox, text: '更新' }]
      })
    ).toMatchObject({ expectedEditVersion: 2, accessPassword: '' });
  });
});
