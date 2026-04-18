/**
 * 管理コンソール向け「貸出レポート」ドメイン型。
 * analytics API の応答を正規化したうえで、HTML レンダラが唯一参照するビューモデル。
 */

export type LoanReportCategoryKey = 'measuring' | 'rigging' | 'tools';

export type LoanReportCategoryLabelJa = '計測機器' | '吊具' | '道具';

export type LoanReportVerdictClass = 'good' | 'warn' | 'bad';

export interface LoanReportChip {
  k: string;
  v: string;
}

export interface LoanReportSupplyEval {
  score: number;
  state: string;
  tagClass: 'tag-ok' | 'tag-warn' | 'tag-bad';
  chips: LoanReportChip[];
}

export interface LoanReportComplianceEval {
  score: number;
  state: string;
  tagClass: 'tag-ok' | 'tag-warn' | 'tag-bad';
  chips: LoanReportChip[];
}

export interface LoanReportItemAxisRow {
  name: string;
  demand: number;
  stock: number;
}

export interface LoanReportPersonAxisRow {
  name: string;
  total: number;
  returned: number;
  open: number;
  overdue: number;
}

export interface LoanReportCrossHeatmap {
  x: string[];
  y: string[];
  values: number[][];
}

export interface LoanReportTrend {
  demand: number[];
  compliance: number[];
  labels: string[];
}

export interface LoanReportFindings {
  overall: { text: string; cls: LoanReportVerdictClass };
  trend: { text: string; cls: LoanReportVerdictClass };
  body: string;
}

/** HTML レンダラ入力（プレビュー/添付の正本） */
export interface LoanReportViewModel {
  key: LoanReportCategoryKey;
  category: LoanReportCategoryLabelJa;
  accent: string;
  pageLabel: string;
  reportId: string;
  meta: string;
  metrics: {
    assets: number;
    out: number;
    returned: number;
    open: number;
    overdue: number;
    returnRate: number;
  };
  supply: LoanReportSupplyEval;
  compliance: LoanReportComplianceEval;
  itemAxis: LoanReportItemAxisRow[];
  personAxis: LoanReportPersonAxisRow[];
  cross: LoanReportCrossHeatmap;
  trend: LoanReportTrend;
  findings: LoanReportFindings;
}

/** プレビュー API が返す reportModel（JSON） */
export interface LoanReportPreviewPayload {
  reportModel: LoanReportViewModel;
  html: string;
}
