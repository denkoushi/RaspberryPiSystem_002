import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  getCsvDashboard,
  getCsvDashboards,
  previewCsvDashboardParse,
  updateCsvDashboard,
  uploadCsvToDashboard,
  type CsvDashboard,
  type CsvPreviewResult,
} from '../../api/client';
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
  const [gmailSubjectPattern, setGmailSubjectPattern] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [columnDefinitions, setColumnDefinitions] = useState<CsvDashboard['columnDefinitions']>([]);
  const [columnDefinitionError, setColumnDefinitionError] = useState<string | null>(null);
  const [previewCsvContent, setPreviewCsvContent] = useState<string>('');
  const [previewResult, setPreviewResult] = useState<CsvPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 選択が切り替わった時にフォームを同期
  useEffect(() => {
    if (!selected) return;
    setDisplayPeriodDays(selected.displayPeriodDays ?? 1);
    setDateColumnName(selected.dateColumnName ?? '');
    setEmptyMessage(selected.emptyMessage ?? '');
    setGmailSubjectPattern(selected.gmailSubjectPattern ?? '');
    setEnabled(Boolean(selected.enabled));
    const sortedColumns = [...(selected.columnDefinitions ?? [])].sort((a, b) => a.order - b.order);
    setColumnDefinitions(sortedColumns.map((col, index) => ({ ...col, order: index })));
    setColumnDefinitionError(null);
    setPreviewCsvContent('');
    setPreviewResult(null);
    setPreviewError(null);
  }, [selected]);

  const normalizedColumnDefinitions = useMemo(
    () => columnDefinitions.map((col, index) => ({ ...col, order: index })),
    [columnDefinitions]
  );

  const validateColumnDefinitions = (columns: CsvDashboard['columnDefinitions']): string | null => {
    if (columns.length === 0) {
      return '列定義が空です。';
    }
    for (const col of columns) {
      if (!col.displayName?.trim()) {
        return '表示名が空の列があります。';
      }
      if (!col.csvHeaderCandidates || col.csvHeaderCandidates.length === 0) {
        return `CSVヘッダー候補が空の列があります（${col.internalName}）。`;
      }
    }
    return null;
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('CSVダッシュボードが選択されていません');
      const validationError = validateColumnDefinitions(normalizedColumnDefinitions);
      if (validationError) {
        setColumnDefinitionError(validationError);
        throw new Error(validationError);
      }
      return updateCsvDashboard(selectedId, {
        displayPeriodDays,
        dateColumnName: dateColumnName.length > 0 ? dateColumnName : null,
        emptyMessage: emptyMessage.length > 0 ? emptyMessage : null,
        gmailSubjectPattern: gmailSubjectPattern.length > 0 ? gmailSubjectPattern : null,
        enabled,
        columnDefinitions: normalizedColumnDefinitions,
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
  const previewHeaders = previewResult?.headers ?? [];
  const unmatchedHeaders = previewHeaders.filter((header) =>
    normalizedColumnDefinitions.every((col) => !col.csvHeaderCandidates.includes(header))
  );

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

              <div>
                <label className="block text-sm font-semibold text-slate-700">Gmail件名パターン</label>
                <input
                  value={gmailSubjectPattern}
                  onChange={(e) => setGmailSubjectPattern(e.target.value)}
                  className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  placeholder="例: 生産日程_三島_研削工程"
                />
                <p className="mt-1 text-xs text-slate-500">
                  GmailからCSVを取得する際の件名パターン。スケジュール実行時に使用されます。
                </p>
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
              {columnDefinitionError && (
                <p className="text-sm text-rose-600">{columnDefinitionError}</p>
              )}

              <hr className="border-slate-200" />

              <div>
                <h4 className="text-sm font-bold text-slate-800">列定義（表示＋安全側編集）</h4>
                <p className="mt-1 text-xs text-slate-500">
                  internalNameとdataTypeは変更できません。表示名・CSVヘッダー候補・必須・表示順のみ編集できます。
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="border border-slate-200 px-2 py-1">順序</th>
                        <th className="border border-slate-200 px-2 py-1">internalName</th>
                        <th className="border border-slate-200 px-2 py-1">dataType</th>
                        <th className="border border-slate-200 px-2 py-1">表示名</th>
                        <th className="border border-slate-200 px-2 py-1">CSVヘッダー候補（カンマ区切り）</th>
                        <th className="border border-slate-200 px-2 py-1">必須</th>
                      </tr>
                    </thead>
                    <tbody>
                      {normalizedColumnDefinitions.map((col, index) => (
                        <tr key={col.internalName} className="odd:bg-white even:bg-slate-50">
                          <td className="border border-slate-200 px-2 py-1">
                            <div className="flex flex-col gap-1">
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  if (index === 0) return;
                                  setColumnDefinitions((prev) => {
                                    const next = [...prev];
                                    const temp = next[index - 1];
                                    next[index - 1] = next[index];
                                    next[index] = temp;
                                    return next;
                                  });
                                }}
                                disabled={index === 0}
                              >
                                ↑
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  if (index === normalizedColumnDefinitions.length - 1) return;
                                  setColumnDefinitions((prev) => {
                                    const next = [...prev];
                                    const temp = next[index + 1];
                                    next[index + 1] = next[index];
                                    next[index] = temp;
                                    return next;
                                  });
                                }}
                                disabled={index === normalizedColumnDefinitions.length - 1}
                              >
                                ↓
                              </Button>
                            </div>
                          </td>
                          <td className="border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-slate-500">
                            {col.internalName}
                            <span className="ml-1 text-xs text-slate-400">（読み取り専用）</span>
                          </td>
                          <td className="border border-slate-200 bg-slate-100 px-2 py-1 text-slate-500">
                            {col.dataType}
                            <span className="ml-1 text-xs text-slate-400">（読み取り専用）</span>
                          </td>
                          <td className="border border-slate-200 px-2 py-1">
                            <input
                              value={col.displayName}
                              onChange={(e) => {
                                const value = e.target.value;
                                setColumnDefinitions((prev) =>
                                  prev.map((item, idx) => {
                                    if (idx !== index) return item;
                                    // 表示名を変更したとき、CSVヘッダー候補に自動追加（重複を避ける）
                                    const updatedCandidates = [...item.csvHeaderCandidates];
                                    if (value && !updatedCandidates.includes(value)) {
                                      // 表示名を先頭に追加
                                      updatedCandidates.unshift(value);
                                    }
                                    return { ...item, displayName: value, csvHeaderCandidates: updatedCandidates };
                                  })
                                );
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="border border-slate-200 px-2 py-1">
                            <input
                              value={col.csvHeaderCandidates.join(', ')}
                              onChange={(e) => {
                                const candidates = Array.from(
                                  new Set(
                                    e.target.value
                                      .split(',')
                                      .map((val) => val.trim())
                                      .filter((val) => val.length > 0)
                                  )
                                );
                                setColumnDefinitions((prev) =>
                                  prev.map((item, idx) => (idx === index ? { ...item, csvHeaderCandidates: candidates } : item))
                                );
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="border border-slate-200 px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(col.required)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setColumnDefinitions((prev) =>
                                  prev.map((item, idx) => (idx === index ? { ...item, required: checked } : item))
                                );
                              }}
                              className="h-4 w-4"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <hr className="border-slate-200" />

              <div>
                <h4 className="text-sm font-bold text-slate-800">CSVプレビュー（ヘッダー照合）</h4>
                <p className="mt-1 text-xs text-slate-500">
                  CSVのヘッダー行を貼り付けるか、CSVファイルを選択して照合できます。
                </p>
                <div className="mt-3 space-y-2">
                  <textarea
                    value={previewCsvContent}
                    onChange={(e) => setPreviewCsvContent(e.target.value)}
                    className="h-24 w-full rounded border border-slate-300 p-2 text-xs"
                    placeholder="例: 管理番号,名称,持出従業員,持出日時,返却予定日時,状態"
                  />
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        setPreviewCsvContent(String(reader.result ?? ''));
                      };
                      reader.readAsText(file);
                    }}
                    className="text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        if (!selectedId) return;
                        if (!previewCsvContent.trim()) {
                          setPreviewError('CSV内容が空です。');
                          setPreviewResult(null);
                          return;
                        }
                        try {
                          setPreviewError(null);
                          const result = await previewCsvDashboardParse(selectedId, previewCsvContent);
                          setPreviewResult(result);
                        } catch (error) {
                          setPreviewResult(null);
                          setPreviewError(error instanceof Error ? error.message : 'プレビュー解析に失敗しました。');
                        }
                      }}
                    >
                      プレビュー解析
                    </Button>
                    {previewError && <span className="text-xs text-rose-600">{previewError}</span>}
                  </div>
                </div>
                {previewResult && (
                  <div className="mt-4 space-y-2 text-xs text-slate-700">
                    <div>
                      <p className="font-semibold">ヘッダー照合結果</p>
                      <ul className="mt-1 space-y-1">
                        {normalizedColumnDefinitions.map((col) => {
                          const matched = col.csvHeaderCandidates.find((candidate) => previewHeaders.includes(candidate));
                          return (
                            <li key={col.internalName}>
                              {col.displayName}（{col.internalName}）: {matched ? `一致: ${matched}` : col.required ? '未一致（必須）' : '未一致'}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    {unmatchedHeaders.length > 0 && (
                      <div>
                        <p className="font-semibold text-amber-700">未対応のヘッダー</p>
                        <p className="mt-1">{unmatchedHeaders.join(', ')}</p>
                      </div>
                    )}
                  </div>
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

