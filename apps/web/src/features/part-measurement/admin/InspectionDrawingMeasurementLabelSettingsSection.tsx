import {
  INSPECTION_DRAWING_TOLERANCE_KIND_DIMENSION,
  INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC,
  type InspectionDrawingMeasurementLabelSetting,
  type InspectionDrawingToleranceKind
} from '@raspi-system/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  listInspectionDrawingMeasurementLabelSettings,
  updateInspectionDrawingMeasurementLabelSettings
} from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';

const QUERY_KEY = ['part-measurement', 'inspection-drawing-measurement-label-settings'] as const;

function toleranceKindLabel(kind: InspectionDrawingToleranceKind): string {
  return kind === INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC ? '幾何公差' : '寸法公差';
}

function validateRows(
  rows: readonly InspectionDrawingMeasurementLabelSetting[]
): InspectionDrawingMeasurementLabelSetting[] | string {
  const normalized = rows.map((row) => ({
    label: row.label.trim(),
    toleranceKind: row.toleranceKind
  }));
  const emptyIndex = normalized.findIndex((row) => row.label.length === 0);
  if (emptyIndex >= 0) {
    return `${emptyIndex + 1}行目の名称を入力してください。`;
  }
  const seen = new Set<string>();
  for (const row of normalized) {
    if (seen.has(row.label)) {
      return `名称が重複しています: ${row.label}`;
    }
    seen.add(row.label);
  }
  return normalized;
}

export function InspectionDrawingMeasurementLabelSettingsSection() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<InspectionDrawingMeasurementLabelSetting[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => listInspectionDrawingMeasurementLabelSettings()
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setRows(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (settings: InspectionDrawingMeasurementLabelSetting[]) =>
      updateInspectionDrawingMeasurementLabelSettings({ settings }),
    onSuccess: (settings) => {
      setRows(settings);
      setMessage('保存しました。');
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error & { response?: { data?: { message?: string } } }) => {
      setMessage(e.response?.data?.message ?? e.message ?? '保存に失敗しました。');
    }
  });

  const updateRow = (
    index: number,
    patch: Partial<InspectionDrawingMeasurementLabelSetting>
  ) => {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const handleSave = () => {
    setMessage(null);
    const validated = validateRows(rows);
    if (typeof validated === 'string') {
      setMessage(validated);
      return;
    }
    saveMutation.mutate(validated);
  };

  return (
    <Card title="検査図面 名称・公差種別">
      <div className="grid gap-3">
        {settingsQuery.isLoading ? (
          <p className="text-sm text-slate-600">読み込み中…</p>
        ) : settingsQuery.isError ? (
          <p className="text-sm text-red-600">取得に失敗しました。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600">
                  <th className="w-1/2 py-2 pr-2 font-semibold">名称</th>
                  <th className="w-48 py-2 pr-2 font-semibold">公差種別</th>
                  <th className="w-24 py-2 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`inspection-label-setting-${index}`} className="border-b border-slate-100">
                    <td className="py-2 pr-2">
                      <Input
                        value={row.label}
                        onChange={(e) => updateRow(index, { label: e.target.value })}
                        placeholder="名称"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                        value={row.toleranceKind}
                        aria-label={`公差種別 ${row.label || index + 1}`}
                        onChange={(e) =>
                          updateRow(index, {
                            toleranceKind: e.target.value as InspectionDrawingToleranceKind
                          })
                        }
                      >
                        <option value={INSPECTION_DRAWING_TOLERANCE_KIND_DIMENSION}>
                          {toleranceKindLabel(INSPECTION_DRAWING_TOLERANCE_KIND_DIMENSION)}
                        </option>
                        <option value={INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC}>
                          {toleranceKindLabel(INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC)}
                        </option>
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== index))}
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { label: '', toleranceKind: INSPECTION_DRAWING_TOLERANCE_KIND_DIMENSION }
              ])
            }
          >
            行を追加
          </Button>
          <Button
            type="button"
            disabled={saveMutation.isPending || settingsQuery.isLoading}
            onClick={handleSave}
          >
            {saveMutation.isPending ? '保存中…' : '保存'}
          </Button>
          {message ? <p className="text-sm font-semibold text-amber-800">{message}</p> : null}
        </div>
      </div>
    </Card>
  );
}
