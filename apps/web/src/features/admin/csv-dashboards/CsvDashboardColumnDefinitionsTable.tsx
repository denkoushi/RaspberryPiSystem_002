import { Button } from '../../../components/ui/Button';

import type { CsvDashboardEditor } from './useCsvDashboardEditor';

type CsvDashboardColumnDefinitionsTableProps = {
  editor: CsvDashboardEditor;
};

export function CsvDashboardColumnDefinitionsTable({ editor }: CsvDashboardColumnDefinitionsTableProps) {
  const {
    normalizedColumnDefinitions,
    handleMoveColumnDefinitionUp,
    handleMoveColumnDefinitionDown,
    handleDisplayNameChange,
    handleCsvHeaderCandidatesChange,
    handleRequiredChange,
  } = editor;

  return (
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
                      onClick={() => handleMoveColumnDefinitionUp(index)}
                      disabled={index === 0}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleMoveColumnDefinitionDown(index)}
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
                    onChange={(e) => handleDisplayNameChange(index, e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </td>
                <td className="border border-slate-200 px-2 py-1">
                  <input
                    value={col.csvHeaderCandidates.join(', ')}
                    onChange={(e) => handleCsvHeaderCandidatesChange(index, e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </td>
                <td className="border border-slate-200 px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={Boolean(col.required)}
                    onChange={(e) => handleRequiredChange(index, e.target.checked)}
                    className="h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
