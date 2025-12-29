import axios from 'axios';
import { useState } from 'react';

import { useCsvImportSchedules, useCsvImportScheduleMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { CsvImportSchedule } from '../../api/backup';

// Gmailのよく使う件名パターン
const GMAIL_SUBJECT_PATTERNS = {
  employees: [
    '[Pi5 CSV Import] employees',
    '[CSV Import] employees',
    'CSV Import - employees',
    '従業員CSVインポート'
  ],
  items: [
    '[Pi5 CSV Import] items',
    '[CSV Import] items',
    'CSV Import - items',
    'アイテムCSVインポート'
  ]
};

export function CsvImportSchedulePage() {
  const { data, isLoading, refetch } = useCsvImportSchedules();
  const { create, update, remove, run } = useCsvImportScheduleMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const schedules = data?.schedules ?? [];

  const [formData, setFormData] = useState<Partial<CsvImportSchedule>>({
    id: '',
    name: '',
    provider: undefined, // デフォルトは未指定（storage.providerを使用）
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

  const formatError = (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { message?: unknown } | undefined;
      const message = typeof data?.message === 'string' ? data.message : undefined;
      return message || error.message;
    }
    return error instanceof Error ? error.message : '操作に失敗しました';
  };

  const handleCreate = async () => {
    setValidationError(null);

    if (!formData.id?.trim()) {
      setValidationError('IDは必須です');
      return;
    }

    if (!formData.employeesPath?.trim() && !formData.itemsPath?.trim()) {
      setValidationError('従業員CSVパスまたはアイテムCSVパスのいずれかは必須です');
      return;
    }

    if (!formData.schedule?.trim()) {
      setValidationError('スケジュール（cron形式）は必須です');
      return;
    }

    try {
      await create.mutateAsync(formData as CsvImportSchedule);
      setShowCreateForm(false);
      setFormData({
        id: '',
        name: '',
        provider: undefined,
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
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const handleUpdate = async (id: string) => {
    setValidationError(null);

    if (!formData.employeesPath?.trim() && !formData.itemsPath?.trim()) {
      setValidationError('従業員CSVパスまたはアイテムCSVパスのいずれかは必須です');
      return;
    }

    if (!formData.schedule?.trim()) {
      setValidationError('スケジュール（cron形式）は必須です');
      return;
    }

    try {
      await update.mutateAsync({ id, schedule: formData });
      setEditingId(null);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const handleDelete = async (id: string) => {
    const schedule = schedules.find((s) => s.id === id);

    if (
      !confirm(
        `以下のスケジュールを削除しますか？\n\nID: ${schedule?.id}\n名前: ${schedule?.name || '-'}\nスケジュール: ${schedule?.schedule}\n\nこの操作は取り消せません。`
      )
    ) {
      return;
    }

    try {
      await remove.mutateAsync(id);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const handleRun = async (id: string) => {
    const schedule = schedules.find((s) => s.id === id);
    const scheduleName = schedule?.name || schedule?.id || 'このスケジュール';
    const provider = schedule?.provider ? schedule.provider.toUpperCase() : 'デフォルト';
    const paths = [
      schedule?.employeesPath && `従業員: ${schedule.employeesPath}`,
      schedule?.itemsPath && `アイテム: ${schedule.itemsPath}`
    ]
      .filter(Boolean)
      .join('\n');

    if (
      !confirm(
        `以下のスケジュールを手動実行しますか？\n\nID: ${schedule?.id}\n名前: ${scheduleName}\nプロバイダー: ${provider}\n${paths ? `\n${paths}` : ''}\n\nこの操作は即座に実行されます。`
      )
    ) {
      return;
    }

    try {
      await run.mutateAsync(id);
      refetch();
    } catch (error) {
      // エラーはmutationのisErrorで表示
    }
  };

  const startEdit = (schedule: CsvImportSchedule) => {
    setEditingId(schedule.id);
    setFormData(schedule);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setValidationError(null);
    setFormData({
      id: '',
      name: '',
      provider: undefined,
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

  const handleCancelCreate = () => {
    setShowCreateForm(false);
    setValidationError(null);
    setFormData({
      id: '',
      name: '',
      provider: undefined,
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
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={isLoading}
            onClick={() => refetch()}
          >
            一覧更新
          </Button>
          <Button onClick={() => setShowCreateForm(true)} disabled={showCreateForm || editingId !== null}>
            新規作成
          </Button>
        </div>
      }
    >
      {showCreateForm && (
        <div className="mb-4 rounded-md border-2 border-slate-500 bg-slate-100 p-4 shadow-lg">
          <h3 className="mb-3 text-lg font-bold text-slate-900">新規スケジュール作成</h3>
          
          {validationError && (
            <div className="mb-3 rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
              エラー: {validationError}
            </div>
          )}

          {create.isError && (
            <div className="mb-3 rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
              エラー: {formatError(create.error)}
            </div>
          )}

          {create.isSuccess && (
            <div className="mb-3 rounded-md border-2 border-emerald-700 bg-emerald-600 p-3 text-sm font-semibold text-white shadow-lg">
              スケジュールを作成しました
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                ID *
              </label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                名前
              </label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                プロバイダー（オプション）
              </label>
              <select
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={formData.provider || ''}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value === '' ? undefined : e.target.value as 'dropbox' | 'gmail' })}
              >
                <option value="">デフォルト（設定ファイルのstorage.providerを使用）</option>
                <option value="dropbox">Dropbox</option>
                <option value="gmail">Gmail</option>
              </select>
              <p className="mt-1 text-xs text-slate-600">
                Gmailの場合、employeesPath/itemsPathは件名パターン（例: [Pi5 CSV Import] employees）を指定します
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                従業員CSVパス
              </label>
              {formData.provider === 'gmail' ? (
                <>
                  <select
                    className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                    value={formData.employeesPath || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'custom') {
                        setFormData({ ...formData, employeesPath: '' });
                      } else {
                        setFormData({ ...formData, employeesPath: value });
                      }
                    }}
                  >
                    <option value="">選択してください</option>
                    {GMAIL_SUBJECT_PATTERNS.employees.map((pattern) => (
                      <option key={pattern} value={pattern}>
                        {pattern}
                      </option>
                    ))}
                    <option value="custom">カスタム（手動入力）</option>
                  </select>
                  {(!formData.employeesPath || formData.employeesPath === 'custom' || !GMAIL_SUBJECT_PATTERNS.employees.includes(formData.employeesPath as typeof GMAIL_SUBJECT_PATTERNS.employees[number])) && (
                    <input
                      type="text"
                      className="mt-2 w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                      placeholder="[Pi5 CSV Import] employees"
                      value={formData.employeesPath === 'custom' ? '' : formData.employeesPath}
                      onChange={(e) => setFormData({ ...formData, employeesPath: e.target.value })}
                    />
                  )}
                  <p className="mt-1 text-xs text-slate-600">
                    Gmail検索用の件名パターン（例: [Pi5 CSV Import] employees）
                  </p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                    placeholder="/backups/csv/employees.csv"
                    value={formData.employeesPath}
                    onChange={(e) => setFormData({ ...formData, employeesPath: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-slate-600">
                    Dropboxのパス（例: /backups/csv/employees.csv）
                  </p>
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                アイテムCSVパス
              </label>
              {formData.provider === 'gmail' ? (
                <>
                  <select
                    className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                    value={formData.itemsPath || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'custom') {
                        setFormData({ ...formData, itemsPath: '' });
                      } else {
                        setFormData({ ...formData, itemsPath: value });
                      }
                    }}
                  >
                    <option value="">選択してください</option>
                    {GMAIL_SUBJECT_PATTERNS.items.map((pattern) => (
                      <option key={pattern} value={pattern}>
                        {pattern}
                      </option>
                    ))}
                    <option value="custom">カスタム（手動入力）</option>
                  </select>
                  {(!formData.itemsPath || formData.itemsPath === 'custom' || !GMAIL_SUBJECT_PATTERNS.items.includes(formData.itemsPath as typeof GMAIL_SUBJECT_PATTERNS.items[number])) && (
                    <input
                      type="text"
                      className="mt-2 w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                      placeholder="[Pi5 CSV Import] items"
                      value={formData.itemsPath === 'custom' ? '' : formData.itemsPath}
                      onChange={(e) => setFormData({ ...formData, itemsPath: e.target.value })}
                    />
                  )}
                  <p className="mt-1 text-xs text-slate-600">
                    Gmail検索用の件名パターン（例: [Pi5 CSV Import] items）
                  </p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                    placeholder="/backups/csv/items.csv"
                    value={formData.itemsPath}
                    onChange={(e) => setFormData({ ...formData, itemsPath: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-slate-600">
                    Dropboxのパス（例: /backups/csv/items.csv）
                  </p>
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                スケジュール（cron形式） *
              </label>
              <input
                type="text"
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                placeholder="0 2 * * *"
                value={formData.schedule}
                onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-600">
                例: 0 2 * * * (毎日2時)
              </p>
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
                <div className="ml-6 mt-2 space-y-1">
                  <p className="text-xs text-slate-600">バックアップ対象:</p>
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
              <Button onClick={handleCreate} disabled={create.isPending}>
                {create.isPending ? '作成中...' : '作成'}
              </Button>
              <Button variant="ghost" onClick={handleCancelCreate} disabled={create.isPending}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

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
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-slate-600">
                  スケジュールがありません
                </td>
              </tr>
            ) : (
              schedules.map((schedule) => (
                <tr key={schedule.id} className="border-t border-slate-500">
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
                        <select
                          className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 text-xs"
                          value={formData.provider || ''}
                          onChange={(e) => setFormData({ ...formData, provider: e.target.value === '' ? undefined : e.target.value as 'dropbox' | 'gmail' })}
                        >
                          <option value="">デフォルト</option>
                          <option value="dropbox">Dropbox</option>
                          <option value="gmail">Gmail</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          className="w-full rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 font-mono text-xs"
                          placeholder="0 2 * * *"
                          value={formData.schedule}
                          onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="space-y-1">
                          {formData.provider === 'gmail' ? (
                            <>
                              <select
                                className="w-full rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 text-xs"
                                value={formData.employeesPath || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === 'custom') {
                                    setFormData({ ...formData, employeesPath: '' });
                                  } else {
                                    setFormData({ ...formData, employeesPath: value });
                                  }
                                }}
                              >
                                <option value="">従業員CSV選択</option>
                                {GMAIL_SUBJECT_PATTERNS.employees.map((pattern) => (
                                  <option key={pattern} value={pattern}>
                                    {pattern}
                                  </option>
                                ))}
                                <option value="custom">カスタム</option>
                              </select>
                              {(!formData.employeesPath || formData.employeesPath === 'custom' || !GMAIL_SUBJECT_PATTERNS.employees.includes(formData.employeesPath as typeof GMAIL_SUBJECT_PATTERNS.employees[number])) && (
                                <input
                                  type="text"
                                  className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 font-mono text-xs"
                                  placeholder="[Pi5 CSV Import] employees"
                                  value={formData.employeesPath === 'custom' ? '' : formData.employeesPath}
                                  onChange={(e) => setFormData({ ...formData, employeesPath: e.target.value })}
                                />
                              )}
                              <select
                                className="w-full rounded-md border-2 border-slate-500 bg-white p-1 text-slate-900 text-xs"
                                value={formData.itemsPath || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === 'custom') {
                                    setFormData({ ...formData, itemsPath: '' });
                                  } else {
                                    setFormData({ ...formData, itemsPath: value });
                                  }
                                }}
                              >
                                <option value="">アイテムCSV選択</option>
                                {GMAIL_SUBJECT_PATTERNS.items.map((pattern) => (
                                  <option key={pattern} value={pattern}>
                                    {pattern}
                                  </option>
                                ))}
                                <option value="custom">カスタム</option>
                              </select>
                              {(!formData.itemsPath || formData.itemsPath === 'custom' || !GMAIL_SUBJECT_PATTERNS.items.includes(formData.itemsPath as typeof GMAIL_SUBJECT_PATTERNS.items[number])) && (
                                <input
                                  type="text"
                                  className="w-full rounded-md border-2 border-slate-500 bg-slate-100 p-1 text-slate-900 font-mono text-xs"
                                  placeholder="[Pi5 CSV Import] items"
                                  value={formData.itemsPath === 'custom' ? '' : formData.itemsPath}
                                  onChange={(e) => setFormData({ ...formData, itemsPath: e.target.value })}
                                />
                              )}
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
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
                        <div className="space-y-1">
                          {validationError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              {validationError}
                            </div>
                          )}
                          {update.isError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              {formatError(update.error)}
                            </div>
                          )}
                          {update.isSuccess && (
                            <div className="rounded-md border border-emerald-600 bg-emerald-50 p-1 text-xs text-emerald-700">
                              更新しました
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button
                              className="px-2 py-1 text-xs"
                              onClick={() => handleUpdate(schedule.id)}
                              disabled={update.isPending}
                            >
                              {update.isPending ? '保存中...' : '保存'}
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={update.isPending}
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
                        <div className="space-y-1">
                          {run.isError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              実行エラー: {formatError(run.error)}
                            </div>
                          )}
                          {run.isSuccess && (
                            <div className="rounded-md border border-emerald-600 bg-emerald-50 p-1 text-xs text-emerald-700">
                              実行しました
                            </div>
                          )}
                          {remove.isError && (
                            <div className="rounded-md border border-red-600 bg-red-50 p-1 text-xs text-red-700">
                              削除エラー: {formatError(remove.error)}
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button
                              className="px-2 py-1 text-xs"
                              onClick={() => handleRun(schedule.id)}
                              disabled={run.isPending || remove.isPending || update.isPending}
                            >
                              {run.isPending ? '実行中...' : '実行'}
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={() => startEdit(schedule)}
                              disabled={run.isPending || remove.isPending || update.isPending}
                            >
                              編集
                            </Button>
                            <Button
                              className="px-2 py-1 text-xs"
                              variant="ghost"
                              onClick={() => handleDelete(schedule.id)}
                              disabled={remove.isPending || run.isPending || update.isPending}
                            >
                              {remove.isPending ? '削除中...' : '削除'}
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
    </Card>
  );
}
