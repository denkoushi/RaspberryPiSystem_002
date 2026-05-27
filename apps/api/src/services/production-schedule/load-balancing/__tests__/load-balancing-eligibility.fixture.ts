import {
  FKOJUNST_MAIL_COMPLETED_STATUS_CODES,
  FKOJUNST_MAIL_HIDDEN_INCOMPLETE_STATUS_CODES,
  FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES
} from '../../completion/fkojunst-mail-status-completion.policy.js';

export type LoadBalancingEligibilityFixtureRow = {
  rowId: string;
  fkoStatus: string | null;
  hasFkmail: boolean;
  isCompleted: boolean;
  isExternallyCompleted: boolean;
};

/**
 * テスト用: `buildLoadBalancingRowEligibilityWhereSql` と同じ判定軸を TypeScript で再現する。
 * SQL 変更時は本関数と定数を同期すること。
 */
export function isLoadBalancingEligibleRow(row: LoadBalancingEligibilityFixtureRow): boolean {
  if (!row.hasFkmail) return false;
  const st = String(row.fkoStatus ?? '')
    .trim()
    .toUpperCase();
  if ((FKOJUNST_MAIL_COMPLETED_STATUS_CODES as readonly string[]).includes(st)) {
    return false;
  }
  if (row.isCompleted || row.isExternallyCompleted) return false;
  return true;
}

export const ALL_FKO_STATUSES = [
  ...FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES,
  ...FKOJUNST_MAIL_HIDDEN_INCOMPLETE_STATUS_CODES,
  ...FKOJUNST_MAIL_COMPLETED_STATUS_CODES
] as const;
