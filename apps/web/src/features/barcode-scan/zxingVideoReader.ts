import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from '@zxing/library';

export type BarcodeReaderTimingOptions = {
  /** 読取成功後に次の試行まで待つ ms（連続ループ用） */
  timeBetweenScansMillis?: number;
  /** NotFound 等のあと再試行までの ms */
  timeBetweenDecodingAttempts?: number;
};

export function createZxingPossibleFormatsHints(formats: BarcodeFormat[]): Map<DecodeHintType, unknown> {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  return hints;
}

/**
 * Pi / キオスク向けにデコード間隔を控えめにした MultiFormat リーダー。
 */
export function createBrowserMultiFormatReader(
  formats: BarcodeFormat[],
  options?: BarcodeReaderTimingOptions
): BrowserMultiFormatReader {
  const hints = createZxingPossibleFormatsHints(formats);
  const reader = new BrowserMultiFormatReader(
    hints,
    options?.timeBetweenScansMillis ?? 400
  );
  reader.timeBetweenDecodingAttempts = options?.timeBetweenDecodingAttempts ?? 200;
  return reader;
}
