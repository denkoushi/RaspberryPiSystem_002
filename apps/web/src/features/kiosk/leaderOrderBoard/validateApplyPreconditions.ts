import { LEADER_ORDER_BOARD_ORDER_NUMBER_MAX } from './constants.js';
import { LeaderBoardApplyError } from './leaderBoardApplyErrors.js';

import type { LeaderBoardRow } from './types';

/** 一覧が 1 ページに収まっているか（未取得行が無いか） */
export function assertCompletePage(total: number, rowsReturned: number): void {
  if (total > rowsReturned) {
    throw new LeaderBoardApplyError(
      'INCOMPLETE_PAGE',
      '一覧が1ページに収まっていません。絞り込みを調整するか、件数が上限を超えていないか確認してください。'
    );
  }
}

export function assertResourceRowsWithinOrderLimit(sortedRows: LeaderBoardRow[]): void {
  if (sortedRows.length > LEADER_ORDER_BOARD_ORDER_NUMBER_MAX) {
    throw new LeaderBoardApplyError(
      'TOO_MANY_ROWS',
      `この資源の行が ${LEADER_ORDER_BOARD_ORDER_NUMBER_MAX} 件を超えています。API の手動順番上限のため、ここから一括反映できません。`
    );
  }
}

export function assertNonEmptyResource(sortedRows: LeaderBoardRow[]): void {
  if (sortedRows.length === 0) {
    throw new LeaderBoardApplyError('EMPTY_RESOURCE', '対象行がありません。');
  }
}

export function assertAllRowsMatchResourceCd(sortedRows: readonly LeaderBoardRow[], resourceCd: string): void {
  const mismatch = sortedRows.find((r) => r.resourceCd !== resourceCd);
  if (mismatch) {
    throw new LeaderBoardApplyError('RESOURCE_MISMATCH', '資源CDが一致しない行が混ざっています。');
  }
}
