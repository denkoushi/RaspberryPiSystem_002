import { Card } from '../../../components/ui/Card';

import type { VisualizationDashboardEditor } from './useVisualizationDashboardEditor';
import type { VisualizationDashboard } from '../../../api/client';

type VisualizationDashboardListSectionProps = {
  editor: VisualizationDashboardEditor;
};

export function VisualizationDashboardListSection({ editor }: VisualizationDashboardListSectionProps) {
  const { dashboards, dashboardsQuery, handleSelectChange, selectedId } = editor;

  return (
    <Card title="一覧">
      <select
        value={selectedId ?? ''}
        onChange={(e) => handleSelectChange(e.target.value || null)}
        className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
      >
        <option value="">選択してください</option>
        {dashboards.map((dashboard: VisualizationDashboard) => (
          <option key={dashboard.id} value={dashboard.id}>
            {dashboard.name}
          </option>
        ))}
      </select>
      {dashboardsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">読み込み中...</p>}
      {dashboardsQuery.isError && <p className="mt-2 text-xs text-rose-600">一覧の取得に失敗しました。</p>}
    </Card>
  );
}
