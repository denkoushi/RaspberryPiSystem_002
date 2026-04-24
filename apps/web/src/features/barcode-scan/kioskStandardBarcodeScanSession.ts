import { BARCODE_READER_OPTIONS_KIOSK_DEFAULT } from './readerOptionPresets';

import type { BarcodeReaderTimingOptions } from './zxingVideoReader';

/**
 * キオスク標準のカメラバーコードセッション既定（reader の再試行間隔 + 無操作タイムアウト）。
 *
 * - **即時確定**が前提: `BarcodeScanModal` に `stabilityConfig` は付けない（最初の有効デコードで `onSuccess`）。
 * - 連続ヒットによる揺れ対策が必要な画面だけ、各ページで `stabilityConfig` を追加指定する。
 */
export type KioskStandardBarcodeScanSessionDefaults = {
  readerOptions: BarcodeReaderTimingOptions;
  idleTimeoutMs: number;
};

export const KIOSK_STANDARD_BARCODE_SCAN_SESSION: KioskStandardBarcodeScanSessionDefaults = {
  readerOptions: BARCODE_READER_OPTIONS_KIOSK_DEFAULT,
  idleTimeoutMs: 30_000,
};
