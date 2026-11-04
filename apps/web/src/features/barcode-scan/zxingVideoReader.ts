import { registerKioskPreload } from '../kiosk/kioskLazyPreload';

import type { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from '@zxing/library';

let zxingPromise: Promise<typeof import('@zxing/library')> | undefined;

export function loadZxingLibrary() {
  return zxingPromise ??= import('@zxing/library').catch((error: unknown) => {
    zxingPromise = undefined;
    throw error;
  });
}

registerKioskPreload(loadZxingLibrary);

export type BarcodeReaderTimingOptions = {
  /** 読取成功後に次の試行まで待つ ms（連続ループ用） */
  timeBetweenScansMillis?: number;
  /** NotFound 等のあと再試行までの ms */
  timeBetweenDecodingAttempts?: number;
};

export async function createZxingPossibleFormatsHints(formats: BarcodeFormat[]): Promise<Map<DecodeHintType, unknown>> {
  const { DecodeHintType } = await loadZxingLibrary();
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  return hints;
}

/**
 * Pi / キオスク向けにデコード間隔を控えめにした MultiFormat リーダー。
 */
export async function createBrowserMultiFormatReader(
  formats: BarcodeFormat[],
  options?: BarcodeReaderTimingOptions
): Promise<BrowserMultiFormatReader> {
  const { BrowserMultiFormatReader } = await loadZxingLibrary();
  const hints = await createZxingPossibleFormatsHints(formats);
  const reader = new BrowserMultiFormatReader(
    hints,
    options?.timeBetweenScansMillis ?? 400
  );
  reader.timeBetweenDecodingAttempts = options?.timeBetweenDecodingAttempts ?? 200;
  return reader;
}
