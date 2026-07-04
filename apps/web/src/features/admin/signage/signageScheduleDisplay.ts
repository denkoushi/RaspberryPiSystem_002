import type { SignageSchedule, VisualizationDashboard } from '../../../api/client';

export const DAYS_OF_WEEK = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

export function parseResourceCdListInput(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,，]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
}

export const PALLET_VIZ_DATA_SOURCE = 'pallet_visualization_board';

export const DEFAULT_SCHEDULE_FORM_DATA: Partial<SignageSchedule> = {
  name: '',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [],
  startTime: '09:00',
  endTime: '18:00',
  priority: 0,
  enabled: true,
};

export function formatVisualizationOptionLabel(dashboard: VisualizationDashboard): string {
  const tags: string[] = [];
  if (dashboard.dataSourceType === 'uninspected_machines') {
    tags.push('未点検加工機');
  }
  if (dashboard.dataSourceType === PALLET_VIZ_DATA_SOURCE) {
    tags.push('パレット可視化');
  }
  if (dashboard.dataSourceType === 'measuring_instrument_loan_inspection') {
    tags.push('計測機器点検');
  }
  if (dashboard.dataSourceType === 'rigging_loan_inspection') {
    tags.push('吊具点検');
  }
  if (dashboard.rendererType) {
    tags.push(`renderer:${dashboard.rendererType}`);
  }
  const labeled = tags.length > 0 ? `${dashboard.name} [${tags.join(' / ')}]` : dashboard.name;
  return dashboard.enabled ? labeled : `${labeled} （無効）`;
}

export function groupVisualizationDashboardsForSignage(dashboards: VisualizationDashboard[] | undefined): {
  pallet: VisualizationDashboard[];
  rigging: VisualizationDashboard[];
  other: VisualizationDashboard[];
} {
  const list = dashboards ?? [];
  const pallet = list
    .filter((d) => d.dataSourceType === PALLET_VIZ_DATA_SOURCE)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const rigging = list
    .filter((d) => d.dataSourceType === 'rigging_loan_inspection')
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const other = list
    .filter((d) => d.dataSourceType !== PALLET_VIZ_DATA_SOURCE && d.dataSourceType !== 'rigging_loan_inspection')
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return { pallet, rigging, other };
}
