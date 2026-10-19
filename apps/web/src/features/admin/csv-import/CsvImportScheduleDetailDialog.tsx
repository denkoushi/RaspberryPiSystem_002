import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

import { formatCsvImportError } from './csvImportError';
import { CsvImportTargetsEditor } from './CsvImportTargetsEditor';

import type { CsvImportScheduleFormController } from './useCsvImportScheduleForm';
import type { CsvDashboard } from '../../../api/client';

type CsvImportScheduleDetailDialogProps = {
  form: CsvImportScheduleFormController;
  csvDashboardsData: CsvDashboard[] | undefined;
};

/** 時刻以外の設定（名前・取込元・対象）と削除。時刻は盤面で変更する */
export function CsvImportScheduleDetailDialog({ form, csvDashboardsData }: CsvImportScheduleDetailDialogProps) {
  const [error, setError] = useState<unknown>(null);
  const id = form.editingId;

  const close = () => {
    setError(null);
    form.cancelEdit();
  };

  const save = async () => {
    if (!id) return;
    setError(null);
    const { name, provider, targets, employeesPath, itemsPath } = form.formData;
    const hasTargets = (targets?.length ?? 0) > 0;
    if (!hasTargets && !employeesPath?.trim() && !itemsPath?.trim()) {
      setError(new Error('インポート対象を1つ以上指定してください'));
      return;
    }
    try {
      await form.update.mutateAsync({
        id,
        schedule: hasTargets ? { name, provider, targets, employeesPath: undefined, itemsPath: undefined } : { name, provider }
      });
      close();
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <Dialog isOpen={id !== null} onClose={close} title="詳細" size="lg">
      <div className="space-y-4 text-sm text-slate-900">
        <div className="font-mono text-xs text-slate-500">{id}</div>
        <label className="block font-semibold text-slate-700">
          名前
          <input
            type="text"
            className="mt-1 block w-80 max-w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm text-slate-900"
            value={form.formData.name ?? ''}
            onChange={(e) => form.setFormData({ ...form.formData, name: e.target.value })}
          />
        </label>
        <label className="block font-semibold text-slate-700">
          取込元
          <select
            className="mt-1 block rounded-md border-2 border-slate-500 bg-white p-2 text-sm text-slate-900"
            value={form.formData.provider ?? ''}
            onChange={(e) =>
              form.setFormData({
                ...form.formData,
                provider: e.target.value === '' ? undefined : (e.target.value as 'dropbox' | 'gmail')
              })
            }
          >
            <option value="">デフォルト</option>
            <option value="dropbox">Dropbox</option>
            <option value="gmail">Gmail</option>
          </select>
        </label>
        <div>
          <div className="mb-1 font-semibold text-slate-700">対象</div>
          <CsvImportTargetsEditor
            formData={form.formData}
            setFormData={form.setFormData}
            provider={form.formData.provider}
            patternsByType={form.patternsByType}
            csvDashboards={csvDashboardsData}
            editingId={id}
          />
        </div>
        {error != null && (
          <div role="alert" className="rounded-md border border-red-600 bg-red-50 p-2 text-xs text-red-700">
            {formatCsvImportError(error)}
          </div>
        )}
        {form.remove.isError && (
          <div role="alert" className="rounded-md border border-red-600 bg-red-50 p-2 text-xs text-red-700">
            削除エラー: {formatCsvImportError(form.remove.error)}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={form.update.isPending}>
            {form.update.isPending ? '保存中...' : '保存'}
          </Button>
          <Button variant="ghost" onClick={close} disabled={form.update.isPending}>
            キャンセル
          </Button>
          <span className="flex-1" />
          <Button variant="danger" onClick={() => id && form.handleDelete(id)} disabled={form.remove.isPending || form.update.isPending}>
            {form.remove.isPending ? '削除中...' : '削除'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
