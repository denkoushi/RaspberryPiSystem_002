import { useState } from 'react';

import { useCsvImportSchedules, useCsvImportScheduleMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { CsvImportSchedule } from '../../api/backup';

export function CsvImportSchedulePage() {
  const { data, isLoading } = useCsvImportSchedules();
  const { create, update, remove, run } = useCsvImportScheduleMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const schedules = data?.schedules ?? [];

  const [formData, setFormData] = useState<Partial<CsvImportSchedule>>({
    id: '',
    name: '',
    employeesPath: '',
    itemsPath: '',
    schedule: '0 2 * * *',
    timezone: 'Asia/Tokyo',
    enabled: true,
    replaceExisting: false,
    autoBackupAfterImport: {
      enabled: false,
      targets: ['csv']
    }
  });

  const handleCreate = async () => {
    if (!formData.id || (!formData.employeesPath && !formData.itemsPath)) {
      alert('IDとCSVパス（employeesPathまたはitemsPath）は必須です');
      return;
    }

    try {
      await create.mutateAsync(formData as CsvImportSchedule);
      setShowCreateForm(false);
      setFormData({
        id: '',
        name: '',
        employeesPath: '',
        itemsPath: '',
        schedule: '0 2 * * *',
        timezone: 'Asia/Tokyo',
        enabled: true,
        replaceExisting: false,
        autoBackupAfterImport: {
          enabled: false,
          targets: ['csv']
        }
      });
      alert('スケジュールを作成しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'スケジュールの作成に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await update.mutateAsync({ id, schedule: formData });
      setEditingId(null);
      alert('スケジュールを更新しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'スケジュールの更新に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このスケジュールを削除しますか？')) {
      return;
    }

    try {
      await remove.mutateAsync(id);
      alert('スケジュールを削除しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'スケジュールの削除に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const handleRun = async (id: string) => {
    if (!confirm('このスケジュールを手動実行しますか？')) {
      return;
    }

    try {
      await run.mutateAsync(id);
      alert('インポートを実行しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'インポートの実行に失敗しました';
      alert(`エラー: ${errorMessage}`);
    }
  };

  const startEdit = (schedule: CsvImportSchedule) => {
    setEditingId(schedule.id);
    setFormData(schedule);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData({
      id: '',
      name: '',
      employeesPath: '',
      itemsPath: '',
      schedule: '0 2 * * *',
      timezone: 'Asia/Tokyo',
      enabled: true,
      replaceExisting: false,
      autoBackupAfterImport: {
        enabled: false,
        targets: ['csv']
      }
    });
  };

  if (isLoading) {
    return <Card title="CSVインポートスケジュール"><p className="text-sm font-semibold text-slate-700">読み込み中...</p></Card>;
  }

  return (
    <Card
      title="CSVインポートスケジュール"
      action={
        <Button onClick={() => setShowCreateForm(true)} disabled={showCreateForm || editingId !== null}>
          新規作成
        </Button>
      }
    >
      {showCreateForm && (
        <div className="mb-4 rounded-md border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
          <h3 className="mb-3 text-lg font-bold text-slate-900">新規スケジュール作成</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">ID *</label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-700 font-semibold mb-1">名前</label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-2 text-white"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-700 font-semibold mb-1">従業員CSVパス</label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-2 text-slate-900 font-mono text-sm"
                placeholder="/backups/csv/employees.csv"
                value={formData.employeesPath}
                onChange={(e) => setFormData({ ...formData, employeesPath: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-700 font-semibold mb-1">アイテムCSVパス</label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-2 text-slate-900 font-mono text-sm"
                placeholder="/backups/csv/items.csv"
                value={formData.itemsPath}
                onChange={(e) => setFormData({ ...formData, itemsPath: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-700 font-semibold mb-1">スケジュール（cron形式） *</label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-2 text-slate-900 font-mono text-sm"
                placeholder="0 2 * * *"
                value={formData.schedule}
                onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-600">例: 0 2 * * * (毎日2時)</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              />
              <label htmlFor="enabled" className="text-sm text-slate-700 font-semibold">
                有効
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="replaceExisting"
                checked={formData.replaceExisting}
                onChange={(e) => setFormData({ ...formData, replaceExisting: e.target.checked })}
              />
              <label htmlFor="replaceExisting" className="text-sm text-slate-700 font-semibold">
                既存データを置き換える
              </label>
            </div>
            <div className="rounded-md border-2 border-slate-500 bg-slate-100 p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="autoBackupEnabled"
                  checked={formData.autoBackupAfterImport?.enabled}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      autoBackupAfterImport: {
                        ...formData.autoBackupAfterImport,
                        enabled: e.target.checked,
                        targets: formData.autoBackupAfterImport?.targets || ['csv']
                      }
                    })
                  }
                />
                <label htmlFor="autoBackupEnabled" className="text-sm text-slate-700 font-semibold">
                  インポート後に自動バックアップを実行
                </label>
              </div>
              {formData.autoBackupAfterImport?.enabled && (
                <div className="ml-6 space-y-1">
                  <label className="text-xs text-slate-600">バックアップ対象:</label>
                  <div className="flex flex-wrap gap-2">
                    {(['csv', 'database', 'all'] as const).map((target) => (
                      <label key={target} className="flex items-center gap-1 text-xs text-slate-700 font-semibold">
                        <input
                          type="checkbox"
                          checked={formData.autoBackupAfterImport?.targets?.includes(target)}
                          onChange={(e) => {
                            const currentTargets = formData.autoBackupAfterImport?.targets || [];
                            const newTargets = e.target.checked
                              ? [...currentTargets, target]
                              : currentTargets.filter((t) => t !== target);
                            setFormData({
                              ...formData,
                              autoBackupAfterImport: {
                                ...formData.autoBackupAfterImport,
                                enabled: true,
                                targets: newTargets
                              }
                            });
                          }}
                        />
                        {target === 'csv' ? 'CSV' : target === 'database' ? 'データベース' : 'すべて'}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={create.isPending}>
                作成
              </Button>
              <Button variant="ghost" onClick={() => setShowCreateForm(false)}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-200 text-slate-900">
            <tr>
              <th className="px-2 py-1">ID</th>
              <th className="px-2 py-1">名前</th>
              <th className="px-2 py-1">スケジュール</th>
              <th className="px-2 py-1">CSVパス</th>
              <th className="px-2 py-1">状態</th>
              <th className="px-2 py-1">自動バックアップ</th>
              <th className="px-2 py-1">操作</th>
            </tr>
          </thead>
          <tbody>
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-slate-600">
                  スケジュールがありません
                </td>
              </tr>
            ) : (
              schedules.map((schedule) => (
                <tr key={schedule.id} className="border-t border-white/5">
                  {editingId === schedule.id ? (
                    <>
                      <td className="px-2 py-1">{schedule.id}</td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 text-xs"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 font-mono text-xs"
                          value={formData.schedule}
                          onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          <input
                            type="text"
                            className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 font-mono text-xs"
                            placeholder="従業員CSV"
                            value={formData.employeesPath}
                            onChange={(e) => setFormData({ ...formData, employeesPath: e.target.value })}
                          />
                          <input
                            type="text"
                            className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 font-mono text-xs"
                            placeholder="アイテムCSV"
                            value={formData.itemsPath}
                            onChange={(e) => setFormData({ ...formData, itemsPath: e.target.value })}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={formData.enabled}
                          onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {formData.autoBackupAfterImport?.enabled ? '有効' : '無効'}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1">
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => handleUpdate(schedule.id)}
                            disabled={update.isPending}
                          >
                            保存
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="ghost"
                            onClick={cancelEdit}
                          >
                            キャンセル
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1 font-mono text-xs">{schedule.id}</td>
                      <td className="px-2 py-1">{schedule.name || '-'}</td>
                      <td className="px-2 py-1 font-mono text-xs">{schedule.schedule}</td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          {schedule.employeesPath && (
                            <div className="text-xs font-mono">{schedule.employeesPath}</div>
                          )}
                          {schedule.itemsPath && (
                            <div className="text-xs font-mono">{schedule.itemsPath}</div>
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
                        <div className="flex gap-1">
                          <Button
                            className="px-2 py-1 text-xs"
                            onClick={() => handleRun(schedule.id)}
                            disabled={run.isPending}
                          >
                            実行
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="ghost"
                            onClick={() => startEdit(schedule)}
                          >
                            編集
                          </Button>
                          <Button
                            className="px-2 py-1 text-xs"
                            variant="ghost"
                            onClick={() => handleDelete(schedule.id)}
                            disabled={remove.isPending}
                          >
                            削除
                          </Button>
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
    </Card>
  );
}
