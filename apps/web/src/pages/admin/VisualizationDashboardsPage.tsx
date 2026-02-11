import { useEffect, useMemo, useState } from 'react';

import { useVisualizationDashboard, useVisualizationDashboardMutations, useVisualizationDashboards, useCsvDashboards } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { VisualizationDashboard } from '../../api/client';

const DEFAULT_JSON = '{}';
const UNINSPECTED_DATA_SOURCE_TYPE = 'uninspected_machines';
const UNINSPECTED_RENDERER_TYPE = 'uninspected_machines';
const UNINSPECTED_DATA_SOURCE_TEMPLATE = JSON.stringify(
  {
    csvDashboardId: '',
    date: '',
    maxRows: 30,
  },
  null,
  2,
);
const UNINSPECTED_RENDERER_TEMPLATE = JSON.stringify(
  {
    maxRows: 18,
  },
  null,
  2,
);

type JsonParseResult = { value: Record<string, unknown> | null; error?: string };

function parseJson(input: string, label: string): JsonParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: {} };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown> };
    }
    return { value: null, error: `${label}はオブジェクト形式で指定してください。` };
  } catch (error) {
    return { value: null, error: `${label}のJSON形式が不正です。` };
  }
}

export function VisualizationDashboardsPage() {
  const dashboardsQuery = useVisualizationDashboards();
  const csvDashboardsQuery = useCsvDashboards(); // すべてのCSVダッシュボードを取得（有効/無効問わず）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedDashboardQuery = useVisualizationDashboard(selectedId);
  const { create, update, remove } = useVisualizationDashboardMutations();

  const dashboards = dashboardsQuery.data ?? [];
  const csvDashboards = csvDashboardsQuery.data ?? [];
  const selected = selectedDashboardQuery.data ?? null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataSourceType, setDataSourceType] = useState('');
  const [rendererType, setRendererType] = useState('');
  const [dataSourceConfig, setDataSourceConfig] = useState(DEFAULT_JSON);
  const [rendererConfig, setRendererConfig] = useState(DEFAULT_JSON);
  const [enabled, setEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = Boolean(selectedId) && !isCreating;
  const isUninspectedPreset = dataSourceType.trim() === UNINSPECTED_DATA_SOURCE_TYPE;

  // 未点検加工機プリセット用のCSVダッシュボードID取得
  const currentCsvDashboardId = useMemo(() => {
    if (!isUninspectedPreset) return '';
    try {
      const parsed = JSON.parse(dataSourceConfig);
      return typeof parsed?.csvDashboardId === 'string' ? parsed.csvDashboardId : '';
    } catch {
      return '';
    }
  }, [dataSourceConfig, isUninspectedPreset]);

  // CSVダッシュボードID変更ハンドラー
  const handleCsvDashboardIdChange = (csvDashboardId: string) => {
    try {
      const parsed = JSON.parse(dataSourceConfig);
      const updated = {
        ...parsed,
        csvDashboardId: csvDashboardId || '',
      };
      setDataSourceConfig(JSON.stringify(updated, null, 2));
    } catch {
      // JSONパースエラーの場合は新規作成
      setDataSourceConfig(
        JSON.stringify(
          {
            csvDashboardId: csvDashboardId || '',
            date: '',
            maxRows: 30,
          },
          null,
          2,
        ),
      );
    }
  };

  useEffect(() => {
    if (!isEditing || !selected) return;
    setName(selected.name ?? '');
    setDescription(selected.description ?? '');
    setDataSourceType(selected.dataSourceType ?? '');
    setRendererType(selected.rendererType ?? '');
    setDataSourceConfig(JSON.stringify(selected.dataSourceConfig ?? {}, null, 2));
    setRendererConfig(JSON.stringify(selected.rendererConfig ?? {}, null, 2));
    setEnabled(Boolean(selected.enabled));
    setFormError(null);
  }, [isEditing, selected]);

  useEffect(() => {
    if (!isCreating) return;
    setSelectedId(null);
    setName('');
    setDescription('');
    setDataSourceType('');
    setRendererType('');
    setDataSourceConfig(DEFAULT_JSON);
    setRendererConfig(DEFAULT_JSON);
    setEnabled(true);
    setFormError(null);
  }, [isCreating]);

  const isDirty = useMemo(() => {
    if (isCreating) {
      return Boolean(name || description || dataSourceType || rendererType || dataSourceConfig.trim() !== DEFAULT_JSON);
    }
    if (!selected) return false;
    return (
      name !== (selected.name ?? '') ||
      description !== (selected.description ?? '') ||
      dataSourceType !== (selected.dataSourceType ?? '') ||
      rendererType !== (selected.rendererType ?? '') ||
      dataSourceConfig.trim() !== JSON.stringify(selected.dataSourceConfig ?? {}, null, 2) ||
      rendererConfig.trim() !== JSON.stringify(selected.rendererConfig ?? {}, null, 2) ||
      enabled !== Boolean(selected.enabled)
    );
  }, [dataSourceConfig, description, enabled, isCreating, name, rendererConfig, rendererType, selected, dataSourceType]);

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('名前は必須です。');
      return;
    }
    if (!dataSourceType.trim()) {
      setFormError('データソースタイプは必須です。');
      return;
    }
    if (!rendererType.trim()) {
      setFormError('レンダラータイプは必須です。');
      return;
    }

    const dataSourceParsed = parseJson(dataSourceConfig, 'データソース設定');
    if (dataSourceParsed.error) {
      setFormError(dataSourceParsed.error);
      return;
    }
    const rendererParsed = parseJson(rendererConfig, 'レンダラー設定');
    if (rendererParsed.error) {
      setFormError(rendererParsed.error);
      return;
    }

    if (dataSourceType.trim() === UNINSPECTED_DATA_SOURCE_TYPE) {
      const cfg = dataSourceParsed.value ?? {};
      const csvDashboardId =
        typeof cfg.csvDashboardId === 'string' ? cfg.csvDashboardId.trim() : '';
      if (!csvDashboardId) {
        setFormError(
          '未点検加工機データソースでは csvDashboardId が必須です。CSVダッシュボードIDを設定してください。',
        );
        return;
      }
    }

    if (isCreating) {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        dataSourceType: dataSourceType.trim(),
        rendererType: rendererType.trim(),
        dataSourceConfig: dataSourceParsed.value ?? {},
        rendererConfig: rendererParsed.value ?? {},
        enabled
      });
      setIsCreating(false);
      return;
    }

    if (!selectedId) {
      setFormError('編集対象が選択されていません。');
      return;
    }

    await update.mutateAsync({
      id: selectedId,
      payload: {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        dataSourceType: dataSourceType.trim(),
        rendererType: rendererType.trim(),
        dataSourceConfig: dataSourceParsed.value ?? {},
        rendererConfig: rendererParsed.value ?? {},
        enabled
      }
    });
  };

  const handleDelete = async () => {
    if (!selectedId || !selected) return;
    if (!confirm(`可視化ダッシュボード「${selected.name}」を削除しますか？`)) return;
    await remove.mutateAsync(selectedId);
    setSelectedId(null);
  };

  const applyUninspectedPreset = () => {
    setDataSourceType(UNINSPECTED_DATA_SOURCE_TYPE);
    setRendererType(UNINSPECTED_RENDERER_TYPE);
    setDataSourceConfig(UNINSPECTED_DATA_SOURCE_TEMPLATE);
    setRendererConfig(UNINSPECTED_RENDERER_TEMPLATE);
    if (!name.trim()) {
      setName('未点検加工機');
    }
    if (!description.trim()) {
      setDescription('加工機マスターと点検CSVの当日差分を表示');
    }
    setFormError(null);
  };

  return (
    <div className="space-y-6">
      <Card
        title="可視化ダッシュボード"
        action={
          <Button variant="secondary" onClick={() => setIsCreating(true)}>
            新規作成
          </Button>
        }
      >
        <p className="text-sm text-slate-600">
          サイネージ向けの可視化ダッシュボード定義を管理します。データソースとレンダラーを組み合わせて表示内容を決めます。
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="一覧">
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              setIsCreating(false);
              setSelectedId(e.target.value || null);
            }}
            className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          >
            <option value="">選択してください</option>
            {dashboards.map((dashboard: VisualizationDashboard) => (
              <option key={dashboard.id} value={dashboard.id}>
                {dashboard.name}
              </option>
            ))}
          </select>
          {dashboardsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">読み込み中...</p>}
          {dashboardsQuery.isError && <p className="mt-2 text-xs text-rose-600">一覧の取得に失敗しました。</p>}
        </Card>

        <Card title="設定" className="lg:col-span-2">
          {isCreating ? (
            <p className="text-sm text-slate-600">新規作成モードです。必要事項を入力してください。</p>
          ) : !selectedId ? (
            <p className="text-sm text-slate-600">左の一覧から選択してください。</p>
          ) : selectedDashboardQuery.isLoading ? (
            <p className="text-sm text-slate-600">読み込み中...</p>
          ) : selectedDashboardQuery.isError || !selected ? (
            <p className="text-sm text-rose-600">詳細の取得に失敗しました。</p>
          ) : (
            <p className="text-sm text-slate-600">選択中: {selected.name}</p>
          )}

          {(isCreating || selected) && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">名前</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">説明</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">データソースタイプ</label>
                  <input
                    value={dataSourceType}
                    onChange={(e) => setDataSourceType(e.target.value)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    placeholder="例: measuring_instruments"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">レンダラータイプ</label>
                  <input
                    value={rendererType}
                    onChange={(e) => setRendererType(e.target.value)}
                    className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    placeholder="例: kpi_cards / bar_chart"
                  />
                </div>
              </div>

              <div className="rounded-md border border-slate-300 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" onClick={applyUninspectedPreset}>
                    未点検加工機プリセットを適用
                  </Button>
                  <p className="text-xs text-slate-600">
                    サイネージ向け未点検表示の推奨設定を自動入力します。
                  </p>
                </div>
                {isUninspectedPreset && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-sm font-semibold text-slate-700">
                      CSVダッシュボード（点検結果）<span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={currentCsvDashboardId}
                      onChange={(e) => handleCsvDashboardIdChange(e.target.value)}
                      className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      <option value="">選択してください</option>
                      {csvDashboards.map((dashboard) => (
                        <option key={dashboard.id} value={dashboard.id}>
                          {dashboard.name}
                          {!dashboard.enabled && ' (無効)'}
                        </option>
                      ))}
                    </select>
                    {csvDashboardsQuery.isLoading && (
                      <p className="text-xs text-slate-500">CSVダッシュボード一覧を読み込み中...</p>
                    )}
                    {csvDashboardsQuery.isError && (
                      <p className="text-xs text-rose-600">CSVダッシュボード一覧の取得に失敗しました。</p>
                    )}
                    {!currentCsvDashboardId && (
                      <p className="text-xs text-rose-600">
                        CSVダッシュボードを選択してください（必須）
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">データソース設定（JSON）</label>
                  <textarea
                    value={dataSourceConfig}
                    onChange={(e) => setDataSourceConfig(e.target.value)}
                    className="mt-1 h-40 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-xs font-mono text-slate-900"
                    placeholder='例: {"metric":"usage_top","periodDays":7,"topN":5}'
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">レンダラー設定（JSON）</label>
                  <textarea
                    value={rendererConfig}
                    onChange={(e) => setRendererConfig(e.target.value)}
                    className="mt-1 h-40 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-xs font-mono text-slate-900"
                    placeholder='例: {"theme":"dark","title":"使用回数Top"}'
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="visualization-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="visualization-enabled" className="text-sm font-semibold text-slate-700">
                  有効
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={handleSave} disabled={create.isPending || update.isPending}>
                  {isCreating ? '作成' : '保存'}
                </Button>
                {!isCreating && (
                  <Button variant="ghost" onClick={handleDelete} disabled={remove.isPending}>
                    削除
                  </Button>
                )}
                {isDirty && <span className="text-xs text-slate-500">未保存の変更があります。</span>}
                {(create.isError || update.isError) && (
                  <span className="text-sm text-rose-600">保存に失敗しました。</span>
                )}
                {(create.isSuccess || update.isSuccess) && (
                  <span className="text-sm text-emerald-700">保存しました。</span>
                )}
                {remove.isError && <span className="text-sm text-rose-600">削除に失敗しました。</span>}
                {remove.isSuccess && <span className="text-sm text-emerald-700">削除しました。</span>}
              </div>

              {formError && <p className="text-sm text-rose-600">{formError}</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
