import axios from 'axios';
import { FormEvent, useState } from 'react';

import { useImportMasterSingle } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

type ImportType = 'employees' | 'items' | 'measuringInstruments' | 'riggingGears' | 'machines';

interface ImportFormProps {
  type: ImportType;
  title: string;
  description: string;
  formatSpec: {
    required: string;
    optional: string;
    note?: string;
  };
}

function ImportForm({ type, title, description, formatSpec }: ImportFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const importMutation = useImportMasterSingle();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      return;
    }
    try {
      await importMutation.mutateAsync({
        type,
        file,
        replaceExisting
      });
      // 成功時にファイル選択をリセット
      setFile(null);
    } catch (error) {
      console.error('Import error:', error);
    }
  };

  return (
    <Card title={title}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-sm text-slate-700">
          <p>{description}</p>
        </div>
        <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-md">
          <p className="font-semibold mb-1">必須項目:</p>
          <p className="mb-1">{formatSpec.required}</p>
          <p className="font-semibold mb-1">任意項目:</p>
          <p className="mb-1">{formatSpec.optional}</p>
          {formatSpec.note && (
            <p className="text-amber-700 mt-1"><strong>注意:</strong> {formatSpec.note}</p>
          )}
        </div>
        <div className="max-w-md">
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            CSVファイル
          </label>
          <input
            type="file"
            accept=".csv"
            className="block w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="mt-1 text-xs text-slate-600">選択中: {file.name}</p>
          )}
        </div>
        <div className="max-w-md space-y-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="mt-0.5"
            />
            <span>既存データをクリアしてから取り込み（{title}のみ）</span>
          </label>
          <Button type="submit" disabled={importMutation.isPending || !file}>
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
  );
}

export function MasterImportPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-bold text-slate-800">USB 一括登録</h2>
        <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-md">
          <p className="font-semibold mb-1">CSV形式:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>文字コード: UTF-8</li>
            <li>形式: 1行1レコード</li>
            <li>ヘッダー行: 必須（1行目）</li>
          </ul>
        </div>
      </div>

      <ImportForm
        type="employees"
        title="従業員CSV (employees.csv)"
        description="USBメモリ上の employees.csv をPCにコピーした後、以下から選択してアップロードしてください。"
        formatSpec={{
          required: 'employeeCode（数字4桁、例: 0001）, lastName（苗字）, firstName（名前）',
          optional: 'nfcTagUid, department, contact, status',
          note: 'displayName（氏名）は lastName + firstName で自動生成されます。CSVには含めません。'
        }}
      />

      <ImportForm
        type="items"
        title="工具CSV (items.csv)"
        description="USBメモリ上の items.csv をPCにコピーした後、以下から選択してアップロードしてください。"
        formatSpec={{
          required: 'itemCode（TO + 数字4桁、例: TO0001）, name（工具名）',
          optional: 'nfcTagUid, category, storageLocation, status, notes'
        }}
      />

      <ImportForm
        type="measuringInstruments"
        title="計測機器CSV (measuring-instruments.csv)"
        description="USBメモリ上の measuring-instruments.csv をPCにコピーした後、以下から選択してアップロードしてください。"
        formatSpec={{
          required: 'managementNumber（管理番号、例: MI-001）, name（名称）',
          optional: 'storageLocation, department, measurementRange, calibrationExpiryDate, status, rfidTagUid'
        }}
      />

      <ImportForm
        type="riggingGears"
        title="吊具CSV (rigging-gears.csv)"
        description="USBメモリ上の rigging-gears.csv をPCにコピーした後、以下から選択してアップロードしてください。"
        formatSpec={{
          required: 'managementNumber（管理番号、例: RG-001）, name（名称）',
          optional: 'storageLocation, department, startedAt, usableYears, maxLoadTon, lengthMm, widthMm, thicknessMm, status, notes, rfidTagUid'
        }}
      />

      <ImportForm
        type="machines"
        title="加工機CSV (machines.csv)"
        description="USBメモリ上の machines.csv をPCにコピーした後、以下から選択してアップロードしてください。"
        formatSpec={{
          required: 'equipmentManagementNumber（設備管理番号）, name（加工機名称）',
          optional: 'shortName, classification, operatingStatus, ncManual, maker, processClassification, coolant',
          note: '実CSVが日本語ヘッダーでも、列定義のヘッダー候補に登録すれば取り込み可能です。'
        }}
      />
    </div>
  );
}
