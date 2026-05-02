const trimKeyPart = (value: string): string => value.trim();

type LeaderBoardPartResourceProcessKeyParams = {
  seibanJoinKey: string;
  productNo: string;
  fhincd: string;
};

/**
 * 進捗一覧の部品行と順位ボード行を同じ粒度で結ぶための部品キー。
 * 表示用 FSEIBAN のマスクを避けるため、join 専用キー + 部品識別子を使う。
 */
export function buildLeaderBoardPartResourceProcessKey({
  seibanJoinKey,
  productNo,
  fhincd
}: LeaderBoardPartResourceProcessKeyParams): string {
  return [trimKeyPart(seibanJoinKey), trimKeyPart(productNo), trimKeyPart(fhincd)].join('\0');
}
