import { FormEvent, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useImportJobs, useImportMaster } from '../../api/hooks';

export function MasterImportPage() {
  const [employeesFile, setEmployeesFile] = useState<File | null>(null);
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const importJobs = useImportJobs();
  const importMutation = useImportMaster();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await importMutation.mutateAsync({
      employeesFile: employeesFile ?? undefined,
      itemsFile: itemsFile ?? undefined,
      replaceExisting
    });
  };

  return (
    <div className="space-y-6">
      <Card title="USB 一括登録">
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-white/70">
            USBメモリ上の `employees.csv` と `items.csv` をPCにコピーした後、以下から選択してアップロードしてください。
            CSVはUTF-8、1行1レコード、ヘッダー必須（列名: employeeCode,displayName,nfcTagUid,department,contact,status /
            itemCode,name,nfcTagUid,category,storageLocation,status,notes）。
          </p>
          <label className="block">
            <span className="text-sm text-white/70">従業員CSV（任意）</span>
            <input
              type="file"
              accept=".csv"
              className="mt-1 block w-full text-sm text-white/80"
              onChange={(e) => setEmployeesFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="block">
            <span className="text-sm text-white/70">アイテムCSV（任意）</span>
            <input
              type="file"
              accept=".csv"
              className="mt-1 block w-full text-sm text-white/80"
              onChange={(e) => setItemsFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
            />
            既存データをクリアしてから取り込み（選択したCSVの種類のみ）
          </label>
          <Button type="submit" disabled={importMutation.isPending}>
            {importMutation.isPending ? 'アップロード中…' : '取り込み開始'}
          </Button>
          {importMutation.error ? (
            <p className="text-sm text-red-400">{(importMutation.error as Error).message}</p>
          ) : null}
          {importMutation.data ? (
            <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4 text-left text-sm text-emerald-200">
              <p className="font-semibold">最新ジョブ ID: {importMutation.data.jobId}</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs">
                {JSON.stringify(importMutation.data.summary, null, 2)}
              </pre>
            </div>
          ) : null}
        </form>
      </Card>

      <Card title="取込履歴">
        {importJobs.isLoading ? (
          <p>読み込み中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="px-2 py-1">作成日時</th>
                  <th className="px-2 py-1">種別</th>
                  <th className="px-2 py-1">ステータス</th>
                  <th className="px-2 py-1">サマリ</th>
                </tr>
              </thead>
              <tbody>
                {importJobs.data?.map((job) => (
                  <tr key={job.id} className="border-t border-white/5">
                    <td className="px-2 py-1">{new Date(job.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1">{job.type}</td>
                    <td className="px-2 py-1">{job.status}</td>
                    <td className="px-2 py-1 text-xs font-mono">
                      {job.summary ? JSON.stringify(job.summary) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
