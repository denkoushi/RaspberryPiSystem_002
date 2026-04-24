/**
 * キオスク集計パネル共通のテーマ（DADS トークン参照）。
 * コンポーネント間で見た目を揃えるための値オブジェクト。
 */
export type KioskAnalyticsTheme = {
  chartBorrow: string;
  chartReturn: string;
  strokeBar: string;
  surface: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  textSub: string;
  primaryUi: string;
  tabInactive: string;
  error: string;
  radius8: string;
  radius6: string;
};

/**
 * キオスク集計（/kiosk/rigging-analytics）の単一のテーマ解決。
 * デザインプレビュー docs/design-previews/kiosk-analytics-dads-system-refactor-preview.html の DADS 意図に合わせる。
 */
export const KIOSK_ANALYTICS_DADS_THEME: KioskAnalyticsTheme = {
  /** 持出系: 青・水色の近接を避け橙で識別 */
  chartBorrow: 'var(--color-primitive-orange-500, #f97316)',
  /** 返却系: 補色寄りの緑で持出と二値判別しやすく */
  chartReturn: 'var(--color-primitive-emerald-500, #10b981)',
  strokeBar: 'var(--color-neutral-solid-gray-900)',
  surface: 'var(--color-neutral-solid-gray-800)',
  border: 'var(--color-neutral-solid-gray-600)',
  borderSubtle: 'var(--color-neutral-solid-gray-700)',
  text: 'var(--color-neutral-white)',
  textMuted: 'var(--color-neutral-solid-gray-300)',
  textSub: 'var(--color-neutral-solid-gray-400)',
  primaryUi: 'var(--color-primitive-blue-900)',
  tabInactive: 'var(--color-neutral-solid-gray-700)',
  error: 'var(--color-semantic-error-1)',
  radius8: 'var(--border-radius-8)',
  radius6: 'var(--border-radius-6)'
};
