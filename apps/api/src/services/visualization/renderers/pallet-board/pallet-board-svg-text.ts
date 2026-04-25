const ELLIPSIS = '…';

/**
 * SVG の `<text>` 用: 厳密な測定はせず、フォント px と利用幅から「この文字数までなら枠内が目安」として上限を出す（混在仮名・英数を雑に平均）。
 */
export function estimateMaxCharsForLine(availableWidthPx: number, fontSizePx: number, safetyFactor = 0.62): number {
  if (availableWidthPx <= 0 || fontSizePx <= 0) {
    return 0;
  }
  const denom = fontSizePx * safetyFactor;
  return Math.max(0, Math.floor(availableWidthPx / denom));
}

/**
 * 先頭保持で省略。`maxDisplayChars` には省略記号分を含めない想定（呼び出し側は estimate の結果を渡す）。
 */
export function ellipsizeToMaxChars(input: string, maxDisplayChars: number): string {
  if (maxDisplayChars <= 0) {
    return '';
  }
  if (input.length <= maxDisplayChars) {
    return input;
  }
  if (maxDisplayChars === 1) {
    return ELLIPSIS;
  }
  return input.slice(0, maxDisplayChars - 1) + ELLIPSIS;
}
