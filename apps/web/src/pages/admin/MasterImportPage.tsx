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
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-base font-bold text-slate-800">使い方</h3>
            <p className="text-sm text-slate-700">
              USBメモリ上の <code className="bg-slate-100 px-1 py-0.5 rounded">employees.csv</code> と <code className="bg-slate-100 px-1 py-0.5 rounded">items.csv</code> をPCにコピーした後、以下から選択してアップロードしてください。
            </p>
            <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-md">
              <p className="font-semibold mb-1">CSV形式:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>文字コード: UTF-8</li>
                <li>形式: 1行1レコード</li>
                <li>ヘッダー行: 必須（1行目）</li>
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-bold text-slate-800">CSVフォーマット仕様</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-slate-700 mb-1">従業員CSV (employees.csv)</p>
                <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-md">
                  <p className="mb-1"><strong>必須項目:</strong> employeeCode（数字4桁、例: 0001）, lastName（苗字）, firstName（名前）</p>
                  <p className="mb-1"><strong>任意項目:</strong> nfcTagUid, department, contact, status</p>
                  <p className="text-amber-700"><strong>注意:</strong> displayName（氏名）は lastName + firstName で自動生成されます。CSVには含めません。</p>
                </div>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">工具CSV (items.csv)</p>
                <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-md">
                  <p className="mb-1"><strong>必須項目:</strong> itemCode（TO + 数字4桁、例: TO0001）, name（工具名）</p>
                  <p><strong>任意項目:</strong> nfcTagUid, category, storageLocation, status, notes</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                従業員CSV（任意）
              </label>
              <input
                type="file"
                accept=".csv"
                className="block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                onChange={(e) => setEmployeesFile(e.target.files?.[0] ?? null)}
              />
              {employeesFile && (
                <p className="mt-1 text-xs text-slate-600">選択中: {employeesFile.name}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                アイテムCSV（任意）
              </label>
              <input
                type="file"
                accept=".csv"
                className="block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                onChange={(e) => setItemsFile(e.target.files?.[0] ?? null)}
              />
              {itemsFile && (
                <p className="mt-1 text-xs text-slate-600">選択中: {itemsFile.name}</p>
              )}
            </div>
          </div>
          <div className="max-w-md space-y-4">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="mt-0.5"
              />
              <span>既存データをクリアしてから取り込み（選択したCSVの種類のみ）</span>
            </label>
            <Button type="submit" disabled={importMutation.isPending}>
              {importMutation.isPending ? '取り込み中…' : '取り込み開始'}
            </Button>
          </div>
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
