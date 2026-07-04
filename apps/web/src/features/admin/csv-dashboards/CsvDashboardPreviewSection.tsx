import { Button } from '../../../components/ui/Button';

import type { CsvDashboardEditor } from './useCsvDashboardEditor';

type CsvDashboardPreviewSectionProps = {
  editor: CsvDashboardEditor;
};

export function CsvDashboardPreviewSection({ editor }: CsvDashboardPreviewSectionProps) {
  const {
    previewCsvContent,
    setPreviewCsvContent,
    handlePreviewFileChange,
    handlePreviewParse,
    previewError,
    previewResult,
    normalizedColumnDefinitions,
    previewHeaders,
    unmatchedHeaders,
  } = editor;

  return (
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
            handlePreviewFileChange(file);
          }}
          className="text-xs"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={handlePreviewParse}
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
  );
}
