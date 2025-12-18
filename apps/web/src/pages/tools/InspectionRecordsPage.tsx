import { FormEvent, useState } from 'react';

import { useInspectionRecordCreate, useInspectionRecords, useMeasuringInstrument } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { InspectionRecord, InspectionResult } from '../../api/types';

const resultOptions: InspectionResult[] = ['PASS', 'FAIL'];

export function InspectionRecordsPage() {
  const [instrumentId, setInstrumentId] = useState('');
  const [filters, setFilters] = useState<{ startDate?: string; endDate?: string; employeeId?: string; result?: string }>(
    {}
  );
  const [form, setForm] = useState({
    loanId: '',
    employeeId: '',
    inspectionItemId: '',
    result: 'PASS' as InspectionResult,
    inspectedAt: ''
  });

  const { data: instrument } = useMeasuringInstrument(instrumentId || undefined);
  const { data: records } = useInspectionRecords(instrumentId || undefined, filters);
  const createRecord = useInspectionRecordCreate();

  const handleFilter = (e: FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!instrumentId) return;
    await createRecord.mutateAsync({
      measuringInstrumentId: instrumentId,
      loanId: form.loanId || undefined,
      employeeId: form.employeeId,
      inspectionItemId: form.inspectionItemId,
      result: form.result,
      inspectedAt: form.inspectedAt ? new Date(form.inspectedAt).toISOString() : new Date().toISOString()
    });
    setForm({ loanId: '', employeeId: '', inspectionItemId: '', result: 'PASS', inspectedAt: '' });
  };

  return (
    <div className="space-y-6">
      <Card title="計測機器選択">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            計測機器ID
            <Input value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} placeholder="UUIDを入力" />
          </label>
          <div className="flex items-end">
            {instrument ? (
              <p className="text-sm font-semibold text-slate-700">
                {instrument.name} ({instrument.managementNumber})
              </p>
            ) : (
              <p className="text-sm text-slate-600">計測機器を選択してください</p>
            )}
          </div>
        </div>
      </Card>

      <Card title="フィルタ">
        <form onSubmit={handleFilter} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">
            開始日
            <Input
              type="date"
              value={filters.startDate ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value || undefined }))}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            終了日
            <Input
              type="date"
              value={filters.endDate ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value || undefined }))}
            />
          </label>
          <label className="text-sm text-white/70">
            従業員ID
            <Input
              value={filters.employeeId ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, employeeId: e.target.value || undefined }))}
              placeholder="従業員UUID"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            結果
            <select
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              value={filters.result ?? ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, result: e.target.value || undefined }))}
            >
              <option value="">すべて</option>
              {resultOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-4">
            <Button type="submit">フィルタ適用</Button>
          </div>
        </form>
      </Card>

      <Card title="点検記録 登録（手動）">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Loan ID
            <Input
              value={form.loanId}
              onChange={(e) => setForm((prev) => ({ ...prev, loanId: e.target.value }))}
              placeholder="任意（未入力可）"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            従業員ID
            <Input
              value={form.employeeId}
              onChange={(e) => setForm((prev) => ({ ...prev, employeeId: e.target.value }))}
              required
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            点検項目ID
            <Input
              value={form.inspectionItemId}
              onChange={(e) => setForm((prev) => ({ ...prev, inspectionItemId: e.target.value }))}
              required
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            点検結果
            <select
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              value={form.result}
              onChange={(e) => setForm((prev) => ({ ...prev, result: e.target.value as InspectionResult }))}
            >
              {resultOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700 md:col-span-2">
            点検日時
            <Input
              type="datetime-local"
              value={form.inspectedAt}
              onChange={(e) => setForm((prev) => ({ ...prev, inspectedAt: e.target.value }))}
            />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={!instrumentId || createRecord.isPending}>
              {createRecord.isPending ? '送信中…' : '記録登録'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="点検記録一覧">
        {!instrumentId ? (
          <p className="text-sm text-slate-600">計測機器IDを入力してください。</p>
        ) : !records ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中…</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-slate-600">記録はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-200 text-left">
                <tr>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">日時</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">結果</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">従業員ID</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">点検項目ID</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">Loan ID</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r: InspectionRecord) => (
                  <tr key={r.id} className="border-t border-slate-500">
                    <td className="px-2 py-1 text-sm text-slate-700">
                      {r.inspectedAt ? new Date(r.inspectedAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-2 py-1 text-sm text-slate-700">{r.result}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{r.employeeId}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{r.inspectionItemId}</td>
                    <td className="px-2 py-1 text-sm text-slate-700">{r.loanId ?? '-'}</td>
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
