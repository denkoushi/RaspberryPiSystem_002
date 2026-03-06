import { useEffect, useMemo, useState } from 'react';

import {
  useClients,
  useProductionScheduleResourceCategorySettings,
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
  const updateSettingsMutation = useUpdateProductionScheduleResourceCategorySettings();
  const [cuttingExcludedInput, setCuttingExcludedInput] = useState('10, MSZ');
  const [message, setMessage] = useState<string | null>(null);

  const locationOptions = useMemo(() => {
    const unique = new Set<string>([DEFAULT_LOCATION]);
    (settingsQuery.data?.locations ?? []).forEach((item) => {
      const normalized = item.trim();
      if (normalized.length > 0) unique.add(normalized);
    });
    (clientsQuery.data ?? []).forEach((client) => {
      const normalized = String(client.location ?? '').trim();
      if (normalized.length > 0) unique.add(normalized);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [clientsQuery.data, settingsQuery.data?.locations]);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setCuttingExcludedInput(settings.cuttingExcludedResourceCds.join(', '));
  }, [settingsQuery.data?.settings]);

  const parsedResourceCds = useMemo(() => parseResourceCds(cuttingExcludedInput), [cuttingExcludedInput]);

  const handleSave = async () => {
    setMessage(null);
    await updateSettingsMutation.mutateAsync({
      location,
      cuttingExcludedResourceCds: parsedResourceCds
    });
    setMessage('設定を保存しました');
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
    </div>
  );
}
