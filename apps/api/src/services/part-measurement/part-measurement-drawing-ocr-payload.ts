import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const PART_MEASUREMENT_DRAWING_OCR_VERSION = 'pm-drawing-ocr-v1';
export const PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION = 1;
export const PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_ENCODING = 'gzip+json';

export type PartMeasurementDrawingOcrToken = {
  text: string;
  confidence: number | null;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  passId: string;
  passKind: 'full' | 'tile';
  rotation: number;
};

export type PartMeasurementDrawingOcrPayload = {
  schemaVersion: typeof PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION;
  ocrVersion: typeof PART_MEASUREMENT_DRAWING_OCR_VERSION;
  engine: string;
  createdAt: string;
  image: {
    width: number;
    height: number;
  };
  tokens: PartMeasurementDrawingOcrToken[];
};

export async function encodePartMeasurementDrawingOcrPayload(
  payload: PartMeasurementDrawingOcrPayload
): Promise<Buffer> {
  const json = JSON.stringify(payload);
  return gzipAsync(Buffer.from(json, 'utf8'));
}

export async function decodePartMeasurementDrawingOcrPayload(
  compressed: Buffer | Uint8Array
): Promise<PartMeasurementDrawingOcrPayload> {
  const json = (await gunzipAsync(Buffer.from(compressed))).toString('utf8');
  const parsed = JSON.parse(json) as PartMeasurementDrawingOcrPayload;
  if (parsed.schemaVersion !== PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(`Unsupported drawing OCR payload schemaVersion: ${String(parsed.schemaVersion)}`);
  }
  if (parsed.ocrVersion !== PART_MEASUREMENT_DRAWING_OCR_VERSION) {
    throw new Error(`Unsupported drawing OCR version: ${String(parsed.ocrVersion)}`);
  }
  return parsed;
}
