import { Button } from '../../../components/ui/Button';

import { MACHINE_DAILY_INSPECTION_DASHBOARD_NAME } from './csvDashboardPresets';

import type { CsvDashboardEditor } from './useCsvDashboardEditor';

type CsvDashboardHeaderSectionProps = {
  editor: CsvDashboardEditor;
};

export function CsvDashboardHeaderSection({ editor }: CsvDashboardHeaderSectionProps) {
  const { dashboardsQuery, createInspectionDashboardMutation } = editor;

  return (
    <div className="rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">CSVダッシュボード</h2>
          <p className="mt-1 text-sm text-slate-600">
            CSVダッシュボード定義を管理します。未点検加工機表示のための点検結果ダッシュボードはプリセットで作成できます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => createInspectionDashboardMutation.mutate()}
            disabled={createInspectionDashboardMutation.isPending || dashboardsQuery.isLoading}
          >
            加工機_日常点検結果プリセットで作成
          </Button>
        </div>
      </div>
      {createInspectionDashboardMutation.isError && (
        <p className="mt-2 text-sm text-rose-600">プリセット作成に失敗しました。</p>
      )}
      {createInspectionDashboardMutation.isSuccess && (
        <p className="mt-2 text-sm text-emerald-700">
          「{MACHINE_DAILY_INSPECTION_DASHBOARD_NAME}」を作成/選択しました。
        </p>
      )}
    </div>
  );
}
