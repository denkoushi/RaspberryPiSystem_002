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

/** 過不足の同尺度（0〜100）比較: 即時余力 vs 需要圧 */
export interface LoanReportSupplyBalanceViz {
  slackPct: number;
  pressurePct: number;
}

/** 期間イベントから再集計した、名寄せトップ群の月次持出（全体トレンドと同じ月軸） */
export interface LoanReportSupplyGroupTimeseries {
  groupLabel: string;
  borrowByMonth: number[];
  /** カテゴリ全体の月次持出（同順・monthlyTrend.borrowCount と一致） */
  totalBorrowByMonth: number[];
}

/** 需給の裂け目が大きい名寄せ群（上位2件） */
export interface LoanReportSupplyBottleneckRow {
  label: string;
  detail: string;
  periodBorrows: number;
  availableNow: number;
}

export interface LoanReportSupplyEval {
  score: number;
  state: string;
  tagClass: 'tag-ok' | 'tag-warn' | 'tag-bad';
  /** 5チップ（安全在庫カバー〜TOP5集中度）に対応する緊張度 0〜100（ビジュアル帯用） */
  vitalsSparkPct: [number, number, number, number, number];
  balanceViz: LoanReportSupplyBalanceViz;
  chips: LoanReportChip[];
  /**
   * 持出イベントを月×名寄せで寄せたミニ経時。トップ群がない・月次がない場合は null。
   */
  groupTimeseries: LoanReportSupplyGroupTimeseries | null;
  /** 期間持出 / 即時利用可能台数 が大きい順（同率は件数） */
  bottleneckTop2: LoanReportSupplyBottleneckRow[];
}

export interface LoanReportComplianceEval {
  score: number;
  state: string;
  tagClass: 'tag-ok' | 'tag-warn' | 'tag-bad';
  chips: LoanReportChip[];
}

export interface LoanReportItemAxisRow {
  name: string;
  /** 期間内の持出件数（名寄せ群合計） */
  demand: number;
  /** 即時利用可能台数（名寄せ群内の available 台数） */
  stock: number;
  /** 名寄せ群の保有台数（資産件数） */
  unitsTotal: number;
  /** 即時持出中台数（unitsTotal − stock） */
  unitsOut: number;
}

export interface LoanReportPersonAxisRow {
  name: string;
  borrowed: number;
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
