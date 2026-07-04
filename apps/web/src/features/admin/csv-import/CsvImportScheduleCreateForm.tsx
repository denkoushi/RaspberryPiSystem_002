import { Button } from '../../../components/ui/Button';

import { formatCsvImportError } from './csvImportError';
import { CsvImportScheduleTimingFields } from './CsvImportScheduleTimingFields';
import { CsvImportTargetsEditor } from './CsvImportTargetsEditor';

import type { CsvImportScheduleFormController } from './useCsvImportScheduleForm';
import type { CsvDashboard } from '../../../api/client';

type CsvImportScheduleCreateFormProps = {
  form: CsvImportScheduleFormController;
  csvDashboardsData: CsvDashboard[] | undefined;
};

export function CsvImportScheduleCreateForm({ form, csvDashboardsData }: CsvImportScheduleCreateFormProps) {
  if (!form.showCreateForm) {
    return null;
  }

  return (
    <div className="mb-4 rounded-md border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
      <h3 className="mb-3 text-lg font-bold text-slate-900">新規スケジュール作成</h3>

      {form.validationError && (
        <div className="mb-3 rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
          エラー: {form.validationError}
        </div>
      )}

      {form.create.isError && (
        <div className="mb-3 rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
          エラー: {formatCsvImportError(form.create.error)}
        </div>
      )}

      {form.create.isSuccess && (
        <div className="mb-3 rounded-md border-2 border-emerald-700 bg-emerald-600 p-3 text-sm font-semibold text-white shadow-lg">
          スケジュールを作成しました
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            ID *
            {form.formData.targets?.some(t => t.type === 'csvDashboards' && t.source) && (
              <span className="ml-2 text-xs text-slate-500">（CSVダッシュボード選択時に自動生成）</span>
            )}
          </label>
          <input
            type="text"
            className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            value={form.formData.id || ''}
            onChange={(e) => form.setFormData({ ...form.formData, id: e.target.value })}
            placeholder={form.formData.targets?.some(t => t.type === 'csvDashboards' && t.source) ? 'CSVダッシュボード選択時に自動生成されます' : '例: csv-import-measuring-instrument-loans'}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            名前
          </label>
          <input
            type="text"
            className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            value={form.formData.name}
            onChange={(e) => form.setFormData({ ...form.formData, name: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            プロバイダー（オプション）
          </label>
          <select
            className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            value={form.formData.provider || ''}
            onChange={(e) => form.setFormData({ ...form.formData, provider: e.target.value === '' ? undefined : e.target.value as 'dropbox' | 'gmail' })}
          >
            <option value="">デフォルト（設定ファイルのstorage.providerを使用）</option>
            <option value="dropbox">Dropbox</option>
            <option value="gmail">Gmail</option>
          </select>
          <p className="mt-1 text-xs text-slate-600">
            Gmailの場合、sourceは件名パターン（例: [Pi5 CSV Import] employees）を指定します
          </p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            インポート対象 *
          </label>
          <CsvImportTargetsEditor
            formData={form.formData}
            setFormData={form.setFormData}
            provider={form.formData.provider}
            patternsByType={form.patternsByType}
            csvDashboards={csvDashboardsData}
            showHelpText
          />
        </div>
        <CsvImportScheduleTimingFields
          variant="create"
          scheduleMode={form.scheduleMode}
          scheduleTime={form.scheduleTime}
          scheduleDaysOfWeek={form.scheduleDaysOfWeek}
          intervalMinutes={form.intervalMinutes}
          offsetMinutes={form.offsetMinutes}
          scheduleEditable={form.scheduleEditable}
          scheduleEditWarning={form.scheduleEditWarning}
          onScheduleModeChange={form.setScheduleMode}
          onScheduleTimeChange={form.setScheduleTime}
          onScheduleDaysOfWeekChange={form.setScheduleDaysOfWeek}
          onIntervalMinutesChange={form.setIntervalMinutes}
          onOffsetMinutesChange={form.setOffsetMinutes}
        />
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              id="enabled"
              checked={form.formData.enabled}
              onChange={(e) => form.setFormData({ ...form.formData, enabled: e.target.checked })}
              className="rounded border-2 border-slate-500"
            />
            有効
          </label>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              id="replaceExisting"
              checked={form.formData.replaceExisting}
              onChange={(e) => form.setFormData({ ...form.formData, replaceExisting: e.target.checked })}
              className="rounded border-2 border-slate-500"
            />
            既存データを置き換える
          </label>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              id="autoBackupEnabled"
              checked={form.formData.autoBackupAfterImport?.enabled}
              onChange={(e) =>
                form.setFormData({
                  ...form.formData,
                  autoBackupAfterImport: {
                    ...form.formData.autoBackupAfterImport,
                    enabled: e.target.checked,
                    targets: form.formData.autoBackupAfterImport?.targets || ['csv']
                  }
                })
              }
              className="rounded border-2 border-slate-500"
            />
            インポート後に自動バックアップを実行
          </label>
          {form.formData.autoBackupAfterImport?.enabled && (
            <div className="ml-6 mt-2 space-y-1">
              <p className="text-xs text-slate-600">バックアップ対象:</p>
              <div className="flex flex-wrap gap-2">
                {(['csv', 'database', 'all'] as const).map((target) => (
                  <label key={target} className="flex items-center gap-1 text-xs text-slate-700 font-semibold">
                    <input
                      type="checkbox"
                      checked={form.formData.autoBackupAfterImport?.targets?.includes(target)}
                      onChange={(e) => {
                        const currentTargets = form.formData.autoBackupAfterImport?.targets || [];
                        const newTargets = e.target.checked
                          ? [...currentTargets, target]
                          : currentTargets.filter((t) => t !== target);
                        form.setFormData({
                          ...form.formData,
                          autoBackupAfterImport: {
                            ...form.formData.autoBackupAfterImport,
                            enabled: true,
                            targets: newTargets
                          }
                        });
                      }}
                      className="rounded border-2 border-slate-500"
                    />
                    {target === 'csv' ? 'CSV' : target === 'database' ? 'データベース' : 'すべて'}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={form.handleCreate} disabled={form.create.isPending}>
            {form.create.isPending ? '作成中...' : '作成'}
          </Button>
          <Button variant="ghost" onClick={form.handleCancelCreate} disabled={form.create.isPending}>
            キャンセル
          </Button>
        </div>
      </div>
    </div>
  );
}
