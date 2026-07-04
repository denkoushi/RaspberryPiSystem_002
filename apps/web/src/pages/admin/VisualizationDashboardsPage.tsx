import { Card } from '../../components/ui/Card';
import { useVisualizationDashboardEditor } from '../../features/admin/visualization-dashboards/useVisualizationDashboardEditor';
import { VisualizationDashboardEditorForm } from '../../features/admin/visualization-dashboards/VisualizationDashboardEditorForm';
import { VisualizationDashboardHeaderSection } from '../../features/admin/visualization-dashboards/VisualizationDashboardHeaderSection';
import { VisualizationDashboardListSection } from '../../features/admin/visualization-dashboards/VisualizationDashboardListSection';

export function VisualizationDashboardsPage() {
  const editor = useVisualizationDashboardEditor();

  return (
    <div className="space-y-6">
      <VisualizationDashboardHeaderSection editor={editor} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <VisualizationDashboardListSection editor={editor} />

        <Card title="設定" className="lg:col-span-2">
          {editor.isCreating ? (
            <p className="text-sm text-slate-600">新規作成モードです。必要事項を入力してください。</p>
          ) : !editor.selectedId ? (
            <p className="text-sm text-slate-600">左の一覧から選択してください。</p>
          ) : editor.selectedDashboardQuery.isLoading ? (
            <p className="text-sm text-slate-600">読み込み中...</p>
          ) : editor.selectedDashboardQuery.isError || !editor.selected ? (
            <p className="text-sm text-rose-600">詳細の取得に失敗しました。</p>
          ) : (
            <p className="text-sm text-slate-600">選択中: {editor.selected.name}</p>
          )}

          {(editor.isCreating || editor.selected) && (
            <VisualizationDashboardEditorForm editor={editor} />
          )}
        </Card>
      </div>
    </div>
  );
}
