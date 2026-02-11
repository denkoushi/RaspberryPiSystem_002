import { useEffect, useMemo, useState } from 'react';

import { useCsvImportConfig, useCsvImportConfigMutations } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import { CsvImportSchedulePage } from './CsvImportSchedulePage';
import { MasterImportPage } from './MasterImportPage';

import type { CsvImportColumnDefinition, CsvImportConfigType, CsvImportStrategy } from '../../api/backup';

type Purpose = 'master' | 'csvDashboards';
type Acquisition = 'manual' | 'scheduled';

const DEFAULT_COLUMN_DEFINITIONS: Record<CsvImportConfigType, CsvImportColumnDefinition[]> = {
  employees: [
    { internalName: 'employeeCode', displayName: '社員コード', csvHeaderCandidates: ['employeeCode', '社員コード'], dataType: 'string', order: 0 },
    { internalName: 'lastName', displayName: '苗字', csvHeaderCandidates: ['lastName', '苗字'], dataType: 'string', order: 1 },
    { internalName: 'firstName', displayName: '名前', csvHeaderCandidates: ['firstName', '名前'], dataType: 'string', order: 2 },
    { internalName: 'nfcTagUid', displayName: 'NFCタグUID', csvHeaderCandidates: ['nfcTagUid', 'NFCタグUID'], dataType: 'string', order: 3, required: false },
    { internalName: 'department', displayName: '部署', csvHeaderCandidates: ['department', '部署'], dataType: 'string', order: 4, required: false },
    { internalName: 'status', displayName: '状態', csvHeaderCandidates: ['status', '状態'], dataType: 'string', order: 5, required: false }
  ],
  items: [
    { internalName: 'itemCode', displayName: '管理番号', csvHeaderCandidates: ['itemCode', '管理番号'], dataType: 'string', order: 0 },
    { internalName: 'name', displayName: '工具名', csvHeaderCandidates: ['name', '工具名'], dataType: 'string', order: 1 },
    { internalName: 'nfcTagUid', displayName: 'NFCタグUID', csvHeaderCandidates: ['nfcTagUid', 'NFCタグUID'], dataType: 'string', order: 2, required: false },
    { internalName: 'category', displayName: 'カテゴリ', csvHeaderCandidates: ['category', 'カテゴリ'], dataType: 'string', order: 3, required: false },
    { internalName: 'storageLocation', displayName: '保管場所', csvHeaderCandidates: ['storageLocation', '保管場所'], dataType: 'string', order: 4, required: false },
    { internalName: 'status', displayName: '状態', csvHeaderCandidates: ['status', '状態'], dataType: 'string', order: 5, required: false },
    { internalName: 'notes', displayName: '備考', csvHeaderCandidates: ['notes', '備考'], dataType: 'string', order: 6, required: false }
  ],
  measuringInstruments: [
    { internalName: 'managementNumber', displayName: '管理番号', csvHeaderCandidates: ['managementNumber', '管理番号'], dataType: 'string', order: 0 },
    { internalName: 'name', displayName: '名称', csvHeaderCandidates: ['name', '名称'], dataType: 'string', order: 1 },
    { internalName: 'storageLocation', displayName: '保管場所', csvHeaderCandidates: ['storageLocation', '保管場所'], dataType: 'string', order: 2, required: false },
    { internalName: 'department', displayName: '部署', csvHeaderCandidates: ['department', '部署'], dataType: 'string', order: 3, required: false },
    { internalName: 'measurementRange', displayName: '測定範囲', csvHeaderCandidates: ['measurementRange', '測定範囲'], dataType: 'string', order: 4, required: false },
    { internalName: 'calibrationExpiryDate', displayName: '校正期限', csvHeaderCandidates: ['calibrationExpiryDate', '校正期限'], dataType: 'date', order: 5, required: false },
    { internalName: 'status', displayName: '状態', csvHeaderCandidates: ['status', '状態'], dataType: 'string', order: 6, required: false },
    { internalName: 'rfidTagUid', displayName: 'RFIDタグUID', csvHeaderCandidates: ['rfidTagUid', 'RFIDタグUID'], dataType: 'string', order: 7, required: false }
  ],
  riggingGears: [
    { internalName: 'managementNumber', displayName: '管理番号', csvHeaderCandidates: ['managementNumber', '管理番号'], dataType: 'string', order: 0 },
    { internalName: 'name', displayName: '名称', csvHeaderCandidates: ['name', '名称'], dataType: 'string', order: 1 },
    { internalName: 'storageLocation', displayName: '保管場所', csvHeaderCandidates: ['storageLocation', '保管場所'], dataType: 'string', order: 2, required: false },
    { internalName: 'department', displayName: '部署', csvHeaderCandidates: ['department', '部署'], dataType: 'string', order: 3, required: false },
    { internalName: 'startedAt', displayName: '使用開始日', csvHeaderCandidates: ['startedAt', '使用開始日'], dataType: 'date', order: 4, required: false },
    { internalName: 'usableYears', displayName: '使用年数', csvHeaderCandidates: ['usableYears', '使用年数'], dataType: 'number', order: 5, required: false },
    { internalName: 'maxLoadTon', displayName: '最大荷重(t)', csvHeaderCandidates: ['maxLoadTon', '最大荷重'], dataType: 'number', order: 6, required: false },
    { internalName: 'lengthMm', displayName: '長さ(mm)', csvHeaderCandidates: ['lengthMm', '長さ'], dataType: 'number', order: 7, required: false },
    { internalName: 'widthMm', displayName: '幅(mm)', csvHeaderCandidates: ['widthMm', '幅'], dataType: 'number', order: 8, required: false },
    { internalName: 'thicknessMm', displayName: '厚み(mm)', csvHeaderCandidates: ['thicknessMm', '厚み'], dataType: 'number', order: 9, required: false },
    { internalName: 'status', displayName: '状態', csvHeaderCandidates: ['status', '状態'], dataType: 'string', order: 10, required: false },
    { internalName: 'notes', displayName: '備考', csvHeaderCandidates: ['notes', '備考'], dataType: 'string', order: 11, required: false },
    { internalName: 'rfidTagUid', displayName: 'RFIDタグUID', csvHeaderCandidates: ['rfidTagUid', 'RFIDタグUID'], dataType: 'string', order: 12, required: false }
  ],
  machines: [
    { internalName: 'equipmentManagementNumber', displayName: '設備管理番号', csvHeaderCandidates: ['equipmentManagementNumber', '設備管理番号'], dataType: 'string', order: 0 },
    { internalName: 'name', displayName: '加工機名称', csvHeaderCandidates: ['name', '加工機_名称'], dataType: 'string', order: 1 },
    { internalName: 'shortName', displayName: '加工機略称', csvHeaderCandidates: ['shortName', '加工機_略称'], dataType: 'string', order: 2, required: false },
    { internalName: 'classification', displayName: '加工機分類', csvHeaderCandidates: ['classification', '加工機分類'], dataType: 'string', order: 3, required: false },
    { internalName: 'operatingStatus', displayName: '稼働状態', csvHeaderCandidates: ['operatingStatus', '稼働状態'], dataType: 'string', order: 4, required: false },
    { internalName: 'ncManual', displayName: 'NC/Manual', csvHeaderCandidates: ['ncManual', 'NC_Manual'], dataType: 'string', order: 5, required: false },
    { internalName: 'maker', displayName: 'メーカー', csvHeaderCandidates: ['maker'], dataType: 'string', order: 6, required: false },
    { internalName: 'processClassification', displayName: '工程分類', csvHeaderCandidates: ['processClassification', '工程分類'], dataType: 'string', order: 7, required: false },
    { internalName: 'coolant', displayName: 'クーラント', csvHeaderCandidates: ['coolant', 'クーラント'], dataType: 'string', order: 8, required: false },
  ]
};

