import type { BarcodeReaderTimingOptions } from './zxingVideoReader';

/**
 * キオスク画面共通の読取テンポ設定。
 * デフォルト(400/200ms)より短い間隔で再試行し、体感待ち時間を抑える。
 */
export const BARCODE_READER_OPTIONS_KIOSK_DEFAULT: BarcodeReaderTimingOptions = {
  timeBetweenScansMillis: 220,
  timeBetweenDecodingAttempts: 120,
};
