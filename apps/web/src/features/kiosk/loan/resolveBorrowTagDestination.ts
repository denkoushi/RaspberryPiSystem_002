export type BorrowTagDestination = 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR' | null;

type BorrowTagLookups = {
  lookupInstrument: (tagUid: string) => Promise<unknown>;
  lookupRigging: (tagUid: string) => Promise<unknown>;
};

/**
 * 持出画面でスキャンしたタグが計測機器/吊具に登録済みかを判定する。
 * 2つの by-tag 照会は並列に行い、優先順位は直列実行時と同じ（計測機器 → 吊具 → どちらでもない）。
 * 照会の失敗（404・通信失敗など）は「該当なし」として扱い、工具/従業員フローを継続させる。
 */
export async function resolveBorrowTagDestination(
  tagUid: string,
  { lookupInstrument, lookupRigging }: BorrowTagLookups
): Promise<BorrowTagDestination> {
  const settle = (promise: Promise<unknown>) => promise.then(Boolean, () => false);
  const instrumentFound = settle(lookupInstrument(tagUid));
  const riggingFound = settle(lookupRigging(tagUid));
  // 計測機器が見つかった時点で返し、吊具の照会完了は待たない。
  if (await instrumentFound) {
    return 'MEASURING_INSTRUMENT';
  }
  return (await riggingFound) ? 'RIGGING_GEAR' : null;
}
