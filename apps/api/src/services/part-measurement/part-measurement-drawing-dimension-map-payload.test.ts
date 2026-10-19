import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  decodePartMeasurementDrawingDimensionMapPayload,
  encodePartMeasurementDrawingDimensionMapPayload,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
  type PartMeasurementDrawingDimensionMapPayload
} from './part-measurement-drawing-dimension-map-payload.js';

const payload: PartMeasurementDrawingDimensionMapPayload = {
  schemaVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION,
  analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
  createdAt: '2026-10-03T00:00:00.000Z',
  image: { width: 4000, height: 3000 },
  tiles: [{ id: 'r0c0', box: { x0: 0, y0: 0, x1: 0.35, y1: 0.52 }, status: 'ok', dimensionCount: 1 }],
  dimensions: [
    {
      text: '540±0.3',
      nominal: 540,
      upperTolerance: 0.3,
      lowerTolerance: -0.3,
      kind: 'len',
      depth: null,
      xRatio: 0.1,
      yRatio: 0.2,
      tileId: 'r0c0'
    }
  ]
};

describe('dimension map payload codec', () => {
  it('round-trips through gzip json', async () => {
    const encoded = await encodePartMeasurementDrawingDimensionMapPayload(payload);
    await expect(decodePartMeasurementDrawingDimensionMapPayload(encoded)).resolves.toEqual(payload);
  });

  it('rejects another analysis version', async () => {
    const other = gzipSync(Buffer.from(JSON.stringify({ ...payload, analysisVersion: 'pm-drawing-dimmap-v0' })));
    await expect(decodePartMeasurementDrawingDimensionMapPayload(other)).rejects.toThrow('Unsupported');
  });
});
