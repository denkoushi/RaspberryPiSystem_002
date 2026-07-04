import { Button } from '../../../components/ui/Button';

import { PalletVizMachinePicker } from './PalletVizMachinePicker';
import { UninspectedCsvDashboardPicker } from './UninspectedCsvDashboardPicker';

import type { VisualizationDashboardEditor } from './useVisualizationDashboardEditor';

type VisualizationDashboardEditorFormProps = {
  editor: VisualizationDashboardEditor;
};

export function VisualizationDashboardEditorForm({ editor }: VisualizationDashboardEditorFormProps) {
  const {
    isCreating,
    name,
    setName,
    description,
    setDescription,
    dataSourceType,
    setDataSourceType,
    rendererType,
    setRendererType,
    dataSourceConfig,
    setDataSourceConfig,
    rendererConfig,
    setRendererConfig,
    enabled,
    setEnabled,
    isUninspectedPreset,
    isMeasuringInspectionPreset,
    isRiggingInspectionPreset,
    isPalletVizPreset,
    applyUninspectedPreset,
    applyMeasuringInspectionPreset,
    applyRiggingInspectionPreset,
    applyPalletVisualizationPreset,
    handleSave,
    handleDelete,
    isDirty,
    create,
    update,
    remove,
    formError,
  } = editor;

  return (
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
          <Button variant="secondary" onClick={applyMeasuringInspectionPreset}>
            計測機器点検可視化プリセットを適用
          </Button>
          <Button variant="secondary" onClick={applyRiggingInspectionPreset}>
            吊具点検可視化プリセットを適用
          </Button>
          <Button variant="secondary" onClick={applyPalletVisualizationPreset}>
            パレット可視化プリセットを適用
          </Button>
          <p className="text-xs text-slate-600">サイネージ向け可視化の推奨設定を自動入力します。</p>
        </div>
        {isUninspectedPreset && <UninspectedCsvDashboardPicker editor={editor} />}
        {isMeasuringInspectionPreset && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-700">
              部署フィルタは <code>dataSourceConfig.sectionEquals</code> で設定します。
              既定値は「加工担当部署」です。
            </p>
          </div>
        )}
        {isRiggingInspectionPreset && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-700">
              部署フィルタは <code>dataSourceConfig.sectionEquals</code> で設定します。
              既定値は「加工担当部署」です。
            </p>
          </div>
        )}
        {isPalletVizPreset && <PalletVizMachinePicker editor={editor} />}
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
  );
}
