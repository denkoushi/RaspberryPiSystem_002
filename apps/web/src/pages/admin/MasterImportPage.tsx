import axios from 'axios';
import { FormEvent, useState } from 'react';

import { useImportMaster } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export function MasterImportPage() {
  const [employeesFile, setEmployeesFile] = useState<File | null>(null);
  const [itemsFile, setItemsFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const importMutation = useImportMaster();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await importMutation.mutateAsync({
        employeesFile: employeesFile ?? undefined,
        itemsFile: itemsFile ?? undefined,
        replaceExisting
      });
    } catch (error) {
      // エラーはReact Queryが自動的に処理するが、より詳細なメッセージを表示するためにここでログ出力
      console.error('Import error:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Card title="USB 一括登録">
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm font-semibold text-slate-700">
            USBメモリ上の `employees.csv` と `items.csv` をPCにコピーした後、以下から選択してアップロードしてください。
            <br />
            CSVはUTF-8、1行1レコード、ヘッダー必須です。
            <br />
            <strong>従業員CSV</strong>: employeeCode（必須・数字4桁、例: 0001）, lastName（必須・苗字）, firstName（必須・名前）, nfcTagUid（任意）, department（任意）, contact（任意）, status（任意）
            <br />
            <strong>注意</strong>: displayName（氏名）はlastName + firstNameで自動生成されます。CSVには含めません。
            <br />
            <strong>工具CSV</strong>: itemCode（必須・TO + 数字4桁、例: TO0001）, name（必須・工具名）, nfcTagUid（任意）, category（任意）, storageLocation（任意）, status（任意）, notes（任意）
          </p>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">従業員CSV（任意）</span>
            <input
              type="file"
              accept=".csv"
              className="mt-1 block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              onChange={(e) => setEmployeesFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">アイテムCSV（任意）</span>
            <input
              type="file"
              accept=".csv"
              className="mt-1 block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              onChange={(e) => setItemsFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
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
            <div className="rounded-lg border-2 border-red-700 bg-red-600 p-4 text-sm text-white shadow-lg">
              <p className="font-bold">エラー</p>
              <p className="mt-1 font-semibold">
                {axios.isAxiosError(importMutation.error) && importMutation.error.response?.data?.message
                  ? importMutation.error.response.data.message
                  : (importMutation.error as Error).message || '取り込みに失敗しました'}
              </p>
              {axios.isAxiosError(importMutation.error) && importMutation.error.response?.data && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-semibold">詳細情報</summary>
                  <pre className="mt-1 overflow-auto rounded bg-red-700 p-2 text-white">
                    {JSON.stringify(importMutation.error.response.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : null}
          {importMutation.data ? (
            <div className="rounded-lg border-2 border-emerald-700 bg-emerald-600 p-4 text-left text-sm text-white shadow-lg">
              <p className="font-bold">取り込み完了</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs font-semibold">
                {JSON.stringify(importMutation.data.summary, null, 2)}
              </pre>
            </div>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
