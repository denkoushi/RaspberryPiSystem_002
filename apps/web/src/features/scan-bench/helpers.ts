import { BarcodeFormat } from '@zxing/library';

import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE } from '../barcode-scan/formatPresets';

export type ScanEngine = 'zxing' | 'native';
export type CameraQuality = 'standard' | 'high';
export type ScanRecord = {
  engine: ScanEngine;
  quality: CameraQuality;
  elapsedMs: number;
  value: string | null;
  format: string | null;
};
export const ENGINE_LABELS = { zxing: '今の読み方', native: '高速読取' };
/** standard は本番の getCameraStream と同じ 640x480 上限。 */
export const CAMERA_QUALITY: Record<CameraQuality, { label: string; video: MediaTrackConstraints }> = {
  standard: { label: '今と同じ画質', video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 } } },
  high: { label: '高画質', video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
};
export const ZXING_FORMATS = [...BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE, BarcodeFormat.QR_CODE];
export const FORMAT_PAIRS = [
  [BarcodeFormat.CODE_128, 'code_128'],
  [BarcodeFormat.CODE_39, 'code_39'],
  [BarcodeFormat.ITF, 'itf'],
  [BarcodeFormat.EAN_13, 'ean_13'],
  [BarcodeFormat.EAN_8, 'ean_8'],
  [BarcodeFormat.UPC_A, 'upc_a'],
  [BarcodeFormat.UPC_E, 'upc_e'],
  [BarcodeFormat.QR_CODE, 'qr_code'],
] as const;
export const NATIVE_FORMATS = FORMAT_PAIRS.map(([, native]) => native);
export const toNativeFormat = (format: BarcodeFormat) => FORMAT_PAIRS.find(([zxing]) => zxing === format)?.[1];
export const toZxingFormat = (format: string) => FORMAT_PAIRS.find(([, native]) => native === format)?.[0];
export const supportsRequiredFormats = (formats: readonly string[]) => NATIVE_FORMATS.every((format) => formats.includes(format));
export const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(1)}秒`;

export function scanStats(records: ScanRecord[]) {
  const times = records.filter((record) => record.value !== null).map((record) => record.elapsedMs).sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return {
    count: records.length,
    successes: times.length,
    timeouts: records.length - times.length,
    median: times.length ? (times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2) : null,
    fastest: times[0] ?? null,
    slowest: times[times.length - 1] ?? null,
  };
}
