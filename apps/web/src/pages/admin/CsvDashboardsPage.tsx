import { Button } from '../../components/ui/Button';
import { CsvDashboardBasicSettingsFields } from '../../features/admin/csv-dashboards/CsvDashboardBasicSettingsFields';
import { CsvDashboardColumnDefinitionsTable } from '../../features/admin/csv-dashboards/CsvDashboardColumnDefinitionsTable';
import { CsvDashboardHeaderSection } from '../../features/admin/csv-dashboards/CsvDashboardHeaderSection';
import { CsvDashboardListSection } from '../../features/admin/csv-dashboards/CsvDashboardListSection';
import { CsvDashboardPreviewSection } from '../../features/admin/csv-dashboards/CsvDashboardPreviewSection';
import { CsvDashboardTableTemplateSection } from '../../features/admin/csv-dashboards/CsvDashboardTableTemplateSection';
import { CsvDashboardUploadSection } from '../../features/admin/csv-dashboards/CsvDashboardUploadSection';
import { useCsvDashboardEditor } from '../../features/admin/csv-dashboards/useCsvDashboardEditor';

export function CsvDashboardsPage() {
  const editor = useCsvDashboardEditor();

  return (
    <div className="space-y-6">
      <CsvDashboardHeaderSection editor={editor} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <CsvDashboardListSection editor={editor} />

        <div className="lg:col-span-2 rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg">
          <h3 className="text-base font-bold">設定</h3>

          {!editor.selectedId ? (
            <p className="mt-3 text-sm text-slate-600">左でCSVダッシュボードを選択してください。</p>
          ) : editor.selectedDashboardQuery.isLoading ? (
            <p className="mt-3 text-sm text-slate-600">読み込み中...</p>
          ) : editor.selectedDashboardQuery.isError || !editor.selected ? (
            <p className="mt-3 text-sm text-rose-600">ダッシュボードの取得に失敗しました。</p>
          ) : (
            <div className="mt-4 space-y-4">
              <CsvDashboardBasicSettingsFields editor={editor} selected={editor.selected} />

              {editor.selected.templateType === 'TABLE' && (
                <CsvDashboardTableTemplateSection editor={editor} />
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => editor.updateMutation.mutate()}
                  disabled={editor.updateMutation.isPending}
                >
                  設定を保存
                </Button>
                {editor.updateMutation.isError && (
                  <span className="text-sm text-rose-600">保存に失敗しました。</span>
                )}
                {editor.updateMutation.isSuccess && (
                  <span className="text-sm text-emerald-700">保存しました。</span>
                )}
              </div>
              {editor.columnDefinitionError && (
                <p className="text-sm text-rose-600">{editor.columnDefinitionError}</p>
              )}

              <hr className="border-slate-200" />

              <CsvDashboardColumnDefinitionsTable editor={editor} />

              <hr className="border-slate-200" />

              <CsvDashboardPreviewSection editor={editor} />

              <hr className="border-slate-200" />

              <CsvDashboardUploadSection editor={editor} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
