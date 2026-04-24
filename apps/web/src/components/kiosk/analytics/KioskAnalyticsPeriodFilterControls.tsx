import { formatPeriodLabelJa } from '../../../features/kiosk-loan-analytics/period';
import { KioskMonthPickerModal } from '../KioskMonthPickerModal';

import type { KioskAnalyticsTheme } from './kioskAnalyticsTheme';
import type { AssetFilterOption } from './kioskAnalyticsTypes';
import type { DatasetTab } from '../../../features/kiosk-loan-analytics/view-model';

export type KioskAnalyticsPeriodFilterControlsProps = {
  theme: KioskAnalyticsTheme;
  targetPeriod: string;
  monthPickerOpen: boolean;
  onMonthPickerOpen: () => void;
  onMonthPickerCancel: () => void;
  onMonthPickerCommit: (next: string) => void;
  datasetTab: DatasetTab;
  rigging: { value: string; onChange: (value: string) => void; options: AssetFilterOption[] };
  items: { value: string; onChange: (value: string) => void; options: AssetFilterOption[] };
  instruments: { value: string; onChange: (value: string) => void; options: AssetFilterOption[] };
};

/**
 * 対象期間ボタン・月モーダル・データセット別の絞り込み select（吊具 / アイテム / 計測機器）。
 */
export function KioskAnalyticsPeriodFilterControls({
  theme,
  targetPeriod,
  monthPickerOpen,
  onMonthPickerOpen,
  onMonthPickerCancel,
  onMonthPickerCommit,
  datasetTab,
  rigging,
  items,
  instruments
}: KioskAnalyticsPeriodFilterControlsProps) {
  const selectClass =
    'max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs';

  return (
    <div className="flex flex-nowrap items-center gap-2">
      <span className="text-xs" style={{ color: theme.textMuted }}>
        対象期間
      </span>
      <button
        type="button"
        className="rounded px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-90"
        style={{
          border: `1px solid ${theme.borderSubtle}`,
          backgroundColor: 'var(--color-neutral-solid-gray-900)',
          color: theme.text,
          borderRadius: theme.radius6
        }}
        aria-label="対象期間"
        onClick={onMonthPickerOpen}
      >
        {formatPeriodLabelJa(targetPeriod)}
      </button>
      <KioskMonthPickerModal
        isOpen={monthPickerOpen}
        value={targetPeriod}
        variant="analytics"
        onCancel={onMonthPickerCancel}
        onCommit={onMonthPickerCommit}
      />

      {datasetTab === 'rigging' && (
        <label className="flex items-center gap-1 text-xs" style={{ color: theme.textMuted }}>
          吊具
          <select
            value={rigging.value}
            onChange={(e) => rigging.onChange(e.target.value)}
            className={selectClass}
            style={{ border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)', color: theme.text }}
            aria-label="吊具で絞り込み"
          >
            <option value="">全件</option>
            {rigging.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {datasetTab === 'items' && (
        <label className="flex items-center gap-1 text-xs" style={{ color: theme.textMuted }}>
          表示名
          <select
            value={items.value}
            onChange={(e) => items.onChange(e.target.value)}
            className={selectClass}
            style={{ border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)', color: theme.text }}
            aria-label="持出返却アイテムで絞り込み"
          >
            <option value="">全件</option>
            {items.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {datasetTab === 'instruments' && (
        <label className="flex items-center gap-1 text-xs" style={{ color: theme.textMuted }}>
          計測機器
          <select
            value={instruments.value}
            onChange={(e) => instruments.onChange(e.target.value)}
            className={selectClass}
            style={{ border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)', color: theme.text }}
            aria-label="計測機器で絞り込み"
          >
            <option value="">全件</option>
            {instruments.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
