import { useEffect, useMemo, useState } from 'react';

import {
  useClients,
  useImportProductionScheduleResourceCodeMappingsFromCsv,
  useProductionScheduleDueManagementAccessPasswordSettings,
  useProductionScheduleProcessingTypeOptions,
  useProductionScheduleResourceCodeMappings,
  useProductionScheduleResourceCategorySettings,
  useUpdateProductionScheduleDueManagementAccessPassword,
  useUpdateProductionScheduleProcessingTypeOptions,
  useUpdateProductionScheduleResourceCodeMappings,
  useUpdateProductionScheduleResourceCategorySettings
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

const DEFAULT_LOCATION = 'shared';

const parseResourceCds = (value: string): string[] => {
  const unique = new Set<string>();
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => unique.add(item));
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
};

export function ProductionScheduleSettingsPage() {
  const clientsQuery = useClients();
  const [location, setLocation] = useState<string>(DEFAULT_LOCATION);
  const settingsQuery = useProductionScheduleResourceCategorySettings(location);
  const processingTypeOptionsQuery = useProductionScheduleProcessingTypeOptions(location);
  const resourceCodeMappingsQuery = useProductionScheduleResourceCodeMappings(location);
  const dueManagementAccessPasswordSettingsQuery = useProductionScheduleDueManagementAccessPasswordSettings(DEFAULT_LOCATION);
  const updateSettingsMutation = useUpdateProductionScheduleResourceCategorySettings();
  const updateDueManagementAccessPasswordMutation = useUpdateProductionScheduleDueManagementAccessPassword();
  const updateProcessingTypeOptionsMutation = useUpdateProductionScheduleProcessingTypeOptions();
  const updateResourceCodeMappingsMutation = useUpdateProductionScheduleResourceCodeMappings();
  const importResourceCodeMappingsMutation = useImportProductionScheduleResourceCodeMappingsFromCsv();
  const [cuttingExcludedInput, setCuttingExcludedInput] = useState('10, MSZ');
  const [processingTypeRows, setProcessingTypeRows] = useState<Array<{ code: string; label: string; priority: number; enabled: boolean }>>([]);
  const [resourceCodeMappingsRows, setResourceCodeMappingsRows] = useState<
    Array<{ fromResourceCd: string; toResourceCd: string; priority: number; enabled: boolean }>
  >([]);
  const [dueManagementPasswordInput, setDueManagementPasswordInput] = useState('');
  const [dueManagementPasswordConfirmInput, setDueManagementPasswordConfirmInput] = useState('');
  const [resourceCodeMappingCsvFile, setResourceCodeMappingCsvFile] = useState<File | null>(null);
  const [resourceCodeMappingImportDryRun, setResourceCodeMappingImportDryRun] = useState(true);
  const [resourceCodeMappingImportResult, setResourceCodeMappingImportResult] = useState<{
    location: string;
    dryRun: boolean;
    totalRows: number;
    rowsWithGroupCd: number;
    generatedMappings: number;
    skippedEmptyRows: number;
    skippedDuplicateRows: number;
    skippedUnknownResourceCds: string[];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const locationOptions = useMemo(() => {
    const unique = new Set<string>([DEFAULT_LOCATION]);
    (settingsQuery.data?.locations ?? []).forEach((item) => {
      const normalized = item.trim();
      if (normalized.length > 0) unique.add(normalized);
    });
    (resourceCodeMappingsQuery.data?.locations ?? []).forEach((item) => {
      const normalized = item.trim();
      if (normalized.length > 0) unique.add(normalized);
    });
    (clientsQuery.data ?? []).forEach((client) => {
      const normalized = String(client.location ?? '').trim();
      if (normalized.length > 0) unique.add(normalized);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [clientsQuery.data, resourceCodeMappingsQuery.data?.locations, settingsQuery.data?.locations]);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setCuttingExcludedInput(settings.cuttingExcludedResourceCds.join(', '));
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    setProcessingTypeRows(processingTypeOptionsQuery.data?.settings.options ?? []);
  }, [processingTypeOptionsQuery.data?.settings.options]);

  useEffect(() => {
    setResourceCodeMappingsRows(resourceCodeMappingsQuery.data?.settings.mappings ?? []);
  }, [resourceCodeMappingsQuery.data?.settings.mappings]);

  const parsedResourceCds = useMemo(() => parseResourceCds(cuttingExcludedInput), [cuttingExcludedInput]);

  const handleSave = async () => {
    setMessage(null);
    await updateSettingsMutation.mutateAsync({
      location,
      cuttingExcludedResourceCds: parsedResourceCds
    });
    setMessage('設定を保存しました');
  };

  const handleSaveProcessingOptions = async () => {
    setMessage(null);
    await updateProcessingTypeOptionsMutation.mutateAsync({
      location,
      options: processingTypeRows
    });
    setMessage('処理候補を保存しました');
  };

  const handleSaveResourceCodeMappings = async () => {
    setMessage(null);
    await updateResourceCodeMappingsMutation.mutateAsync({
      location,
      mappings: resourceCodeMappingsRows
    });
    setMessage('資源CDマッピングを保存しました');
  };

  const handleImportResourceCodeMappingsCsv = async () => {
    if (!resourceCodeMappingCsvFile) {
      setMessage('CSVファイルを選択してください');
      return;
    }
    setMessage(null);
    const csvText = await resourceCodeMappingCsvFile.text();
    const result = await importResourceCodeMappingsMutation.mutateAsync({
      location,
      csvText,
      dryRun: resourceCodeMappingImportDryRun
    });
    setResourceCodeMappingImportResult(result);
    if (result.dryRun) {
      setMessage('CSV取込ドライランが完了しました');
      return;
    }
    setMessage('CSV取込を実行し、資源CDマッピングを更新しました');
  };

  const handleSaveDueManagementPassword = async () => {
    if (dueManagementPasswordInput.trim().length === 0) {
      setMessage('納期管理アクセスパスワードを入力してください');
      return;
    }
    if (dueManagementPasswordInput !== dueManagementPasswordConfirmInput) {
      setMessage('確認用パスワードが一致しません');
      return;
    }
    setMessage(null);
    await updateDueManagementAccessPasswordMutation.mutateAsync({
      location: DEFAULT_LOCATION,
      password: dueManagementPasswordInput
    });
    setDueManagementPasswordInput('');
    setDueManagementPasswordConfirmInput('');
    setMessage('納期管理アクセスパスワードを保存しました');
  };

  return (
    <div className="space-y-6">
      <Card title="生産スケジュール設定（切削除外リスト）">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            切削工程フィルタから除外したい資源CDを設定します。研削は固定リスト、切削は「研削以外」からここで指定した資源CDを除外します。
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">対象ロケーション</label>
              <select
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-xs font-semibold text-slate-900"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              >
                {locationOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">切削除外リスト（カンマ区切り）</label>
              <Input
                value={cuttingExcludedInput}
                onChange={(event) => setCuttingExcludedInput(event.target.value)}
                placeholder="例: 10, MSZ"
              />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">正規化後の除外資源CD</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {parsedResourceCds.length === 0 ? (
                <span className="text-xs text-slate-500">除外対象なし</span>
              ) : (
                parsedResourceCds.map((resourceCd) => (
                  <span
                    key={resourceCd}
                    className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white"
                  >
                    {resourceCd}
                  </span>
                ))
              )}
            </div>
          </div>

          {settingsQuery.isLoading ? (
            <p className="text-xs text-slate-600">読み込み中...</p>
          ) : null}
          {settingsQuery.isError ? (
            <p className="text-xs font-semibold text-rose-600">設定の取得に失敗しました。</p>
          ) : null}
          {message ? (
            <p className="text-xs font-semibold text-emerald-700">{message}</p>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={updateSettingsMutation.isPending || settingsQuery.isLoading}>
              {updateSettingsMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </Card>
      <Card title="表面処理候補設定">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            キオスクの処理ドロップダウン候補をロケーション単位で編集できます。無効にした候補は一覧に表示されません。
          </p>
          <div className="space-y-2">
            {processingTypeRows.map((row, index) => (
              <div key={`${row.code}-${index}`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.code}
                  onChange={(event) =>
                    setProcessingTypeRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, code: event.target.value } : item))
                    )
                  }
                  className="col-span-3 rounded-md border border-slate-300 p-2 text-xs"
                  placeholder="コード"
                />
                <input
                  value={row.label}
                  onChange={(event) =>
                    setProcessingTypeRows((prev) =>
                      prev.map((item, idx) => (idx === index ? { ...item, label: event.target.value } : item))
                    )
                  }
                  className="col-span-4 rounded-md border border-slate-300 p-2 text-xs"
                  placeholder="表示名"
                />
                <input
                  type="number"
                  value={row.priority}
                  min={1}
                  max={999}
                  onChange={(event) =>
                    setProcessingTypeRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, priority: Number(event.target.value || 999) } : item
                      )
                    )
                  }
                  className="col-span-2 rounded-md border border-slate-300 p-2 text-xs"
                />
                <label className="col-span-2 flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) =>
                      setProcessingTypeRows((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, enabled: event.target.checked } : item))
                      )
                    }
                  />
                  有効
                </label>
                <button
                  type="button"
                  className="col-span-1 rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white"
                  onClick={() => setProcessingTypeRows((prev) => prev.filter((_, idx) => idx !== index))}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                setProcessingTypeRows((prev) => [
                  ...prev,
                  { code: `新規${prev.length + 1}`, label: `新規${prev.length + 1}`, priority: prev.length + 1, enabled: true }
                ])
              }
              variant="secondary"
            >
              候補を追加
            </Button>
            <Button
              onClick={handleSaveProcessingOptions}
              disabled={updateProcessingTypeOptionsMutation.isPending || processingTypeOptionsQuery.isLoading}
            >
              {updateProcessingTypeOptionsMutation.isPending ? '保存中...' : '候補を保存'}
            </Button>
          </div>
        </div>
      </Card>
      <Card title="実績工数 資源CDマッピング設定">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            実績基準時間の探索時に、資源CDが一致しない場合のフォールバックを定義します（例: 26M → 25M）。
          </p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">CSV一括取込（FSIGENCD / GroupCD）</p>
            <p className="mt-1 text-xs text-slate-600">
              GroupCD単位で資源CDペアを展開し、マッピングを一括更新します。通常は先にドライランで件数確認してください。
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setResourceCodeMappingCsvFile(event.target.files?.[0] ?? null)}
                  className="w-full rounded-md border border-slate-300 p-2 text-xs"
                />
              </div>
              <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={resourceCodeMappingImportDryRun}
                  onChange={(event) => setResourceCodeMappingImportDryRun(event.target.checked)}
                />
                dryRun
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={handleImportResourceCodeMappingsCsv}
                disabled={importResourceCodeMappingsMutation.isPending}
              >
                {importResourceCodeMappingsMutation.isPending ? 'CSV取込中...' : 'CSVを取り込む'}
              </Button>
            </div>
            {resourceCodeMappingImportResult ? (
              <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
                <p className="font-semibold">
                  取込結果（{resourceCodeMappingImportResult.dryRun ? 'dryRun' : 'apply'} / location:{' '}
                  {resourceCodeMappingImportResult.location}）
                </p>
                <p className="mt-1">
                  全行: {resourceCodeMappingImportResult.totalRows} / GroupCD有効行:{' '}
                  {resourceCodeMappingImportResult.rowsWithGroupCd} / 生成マッピング:{' '}
                  {resourceCodeMappingImportResult.generatedMappings}
                </p>
                <p>
                  空行スキップ: {resourceCodeMappingImportResult.skippedEmptyRows} / 重複スキップ:{' '}
                  {resourceCodeMappingImportResult.skippedDuplicateRows}
                </p>
                <p>
                  未登録資源CDスキップ: {resourceCodeMappingImportResult.skippedUnknownResourceCds.length}
                  {resourceCodeMappingImportResult.skippedUnknownResourceCds.length > 0
                    ? ` (${resourceCodeMappingImportResult.skippedUnknownResourceCds.join(', ')})`
                    : ''}
                </p>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            {resourceCodeMappingsRows.map((row, index) => (
              <div key={`${row.fromResourceCd}-${row.toResourceCd}-${index}`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.fromResourceCd}
                  onChange={(event) =>
                    setResourceCodeMappingsRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, fromResourceCd: event.target.value } : item
                      )
                    )
                  }
                  className="col-span-3 rounded-md border border-slate-300 p-2 text-xs"
                  placeholder="元資源CD"
                />
                <input
                  value={row.toResourceCd}
                  onChange={(event) =>
                    setResourceCodeMappingsRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, toResourceCd: event.target.value } : item
                      )
                    )
                  }
                  className="col-span-3 rounded-md border border-slate-300 p-2 text-xs"
                  placeholder="先資源CD"
                />
                <input
                  type="number"
                  value={row.priority}
                  min={1}
                  max={999}
                  onChange={(event) =>
                    setResourceCodeMappingsRows((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, priority: Number(event.target.value || 999) } : item
                      )
                    )
                  }
                  className="col-span-2 rounded-md border border-slate-300 p-2 text-xs"
                />
                <label className="col-span-2 flex items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) =>
                      setResourceCodeMappingsRows((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, enabled: event.target.checked } : item))
                      )
                    }
                  />
                  有効
                </label>
                <button
                  type="button"
                  className="col-span-2 rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white"
                  onClick={() => setResourceCodeMappingsRows((prev) => prev.filter((_, idx) => idx !== index))}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                setResourceCodeMappingsRows((prev) => [
                  ...prev,
                  { fromResourceCd: '', toResourceCd: '', priority: prev.length + 1, enabled: true }
                ])
              }
              variant="secondary"
            >
              マッピングを追加
            </Button>
            <Button
              onClick={handleSaveResourceCodeMappings}
              disabled={updateResourceCodeMappingsMutation.isPending || resourceCodeMappingsQuery.isLoading}
            >
              {updateResourceCodeMappingsMutation.isPending ? '保存中...' : 'マッピングを保存'}
            </Button>
          </div>
        </div>
      </Card>
      <Card title="納期管理アクセス設定">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-700">
            キオスクの「納期管理」ボタン押下時に要求するパスワードを設定します（shared共通）。未設定時は初期パスワード「2520」が有効です。
          </p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">
              現在状態:{' '}
              {dueManagementAccessPasswordSettingsQuery.data?.configured ? '設定済み（カスタム）' : '未設定（初期パスワード2520）'}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">新しいパスワード</label>
              <Input
                type="password"
                value={dueManagementPasswordInput}
                onChange={(event) => setDueManagementPasswordInput(event.target.value)}
                placeholder="納期管理アクセスパスワード"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">確認用パスワード</label>
              <Input
                type="password"
                value={dueManagementPasswordConfirmInput}
                onChange={(event) => setDueManagementPasswordConfirmInput(event.target.value)}
                placeholder="確認用パスワード"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSaveDueManagementPassword}
              disabled={updateDueManagementAccessPasswordMutation.isPending || dueManagementAccessPasswordSettingsQuery.isLoading}
            >
              {updateDueManagementAccessPasswordMutation.isPending ? '保存中...' : 'パスワードを保存'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
