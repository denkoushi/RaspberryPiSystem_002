import { formatPeriodLabelJa } from '../../../features/kiosk-loan-analytics/period';
import { KioskMonthPickerModal } from '../KioskMonthPickerModal';

import type { AssetFilterOption } from './kioskAnalyticsTypes';
import type { DatasetTab } from '../../../features/kiosk-loan-analytics/view-model';

export type KioskAnalyticsPeriodFilterControlsProps = {
  targetPeriod: string;
  isLatest: boolean;
  onShiftPeriod: (delta: number) => void;
  monthPickerOpen: boolean;
  onMonthPickerOpen: () => void;
  onMonthPickerCancel: () => void;
  onMonthPickerCommit: (next: string) => void;
  datasetTab: DatasetTab;
  rigging: { value: string; onChange: (value: string) => void; options: AssetFilterOption[] };
  items: { value: string; onChange: (value: string) => void; options: AssetFilterOption[] };
  instruments: { value: string; onChange: (value: string) => void; options: AssetFilterOption[] };
};

export function KioskAnalyticsPeriodFilterControls({
  targetPeriod, isLatest, onShiftPeriod, monthPickerOpen, onMonthPickerOpen, onMonthPickerCancel,
  onMonthPickerCommit, datasetTab, rigging, items, instruments
}: KioskAnalyticsPeriodFilterControlsProps) {
  const filter = datasetTab === 'rigging' ? rigging : datasetTab === 'items' ? items : instruments;
  const filterLabel = datasetTab === 'rigging' ? '吊具で絞り込み' : datasetTab === 'items' ? '持出返却アイテムで絞り込み' : '計測機器で絞り込み';
  return (
    <div className="kanalytics__filters">
      <div className="kanalytics__step" role="group" aria-label="期間の移動">
        <button type="button" aria-label="前の期間" onClick={() => onShiftPeriod(-1)}>‹</button>
        <button type="button" className="kanalytics__period" aria-label="対象期間" onClick={onMonthPickerOpen}>
          {formatPeriodLabelJa(targetPeriod)}
        </button>
        <button type="button" aria-label="次の期間" disabled={isLatest} onClick={() => onShiftPeriod(1)}>›</button>
      </div>
      <KioskMonthPickerModal isOpen={monthPickerOpen} value={targetPeriod} variant="analytics" onCancel={onMonthPickerCancel} onCommit={onMonthPickerCommit} />
      <select className="kanalytics__pick" value={filter.value} onChange={(event) => filter.onChange(event.target.value)} aria-label={filterLabel}>
        <option value="">すべて</option>
        {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
