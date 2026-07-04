import { Button } from '../../../components/ui/Button';

import { formatCsvImportError } from './csvImportError';
import { CsvImportScheduleTimingFields } from './CsvImportScheduleTimingFields';
import { formatScheduleForDisplay } from './csvImportScheduleUtils';
import { CsvImportTargetsEditor } from './CsvImportTargetsEditor';

import type { CsvImportScheduleFormController } from './useCsvImportScheduleForm';
import type { CsvImportScheduleRunController } from './useCsvImportScheduleRun';
import type { CsvDashboard } from '../../../api/client';

type CsvImportScheduleListSectionProps = {
  form: CsvImportScheduleFormController;
  run: CsvImportScheduleRunController;
  csvDashboardsData: CsvDashboard[] | undefined;
};

export function CsvImportScheduleListSection({ form, run, csvDashboardsData }: CsvImportScheduleListSectionProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-200 text-slate-900">
          <tr className="border-b-2 border-slate-500">
            <th className="px-2 py-1">ID</th>
            <th className="px-2 py-1">名前</th>
            <th className="px-2 py-1">プロバイダー</th>
            <th className="px-2 py-1">スケジュール</th>
            <th className="px-2 py-1">CSVパス</th>
            <th className="px-2 py-1">状態</th>
            <th className="px-2 py-1">自動バックアップ</th>
            <th className="px-2 py-1">操作</th>
          </tr>
        </thead>
        <tbody>
          {form.schedules.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-2 py-4 text-center text-slate-600">
                スケジュールがありません
              </td>
            </tr>
          ) : (
            form.schedules.map((schedule) => (
              <tr key={schedule.id} className="border-t border-slate-500">
                {form.editingId === schedule.id ? (
                  <>
                    <td className="px-2 py-1">{schedule.id}</td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 text-xs"
                        value={form.formData.name}
                        onChange={(e) => form.setFormData({ ...form.formData, name: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 text-xs"
                        value={form.formData.provider || ''}
                        onChange={(e) => form.setFormData({ ...form.formData, provider: e.target.value === '' ? undefined : e.target.value as 'dropbox' | 'gmail' })}
                      >
                        <option value="">デフォルト</option>
                        <option value="dropbox">Dropbox</option>
                        <option value="gmail">Gmail</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <CsvImportScheduleTimingFields
                        variant="edit"
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
                    </td>
                    <td className="px-2 py-1">
                      <CsvImportTargetsEditor
                        formData={form.formData}
                        setFormData={form.setFormData}
                        provider={form.formData.provider}
                        patternsByType={form.patternsByType}
                        csvDashboards={csvDashboardsData}
                        editingId={form.editingId}
                        compact
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={form.formData.enabled}
                        onChange={(e) => form.setFormData({ ...form.formData, enabled: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {form.formData.autoBackupAfterImport?.enabled ? '有効' : '無効'}
                    </td>
                    <td className="px-2 py-1">
                      <div className="space-y-1">
                        {form.validationError && (
                          <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                            {form.validationError}
                          </div>
                        )}
                        {form.update.isError && (
                          <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                            {formatCsvImportError(form.update.error)}
                          </div>
                        )}
                        {form.update.isSuccess && (
                          <div className="rounded-md border border-emerald-600 bg-emerald-50 p-1 text-xs text-emerald-700">
                            更新しました
                          </div>
                        )}
                        <div className="flex gap-1">
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => form.handleUpdate(schedule.id)}
                            disabled={form.update.isPending || !form.scheduleEditable}
                          >
                            {form.update.isPending ? '保存中...' : '保存'}
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="ghost"
                            onClick={form.cancelEdit}
                            disabled={form.update.isPending}
                          >
                            キャンセル
                          </Button>
                        </div>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-1 font-mono text-xs">{schedule.id}</td>
                    <td className="px-2 py-1">{schedule.name || '-'}</td>
                    <td className="px-2 py-1">
                      <span className="text-xs font-semibold text-slate-700">
                        {schedule.provider ? schedule.provider.toUpperCase() : 'デフォルト'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-xs">{formatScheduleForDisplay(schedule.schedule)}</td>
                    <td className="px-2 py-1">
                      <div className="space-y-1">
                        {schedule.targets && schedule.targets.length > 0 ? (
                          schedule.targets.map((target, idx) => (
                            <div key={idx} className="text-xs font-mono">
                              {target.type}: {target.source}
                            </div>
                          ))
                        ) : (
                          <>
                            {schedule.employeesPath && (
                              <div className="text-xs font-mono">employees: {schedule.employeesPath}</div>
                            )}
                            {schedule.itemsPath && (
                              <div className="text-xs font-mono">items: {schedule.itemsPath}</div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <span className={schedule.enabled ? 'text-emerald-400' : 'text-slate-600'}>
                        {schedule.enabled ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      {schedule.autoBackupAfterImport?.enabled ? (
                        <span className="text-emerald-400">
                          {schedule.autoBackupAfterImport.targets?.join(', ')}
                        </span>
                      ) : (
                        <span className="text-slate-600">無効</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <div className="space-y-1">
                        {run.runError[schedule.id] && (
                          <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                            実行エラー: {formatCsvImportError(run.runError[schedule.id])}
                          </div>
                        )}
                        {run.runMessage[schedule.id] && (
                          <div className="rounded-md border border-emerald-600 bg-emerald-50 p-1 text-xs text-emerald-700">
                            {run.runMessage[schedule.id]}
                          </div>
                        )}
                        {form.remove.isError && (
                          <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                            削除エラー: {formatCsvImportError(form.remove.error)}
                          </div>
                        )}
                        <div className="flex gap-1">
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => run.handleRun(schedule.id)}
                            disabled={run.runningScheduleId === schedule.id || run.runningScheduleId !== null || form.remove.isPending || form.update.isPending}
                          >
                            {run.runningScheduleId === schedule.id ? '実行中...' : '実行'}
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="ghost"
                            onClick={() => form.startEdit(schedule)}
                            disabled={run.runningScheduleId !== null || form.remove.isPending || form.update.isPending}
                          >
                            編集
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="ghost"
                            onClick={() => form.handleDelete(schedule.id)}
                            disabled={form.remove.isPending || run.runningScheduleId !== null || form.update.isPending}
                          >
                            {form.remove.isPending ? '削除中...' : '削除'}
                          </Button>
                        </div>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
