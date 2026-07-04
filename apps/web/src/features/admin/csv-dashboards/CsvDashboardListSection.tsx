import type { CsvDashboardEditor } from './useCsvDashboardEditor';
import type { CsvDashboard } from '../../../api/client';

type CsvDashboardListSectionProps = {
  editor: CsvDashboardEditor;
};

export function CsvDashboardListSection({ editor }: CsvDashboardListSectionProps) {
  const { selectedId, setSelectedId, dashboards, dashboardsQuery } = editor;

  return (
    <div className="rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg">
      <h3 className="text-base font-bold">ダッシュボード一覧</h3>
      <div className="mt-3">
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        >
          <option value="">選択してください</option>
          {dashboards.map((d: CsvDashboard) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {dashboardsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">読み込み中...</p>}
        {dashboardsQuery.isError && (
          <p className="mt-2 text-xs text-rose-600">一覧の取得に失敗しました。</p>
        )}
      </div>
    </div>
  );
}
