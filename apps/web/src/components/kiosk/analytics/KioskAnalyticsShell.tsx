import type { KioskAnalyticsTheme } from './kioskAnalyticsTheme';
import type { DatasetTab } from '../../../features/kiosk-loan-analytics/view-model';
import type { ReactNode } from 'react';


export type KioskAnalyticsShellProps = {
  theme: KioskAnalyticsTheme;
  /** 期間テキスト（例: 2026/4/1 — 2026/4/30） */
  periodRangeLabel: string;
  periodFilterControls: ReactNode;
  datasetTab: DatasetTab;
  onDatasetTabChange: (tab: DatasetTab) => void;
  listModeToggle: {
    classNameForButton: (active: boolean) => string;
    onTop: () => void;
    onAll: () => void;
    isTop: boolean;
    isAll: boolean;
  };
};

/**
 * 集計コントロール帯（1 行・横スクロール可）。DADS プレビューと同じ役割分解。
 */
export function KioskAnalyticsShell({
  theme,
  periodRangeLabel,
  periodFilterControls,
  datasetTab,
  onDatasetTabChange,
  listModeToggle
}: KioskAnalyticsShellProps) {
  return (
    <div
      className="shell flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-x-auto px-3 py-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
      aria-label="集計 コントロール"
    >
      <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-x-3">
        <h2 className="shrink-0 text-sm font-bold">集計</h2>
        <span className="shrink-0 text-[11px]" style={{ color: theme.textSub }}>
          {periodRangeLabel}
        </span>
        {periodFilterControls}
      </div>

      <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-between gap-2">
        <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
          <button
            type="button"
            className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              borderRadius: theme.radius6,
              backgroundColor: datasetTab === 'rigging' ? theme.primaryUi : theme.tabInactive,
              color: datasetTab === 'rigging' ? theme.text : theme.textMuted
            }}
            onClick={() => onDatasetTabChange('rigging')}
          >
            吊具
          </button>
          <button
            type="button"
            className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              borderRadius: theme.radius6,
              backgroundColor: datasetTab === 'items' ? theme.primaryUi : theme.tabInactive,
              color: datasetTab === 'items' ? theme.text : theme.textMuted
            }}
            onClick={() => onDatasetTabChange('items')}
          >
            持出返却アイテム
          </button>
          <button
            type="button"
            className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              borderRadius: theme.radius6,
              backgroundColor: datasetTab === 'instruments' ? theme.primaryUi : theme.tabInactive,
              color: datasetTab === 'instruments' ? theme.text : theme.textMuted
            }}
            onClick={() => onDatasetTabChange('instruments')}
          >
            計測機器
          </button>
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          <span className="whitespace-nowrap text-[10px] font-semibold" style={{ color: theme.textSub }}>
            一覧表示
          </span>
          <div
            className="inline-flex rounded-md p-0.5"
            role="group"
            aria-label="一覧表示モード"
            style={{ border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)' }}
          >
            <button
              type="button"
              className={listModeToggle.classNameForButton(listModeToggle.isTop)}
              style={{
                borderRadius: theme.radius6,
                backgroundColor: listModeToggle.isTop ? theme.primaryUi : 'transparent',
                color: listModeToggle.isTop ? theme.text : theme.textMuted
              }}
              aria-pressed={listModeToggle.isTop}
              onClick={listModeToggle.onTop}
            >
              Top
            </button>
            <button
              type="button"
              className={listModeToggle.classNameForButton(listModeToggle.isAll)}
              style={{
                borderRadius: theme.radius6,
                backgroundColor: listModeToggle.isAll ? theme.primaryUi : 'transparent',
                color: listModeToggle.isAll ? theme.text : theme.textMuted
              }}
              aria-pressed={listModeToggle.isAll}
              onClick={listModeToggle.onAll}
            >
              全件
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