function normalizeColumns(columns: CsvImportColumnDefinition[]) {
  return columns.map((col, index) => ({ ...col, order: index }));
}

function validateColumns(columns: CsvImportColumnDefinition[]): string | null {
  if (columns.length === 0) {
    return '列定義が空です。';
  }
  const internalNames = new Set<string>();
  for (const col of columns) {
    if (!col.internalName.trim() || !col.displayName.trim()) {
      return '内部名または表示名が空の列があります。';
    }
    if (!col.csvHeaderCandidates || col.csvHeaderCandidates.length === 0) {
      return `CSVヘッダー候補が空の列があります（${col.internalName}）。`;
    }
    if (internalNames.has(col.internalName)) {
      return `内部名が重複しています（${col.internalName}）。`;
    }
    internalNames.add(col.internalName);
  }
  return null;
}

export function CsvImportPage() {
  const [purpose, setPurpose] = useState<Purpose>('master');
  const [acquisition, setAcquisition] = useState<Acquisition>('manual');
  const [importType, setImportType] = useState<CsvImportConfigType>('employees');
  const configQuery = useCsvImportConfig(importType);
  const { upsert } = useCsvImportConfigMutations();

  const [enabled, setEnabled] = useState(true);
  const [allowedManualImport, setAllowedManualImport] = useState(true);
  const [allowedScheduledImport, setAllowedScheduledImport] = useState(true);
  const [importStrategy, setImportStrategy] = useState<CsvImportStrategy>('UPSERT');
  const [columnDefinitions, setColumnDefinitions] = useState<CsvImportColumnDefinition[]>([]);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    const config = configQuery.data;
    if (config) {
      setEnabled(config.enabled);
      setAllowedManualImport(config.allowedManualImport);
      setAllowedScheduledImport(config.allowedScheduledImport);
      setImportStrategy(config.importStrategy);
      setColumnDefinitions(normalizeColumns(config.columnDefinitions ?? []));
      setColumnError(null);
      setSaveMessage(null);
      return;
    }
    setEnabled(true);
    setAllowedManualImport(true);
    setAllowedScheduledImport(true);
    setImportStrategy('UPSERT');
    setColumnDefinitions(normalizeColumns(DEFAULT_COLUMN_DEFINITIONS[importType]));
    setColumnError(null);
    setSaveMessage(null);
  }, [configQuery.data, importType]);

  const normalizedColumns = useMemo(() => normalizeColumns(columnDefinitions), [columnDefinitions]);

  const handleSave = async () => {
    setSaveMessage(null);
    const error = validateColumns(normalizedColumns);
    if (error) {
      setColumnError(error);
      return;
    }
    setColumnError(null);
    await upsert.mutateAsync({
      importType,
      payload: {
        enabled,
        allowedManualImport,
        allowedScheduledImport,
        importStrategy,
        columnDefinitions: normalizedColumns
      }
    });
    setSaveMessage('設定を保存しました');
  };

  const manualAllowed = purpose === 'master' ? allowedManualImport : false;
  const scheduledAllowed = purpose === 'master' ? allowedScheduledImport : true;

  return (
    <div className="space-y-6">
      <Card title="CSV取り込み">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">用途</label>
              <select
                className="rounded-md border-2 border-slate-500 bg-white p-2 text-xs font-semibold text-slate-900"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as Purpose)}
              >
                <option value="master">マスターデータ</option>
                <option value="csvDashboards">CSVダッシュボード</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">取得手段</label>
              <div className="flex gap-2">
                <Button
                  variant={acquisition === 'manual' ? 'primary' : 'ghost'}
                  onClick={() => setAcquisition('manual')}
                >
                  手動
                </Button>
                <Button
                  variant={acquisition === 'scheduled' ? 'primary' : 'ghost'}
                  onClick={() => setAcquisition('scheduled')}
                >
                  自動
                </Button>
              </div>
            </div>
            {purpose === 'master' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">対象マスタ</label>
                <select
                  className="rounded-md border-2 border-slate-500 bg-white p-2 text-xs font-semibold text-slate-900"
                  value={importType}
                  onChange={(e) => setImportType(e.target.value as CsvImportConfigType)}
                >
                  <option value="employees">従業員</option>
                  <option value="items">アイテム</option>
                  <option value="measuringInstruments">計測機器</option>
                  <option value="riggingGears">吊具</option>
                  <option value="machines">加工機</option>
                </select>
              </div>
            )}
          </div>
          {purpose === 'csvDashboards' && acquisition === 'manual' && (
            <p className="text-xs text-amber-700 font-semibold">
              CSVダッシュボードは手動取り込みを想定していません。自動取り込みを選択してください。
            </p>
          )}
        </div>
      </Card>

      {purpose === 'master' && (
        <Card title="取り込み設定（列定義・許可・戦略）">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                有効
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={allowedManualImport}
                  onChange={(e) => setAllowedManualImport(e.target.checked)}
                />
                手動取り込みを許可
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={allowedScheduledImport}
                  onChange={(e) => setAllowedScheduledImport(e.target.checked)}
                />
                自動取り込みを許可
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                取り込み戦略
                <select
                  className="rounded-md border-2 border-slate-500 bg-white p-1 text-xs font-semibold text-slate-900"
                  value={importStrategy}
                  onChange={(e) => setImportStrategy(e.target.value as CsvImportStrategy)}
                >
                  <option value="UPSERT">差分（上書き更新）</option>
                  <option value="REPLACE">全置換（削除含む）</option>
                </select>
              </label>
            </div>

            {columnError && (
              <div className="rounded-md border-2 border-red-700 bg-red-600 p-2 text-xs text-white">
                {columnError}
              </div>
            )}
            {saveMessage && (
              <div className="rounded-md border-2 border-emerald-700 bg-emerald-600 p-2 text-xs text-white">
                {saveMessage}
              </div>
            )}

            <div className="space-y-3">
              {normalizedColumns.length > 0 && (
                <div className="mb-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                  <p className="font-semibold mb-1">列定義の入力欄について:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li><strong>内部名</strong>: システム内部で使用する列名（例: employeeCode）</li>
                    <li><strong>表示名</strong>: UIで表示する列名（例: 社員コード）</li>
                    <li><strong>CSVヘッダー候補</strong>: CSVファイルのヘッダー行で使用される可能性のある列名（カンマ区切りで複数指定可能、例: employeeCode, 社員コード）</li>
                  </ul>
                </div>
              )}
              {normalizedColumns.map((col, index) => (
                <div key={`${col.internalName}-${index}`} className="rounded-md border border-slate-200 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    {/* 左列 */}
                    <div className="space-y-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-600">内部名</label>
                        <Input
                          placeholder="例: employeeCode"
                          value={col.internalName}
                          onChange={(e) => {
                            const next = [...normalizedColumns];
                            next[index] = { ...col, internalName: e.target.value };
                            setColumnDefinitions(next);
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-600">表示名</label>
                        <Input
                          placeholder="例: 社員コード"
                          value={col.displayName}
                          onChange={(e) => {
                            const next = [...normalizedColumns];
                            next[index] = { ...col, displayName: e.target.value };
                            setColumnDefinitions(next);
                          }}
                        />
                      </div>
                    </div>
                    {/* 右列 */}
                    <div className="space-y-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-slate-600">CSVヘッダー候補</label>
                        <Input
                          placeholder="例: employeeCode, 社員コード"
                          value={col.csvHeaderCandidates.join(', ')}
                          onChange={(e) => {
                            const candidates = e.target.value
                              .split(',')
                              .map((v) => v.trim())
                              .filter(Boolean);
                            const next = [...normalizedColumns];
                            next[index] = { ...col, csvHeaderCandidates: candidates };
                            setColumnDefinitions(next);
                          }}
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-xs font-semibold text-slate-600">データ型</label>
                          <select
                            className="rounded-md border-2 border-slate-500 bg-white p-1 text-xs font-semibold text-slate-900 w-full"
                            value={col.dataType}
                            onChange={(e) => {
                              const next = [...normalizedColumns];
                              next[index] = { ...col, dataType: e.target.value as CsvImportColumnDefinition['dataType'] };
                              setColumnDefinitions(next);
                            }}
                          >
                            <option value="string">文字列</option>
                            <option value="number">数値</option>
                            <option value="date">日付</option>
                            <option value="boolean">真偽</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-700 pb-1">
                          <input
                            type="checkbox"
                            checked={col.required !== false}
                            onChange={(e) => {
                              const next = [...normalizedColumns];
                              next[index] = { ...col, required: e.target.checked };
                              setColumnDefinitions(next);
                            }}
                          />
                          <label>必須</label>
                        </div>
                        <Button
                          variant="ghost"
                          className="text-red-600"
                          onClick={() => {
                            const next = normalizedColumns.filter((_, i) => i !== index);
                            setColumnDefinitions(next);
                          }}
                        >
                          削除
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <Button
                variant="ghost"
                onClick={() => {
                  setColumnDefinitions([
                    ...normalizedColumns,
                    {
                      internalName: '',
                      displayName: '',
                      csvHeaderCandidates: [],
                      dataType: 'string',
                      order: normalizedColumns.length,
                      required: true
                    }
                  ]);
                }}
              >
                + 列を追加
              </Button>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={upsert.isPending}>
                {upsert.isPending ? '保存中...' : '設定を保存'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {purpose === 'master' && acquisition === 'manual' && manualAllowed && (
        <MasterImportPage />
      )}
      {purpose === 'master' && acquisition === 'manual' && !manualAllowed && (
        <Card title="手動取り込み">
          <p className="text-xs text-amber-700 font-semibold">このマスタは手動取り込みが無効です。</p>
        </Card>
      )}

      {acquisition === 'scheduled' && scheduledAllowed && (
        <CsvImportSchedulePage />
      )}
      {acquisition === 'scheduled' && !scheduledAllowed && (
        <Card title="自動取り込み">
          <p className="text-xs text-amber-700 font-semibold">このマスタは自動取り込みが無効です。</p>
        </Card>
      )}
    </div>
  );
}
