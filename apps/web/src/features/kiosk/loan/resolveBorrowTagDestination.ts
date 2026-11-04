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
  const [instrument, rigging] = await Promise.allSettled([lookupInstrument(tagUid), lookupRigging(tagUid)]);
  if (instrument.status === 'fulfilled' && instrument.value) {
    return 'MEASURING_INSTRUMENT';
  }
  if (rigging.status === 'fulfilled' && rigging.value) {
    return 'RIGGING_GEAR';
  }
  return null;
}
