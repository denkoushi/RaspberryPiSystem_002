import type { AnalyticsListMode } from '../../../features/kiosk-loan-analytics/analyticsDisplayPolicy';
import type { DatasetTab } from '../../../features/kiosk-loan-analytics/view-model';
import type { ReactNode } from 'react';

const datasets: { value: DatasetTab; label: string; icon: ReactNode }[] = [
  { value: 'rigging', label: '吊具', icon: <><path d="M12 3v6" /><circle cx="12" cy="11" r="2" /><path d="M12 13v2a4 4 0 1 1-4 4" /></> },
  { value: 'items', label: 'アイテム', icon: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z" /> },
  { value: 'instruments', label: '計測機器', icon: <><rect x="2" y="8" width="20" height="8" rx="1" /><path d="M6 8v3M10 8v4M14 8v3M18 8v4" /></> }
];

export function KioskAnalyticsShell({ periodFilterControls, datasetTab, onDatasetTabChange, listMode, onListModeChange }: {
  periodFilterControls: ReactNode;
  datasetTab: DatasetTab;
  onDatasetTabChange: (tab: DatasetTab) => void;
  listMode: AnalyticsListMode;
  onListModeChange: (mode: AnalyticsListMode) => void;
}) {
  return (
    <div className="kanalytics__bar">
      <div className="kanalytics__seg" role="group" aria-label="対象">
        {datasets.map(({ value, label, icon }) => (
          <button key={value} type="button" aria-pressed={datasetTab === value} onClick={() => onDatasetTabChange(value)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {icon}
            </svg>
            {label}
          </button>
        ))}
      </div>
      {periodFilterControls}
      <div className="kanalytics__seg" role="group" aria-label="一覧表示モード">
        <button type="button" aria-pressed={listMode === 'top'} onClick={() => onListModeChange('top')}>上位10</button>
        <button type="button" aria-pressed={listMode === 'all'} onClick={() => onListModeChange('all')}>全件</button>
      </div>
    </div>
  );
}
