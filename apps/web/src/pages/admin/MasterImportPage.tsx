import { FormEvent, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useImportMaster } from '../../api/hooks';

export function MasterImportPage() {
  const [employeesFile, setEmployeesFile] = useState<File | null>(null);
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
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
            {importMutation.isPending ? '取り込み中…' : '取り込み開始'}
          </Button>
          {importMutation.error ? (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200">
              <p className="font-semibold">エラー</p>
              <p className="mt-1">{(importMutation.error as Error).message}</p>
            </div>
          ) : null}
          {importMutation.data ? (
            <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4 text-left text-sm text-emerald-200">
              <p className="font-semibold">取り込み完了</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs">
                {JSON.stringify(importMutation.data.summary, null, 2)}
              </pre>
            </div>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
