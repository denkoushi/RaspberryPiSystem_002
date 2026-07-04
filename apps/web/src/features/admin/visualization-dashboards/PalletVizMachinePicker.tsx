import { Button } from '../../../components/ui/Button';

import type { VisualizationDashboardEditor } from './useVisualizationDashboardEditor';

type PalletVizMachinePickerProps = {
  editor: VisualizationDashboardEditor;
};

export function PalletVizMachinePicker({ editor }: PalletVizMachinePickerProps) {
  const {
    handlePalletVizClearTargets,
    palletVizSelectedMachineSet,
    palletVizBoardQuery,
    handlePalletVizMachineToggle,
  } = editor;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-700">
        <strong>対象加工機</strong>を未選択のままにすると、資源マスタに登録された<strong>全加工機</strong>が対象になります。
        1台だけに絞ると、サイネージ側は<strong>大画面（1台専用レイアウト）</strong>で描画されます。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={handlePalletVizClearTargets}>
          対象をクリア（全機）
        </Button>
        {palletVizSelectedMachineSet.size > 0 && (
          <span className="text-xs text-slate-600">
            選択中: {palletVizSelectedMachineSet.size} 台（資源マスタ登録順）
          </span>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-2">
        {palletVizBoardQuery.isLoading && (
          <p className="text-xs text-slate-500">加工機一覧を読み込み中...</p>
        )}
        {palletVizBoardQuery.isError && (
          <p className="text-xs text-rose-600">加工機一覧の取得に失敗しました。</p>
        )}
        {(palletVizBoardQuery.data?.machines ?? []).map((m) => {
          const cd = m.machineCd.trim().toUpperCase();
          const checked = palletVizSelectedMachineSet.has(cd);
          return (
            <label
              key={m.machineCd}
              className="flex cursor-pointer items-center gap-2 py-1 text-xs font-semibold text-slate-800"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handlePalletVizMachineToggle(m.machineCd)}
                className="h-4 w-4"
              />
              <span>
                {m.machineName} <span className="font-mono text-slate-600">({m.machineCd})</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
