/** 表計算の列の文字(A, B, ..., Z, AA)を 1 始まりの列番号にする。 */
export function columnLettersToNumber(letters: string): number {
  return [...letters].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
}
