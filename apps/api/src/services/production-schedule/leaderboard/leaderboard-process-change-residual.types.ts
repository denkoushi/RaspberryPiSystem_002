/** 順位ボード専用。公開 API パラメータではなくサービス内部の適用範囲制御。 */
export type ProcessChangeResidualMode = 'normal' | 'include' | 'only';

export type ProcessChangeResidualEvidenceSide = {
  productNo: string;
  fkojun: string;
  resourceCd: string;
  status: string;
  fupdtedt: string | null;
};

export type ProcessChangeResidualEvidence = {
  current: ProcessChangeResidualEvidenceSide;
  completedOtherResource: ProcessChangeResidualEvidenceSide;
};

export const LEADERBOARD_PROCESS_CHANGE_RESIDUAL_REPRESENTATIVE_LIMIT = 20;
