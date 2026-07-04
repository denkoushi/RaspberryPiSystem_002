import { Button } from '../../../components/ui/Button';

import type { CsvDashboardEditor } from './useCsvDashboardEditor';

type CsvDashboardTableTemplateSectionProps = {
  editor: CsvDashboardEditor;
};

export function CsvDashboardTableTemplateSection({ editor }: CsvDashboardTableTemplateSectionProps) {
  const {
    tableFontSize,
    setTableFontSize,
    tableRowsPerPage,
    setTableRowsPerPage,
    manualColumnWidths,
    handleManualColumnWidthsChange,
    normalizedColumnDefinitions,
    addDisplayColumn,
    setAddDisplayColumn,
    tableDisplayColumns,
    handleAddDisplayColumn,
    handleResetDisplayColumns,
    handleMoveDisplayColumnUp,
    handleMoveDisplayColumnDown,
    handleRemoveDisplayColumn,
    tableColumnWidths,
    setTableColumnWidths,
    handleColumnWidthChange,
    templateConfigError,
  } = editor;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-sm font-bold text-slate-800">サイネージ表示設定（TABLE）</h4>
      <p className="mt-1 text-xs text-slate-600">
        表示列・フォント・列幅（任意）をダッシュボードごとに設定できます。SPLIT表示でも読みやすくするためのベース設定です。
      </p>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700">フォントサイズ（px）</label>
          <input
            type="number"
            min={10}
            max={48}
            value={tableFontSize}
            onChange={(e) => setTableFontSize(Number(e.target.value))}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">目安: FULL=14〜20 / SPLITも考えるなら16〜24</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700">行数（1ページあたり）</label>
          <input
            type="number"
            min={1}
            max={200}
            value={tableRowsPerPage}
            onChange={(e) => setTableRowsPerPage(Number(e.target.value))}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">表示領域に応じて自動で減る場合があります</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="csv-dashboard-manual-widths"
            type="checkbox"
            checked={manualColumnWidths}
            onChange={(e) => handleManualColumnWidthsChange(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="csv-dashboard-manual-widths" className="text-xs font-semibold text-slate-700">
            列幅を手動指定（px）
          </label>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-semibold text-slate-700">表示列（順序含む）</label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={addDisplayColumn}
            onChange={(e) => setAddDisplayColumn(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
          >
            <option value="">追加する列を選択</option>
            {normalizedColumnDefinitions
              .filter((c) => !tableDisplayColumns.includes(c.internalName))
              .map((c) => (
                <option key={c.internalName} value={c.internalName}>
                  {c.displayName}（{c.internalName}）
                </option>
              ))}
          </select>
          <Button
            variant="secondary"
            onClick={handleAddDisplayColumn}
            disabled={!addDisplayColumn}
          >
            追加
          </Button>
          <Button
            variant="ghost"
            onClick={handleResetDisplayColumns}
          >
            全列に戻す
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {tableDisplayColumns.map((internalName, index) => {
            const col = normalizedColumnDefinitions.find((c) => c.internalName === internalName);
            const label = col ? `${col.displayName}（${col.internalName}）` : internalName;
            return (
              <div
                key={internalName}
                className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1"
              >
                <span className="text-xs font-semibold text-slate-800">{index + 1}.</span>
                <span className="text-xs text-slate-700">{label}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => handleMoveDisplayColumnUp(index)}
                    disabled={index === 0}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleMoveDisplayColumnDown(index)}
                    disabled={index === tableDisplayColumns.length - 1}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleRemoveDisplayColumn(internalName)}
                  >
                    削除
                  </Button>
                </div>
              </div>
            );
          })}

          {tableDisplayColumns.length === 0 && (
            <p className="text-xs text-rose-700">表示列が0件です。最低1列は選択してください。</p>
          )}
        </div>
      </div>

      {manualColumnWidths && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-xs font-bold text-slate-800">列幅（px）</h5>
            <Button
              variant="ghost"
              onClick={() => setTableColumnWidths({})}
            >
              一括クリア（自動に戻す）
            </Button>
          </div>
          <div className="mt-2 space-y-2">
            {tableDisplayColumns.map((internalName) => {
              const col = normalizedColumnDefinitions.find((c) => c.internalName === internalName);
              const label = col ? `${col.displayName}（${col.internalName}）` : internalName;
              const value = tableColumnWidths[internalName] ?? '';
              return (
                <label key={internalName} className="flex items-center gap-2 text-xs text-slate-700">
                  <span className="min-w-[200px]">{label}</span>
                  <input
                    type="number"
                    min={20}
                    max={5000}
                    value={value}
                    onChange={(e) => handleColumnWidthChange(internalName, e.target.value)}
                    className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    placeholder="自動"
                  />
                  <span className="text-[11px] text-slate-500">未入力は自動</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {templateConfigError && (
        <p className="mt-3 text-sm text-rose-600">{templateConfigError}</p>
      )}
    </div>
  );
}
