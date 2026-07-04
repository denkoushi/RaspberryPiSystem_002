import type { VisualizationDashboardEditor } from './useVisualizationDashboardEditor';

type UninspectedCsvDashboardPickerProps = {
  editor: VisualizationDashboardEditor;
};

export function UninspectedCsvDashboardPicker({ editor }: UninspectedCsvDashboardPickerProps) {
  const {
    currentCsvDashboardId,
    handleCsvDashboardIdChange,
    csvDashboards,
    csvDashboardsQuery,
  } = editor;

  return (
    <div className="mt-3 space-y-2">
      <label className="block text-sm font-semibold text-slate-700">
        CSVダッシュボード（点検結果）<span className="text-rose-600">*</span>
      </label>
      <select
        value={currentCsvDashboardId}
        onChange={(e) => handleCsvDashboardIdChange(e.target.value)}
        className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
      >
        <option value="">選択してください</option>
        {csvDashboards.map((dashboard) => (
          <option key={dashboard.id} value={dashboard.id}>
            {dashboard.name}
            {!dashboard.enabled && ' (無効)'}
          </option>
        ))}
      </select>
      {csvDashboardsQuery.isLoading && (
        <p className="text-xs text-slate-500">CSVダッシュボード一覧を読み込み中...</p>
      )}
      {csvDashboardsQuery.isError && (
        <p className="text-xs text-rose-600">CSVダッシュボード一覧の取得に失敗しました。</p>
      )}
      {!currentCsvDashboardId && (
        <p className="text-xs text-rose-600">CSVダッシュボードを選択してください（必須）</p>
      )}
    </div>
  );
}
