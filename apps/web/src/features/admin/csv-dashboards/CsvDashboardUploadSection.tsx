import { Button } from '../../../components/ui/Button';

import type { CsvDashboardEditor } from './useCsvDashboardEditor';

type CsvDashboardUploadSectionProps = {
  editor: CsvDashboardEditor;
};

export function CsvDashboardUploadSection({ editor }: CsvDashboardUploadSectionProps) {
  const { setUploadFile, uploadMutation } = editor;

  return (
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
  );
}
