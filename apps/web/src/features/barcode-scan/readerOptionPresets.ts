import type { BarcodeReaderTimingOptions } from './zxingVideoReader';

/**
 * キオスク画面共通の読取テンポ設定（やや積極め）。
 * `createBrowserMultiFormatReader` の既定(400/200ms)より短く再試行し、初回認識までの待ちを抑える。
 * Pi4 常時描画負荷が高い画面では {@link BARCODE_READER_OPTIONS_KIOSK_CONSERVATIVE} を検討。
 */
export const BARCODE_READER_OPTIONS_KIOSK_DEFAULT: BarcodeReaderTimingOptions = {
  timeBetweenScansMillis: 220,
  timeBetweenDecodingAttempts: 120,
};

/**
 * Pi4 要領書など、掲載形式が多く同時に重いUIと並ぶ画面向け。
 * `zxingVideoReader` の未指定時既定と同じ 400/200ms で CPU 浪費を抑える。
 */
export const BARCODE_READER_OPTIONS_KIOSK_CONSERVATIVE: BarcodeReaderTimingOptions = {
  timeBetweenScansMillis: 400,
  timeBetweenDecodingAttempts: 200,
};
