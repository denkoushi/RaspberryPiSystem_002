/**
 * パレット番号テンキー用バッファに桁を追加する。
 * 既に2桁ある場合は、新しい1桁だけを持つ配列に置き換える（3キー目で先頭から上書き）。
 */
export function pushPalletTenkeyDigit(prev: number[], d: number): number[] {
  if (prev.length >= 2) {
    return [d];
  }
  return [...prev, d];
}
