import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getCsvDashboard, getCsvDashboards, updateCsvDashboard, uploadCsvToDashboard, type CsvDashboard } from '../../api/client';
import { Button } from '../../components/ui/Button';

export function CsvDashboardsPage() {
  const queryClient = useQueryClient();
  const dashboardsQuery = useQuery({
    queryKey: ['csv-dashboards', { enabled: true }],
    queryFn: () => getCsvDashboards({ enabled: true }),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedDashboardQuery = useQuery({
    queryKey: ['csv-dashboard', selectedId],
    queryFn: () => getCsvDashboard(selectedId!),
    enabled: Boolean(selectedId),
  });

  const selected = selectedDashboardQuery.data ?? null;

  const [displayPeriodDays, setDisplayPeriodDays] = useState<number>(1);
  const [dateColumnName, setDateColumnName] = useState<string>('');
  const [emptyMessage, setEmptyMessage] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(true);

  // 選択が切り替わった時にフォームを同期
  useEffect(() => {
    if (!selected) return;
    setDisplayPeriodDays(selected.displayPeriodDays ?? 1);
    setDateColumnName(selected.dateColumnName ?? '');
    setEmptyMessage(selected.emptyMessage ?? '');
    setEnabled(Boolean(selected.enabled));
  }, [selected]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('CSVダッシュボードが選択されていません');
      return updateCsvDashboard(selectedId, {
        displayPeriodDays,
        dateColumnName: dateColumnName.length > 0 ? dateColumnName : null,
        emptyMessage: emptyMessage.length > 0 ? emptyMessage : null,
        enabled,
      });
    },
    onSuccess: async (dashboard) => {
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboard', dashboard.id] });
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboards'] });
    },
  });

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('CSVダッシュボードが選択されていません');
      if (!uploadFile) throw new Error('CSVファイルが選択されていません');
      return uploadCsvToDashboard(selectedId, uploadFile);
    },
    onSuccess: async () => {
      setUploadFile(null);
      await queryClient.invalidateQueries({ queryKey: ['csv-dashboard', selectedId] });
      await queryClient.invalidateQueries({ queryKey: ['signage-content'] });
    },
  });

  const dashboards = dashboardsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg">
        <h2 className="text-lg font-bold">CSVダッシュボード</h2>
        <p className="mt-1 text-sm text-slate-600">
          検証9（表示期間フィルタ）のため、まずは既存のCSVダッシュボードを選択して「表示期間（日数）」を設定し、CSVをアップロードしてください。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg">
          <h3 className="text-base font-bold">ダッシュボード一覧</h3>
          <div className="mt-3">
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="">選択してください</option>
              {dashboards.map((d: CsvDashboard) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {dashboardsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">読み込み中...</p>}
            {dashboardsQuery.isError && (
              <p className="mt-2 text-xs text-rose-600">一覧の取得に失敗しました。</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg">
          <h3 className="text-base font-bold">設定</h3>

          {!selectedId ? (
            <p className="mt-3 text-sm text-slate-600">左でCSVダッシュボードを選択してください。</p>
          ) : selectedDashboardQuery.isLoading ? (
            <p className="mt-3 text-sm text-slate-600">読み込み中...</p>
          ) : selectedDashboardQuery.isError || !selected ? (
            <p className="mt-3 text-sm text-rose-600">ダッシュボードの取得に失敗しました。</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">表示期間（日数）</label>
                  <input
                    type="number"
                    min={1}
                    value={displayPeriodDays}
                    onChange={(e) => setDisplayPeriodDays(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  />
                  <p className="mt-1 text-xs text-slate-500">当日分のみ = 1 / 直近7日 = 7</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">日付列名（internalName）</label>
                  <input
                    value={dateColumnName}
                    onChange={(e) => setDateColumnName(e.target.value)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    placeholder={selected.dateColumnName ?? '例: date'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">ゼロ件時メッセージ</label>
                <input
                  value={emptyMessage}
                  onChange={(e) => setEmptyMessage(e.target.value)}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  placeholder="例: 本日のデータはありません"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="csv-dashboard-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="csv-dashboard-enabled" className="text-sm font-semibold text-slate-700">
                  有効
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending}
                >
                  設定を保存
                </Button>
                {updateMutation.isError && (
                  <span className="text-sm text-rose-600">保存に失敗しました。</span>
                )}
                {updateMutation.isSuccess && (
                  <span className="text-sm text-emerald-700">保存しました。</span>
                )}
              </div>

              <hr className="border-slate-200" />

              <div>
                <h4 className="text-sm font-bold text-slate-800">CSVアップロード（取り込み）</h4>
                <p className="mt-1 text-xs text-slate-500">当日/前日データ混在CSVをアップロードして検証9を実施できます。</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="text-sm"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => uploadMutation.mutate()}
                    disabled={uploadMutation.isPending}
                  >
                    アップロード
                  </Button>
                  {uploadMutation.isError && (
                    <span className="text-sm text-rose-600">アップロードに失敗しました。</span>
                  )}
                  {uploadMutation.isSuccess && (
                    <span className="text-sm text-emerald-700">アップロードしました。</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

