import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION = 'pm-drawing-dimmap-v1';
export const PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION = 1;
export const PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING = 'gzip+json';

export const PART_MEASUREMENT_DRAWING_DIMENSION_KINDS = [
  'len',
  'ref',
  'basic',
  'angle',
  'radius',
  'hole',
  'thread',
  'gdt',
  'other'
] as const;

export type PartMeasurementDrawingDimensionKind = (typeof PART_MEASUREMENT_DRAWING_DIMENSION_KINDS)[number];

export type PartMeasurementDrawingDimension = {
  /** 図面のとおりの表記（例 "φ10.1+0.1/0深15"） */
  text: string;
  nominal: number;
  upperTolerance: number | null;
  lowerTolerance: number | null;
  kind: PartMeasurementDrawingDimensionKind;
  depth: number | null;
  /** 図面画像全体に対する文字中心の位置（0〜1） */
  xRatio: number;
  yRatio: number;
  tileId: string;
};

export type PartMeasurementDrawingDimensionMapTileStatus = 'ok' | 'failed' | 'parse_failed';

export type PartMeasurementDrawingDimensionMapTile = {
  id: string;
  /** 図面画像全体に対する範囲（0〜1） */
  box: { x0: number; y0: number; x1: number; y1: number };
  status: PartMeasurementDrawingDimensionMapTileStatus;
  dimensionCount: number;
};

export type PartMeasurementDrawingDimensionMapPayload = {
  schemaVersion: typeof PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION;
  analysisVersion: typeof PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION;
  createdAt: string;
  image: { width: number; height: number };
  tiles: PartMeasurementDrawingDimensionMapTile[];
  dimensions: PartMeasurementDrawingDimension[];
};

export async function encodePartMeasurementDrawingDimensionMapPayload(
  payload: PartMeasurementDrawingDimensionMapPayload
): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(payload), 'utf8'));
}

export async function decodePartMeasurementDrawingDimensionMapPayload(
  compressed: Buffer | Uint8Array
): Promise<PartMeasurementDrawingDimensionMapPayload> {
  const json = (await gunzipAsync(Buffer.from(compressed))).toString('utf8');
  const parsed = JSON.parse(json) as PartMeasurementDrawingDimensionMapPayload;
  if (parsed.schemaVersion !== PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(`Unsupported drawing dimension map payload schemaVersion: ${String(parsed.schemaVersion)}`);
  }
  if (parsed.analysisVersion !== PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION) {
    throw new Error(`Unsupported drawing dimension map version: ${String(parsed.analysisVersion)}`);
  }
  return parsed;
}
