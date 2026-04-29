/** 製番一覧パネル・接頭辞フィルタの状態遷移（UI と切り離して検証可能にする） */

export const LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN = 9;

export function appendLeaderBoardSeibanPrefixChar(prefix: string, ch: string): string {
  if (prefix.length >= LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN) return prefix;
  return prefix + ch;
}

/** 末尾の UTF-16 コードユニットを1つ削除（製番は主に ASCII / 数字想定） */
export function trimLastLeaderBoardSeibanPrefixChar(prefix: string): string {
  if (prefix.length === 0) return '';
  return prefix.slice(0, -1);
}

export function clearLeaderBoardSeibanPrefix(): string {
  return '';
}

/** 9桁分の視覚幅確保用（フィルタ条件そのものではなく表示専用） */
export function formatLeaderBoardSeibanPrefixDisplayPadded(prefix: string): string {
  return prefix.padEnd(LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN, '\u00a0');
}
