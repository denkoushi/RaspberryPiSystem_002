import { useMemo, useState } from 'react';

import { useCsvDashboards, useUninspectedMachines } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

function getTodayInTokyo(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

export function MachinesUninspectedPage() {
  const [date, setDate] = useState<string>(getTodayInTokyo());
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>('');
  const [submittedDate, setSubmittedDate] = useState<string>(getTodayInTokyo());
  const [submittedDashboardId, setSubmittedDashboardId] = useState<string>('');

  const dashboardsQuery = useCsvDashboards({ enabled: true });
  const uninspectedQuery = useUninspectedMachines(
    { csvDashboardId: submittedDashboardId, date: submittedDate },
    { enabled: Boolean(submittedDashboardId) },
  );

  const dashboards = useMemo(() => dashboardsQuery.data ?? [], [dashboardsQuery.data]);

  const handleSearch = () => {
    setSubmittedDate(date);
    setSubmittedDashboardId(selectedDashboardId);
  };

  return (
    <div className="space-y-6">
      <Card title="未点検加工機（当日差分）">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            対象日（JST）
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            点検結果CSVダッシュボード
            <select
              className="mt-1 w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={selectedDashboardId}
              onChange={(e) => setSelectedDashboardId(e.target.value)}
            >
              <option value="">選択してください</option>
              {dashboards.map((dashboard) => (
                <option key={dashboard.id} value={dashboard.id}>
                  {dashboard.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button onClick={handleSearch} disabled={!selectedDashboardId}>
              抽出
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          判定基準: 加工機マスター（稼働中）の設備管理番号 － 当日点検結果（CSVダッシュボード）に存在する設備管理番号
        </p>
      </Card>

      <Card title="抽出結果">
        {!submittedDashboardId ? (
          <p className="text-sm font-semibold text-slate-700">点検結果CSVダッシュボードを選択して抽出してください。</p>
        ) : uninspectedQuery.isLoading ? (
          <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
        ) : uninspectedQuery.isError ? (
          <p className="text-sm font-semibold text-red-700">未点検一覧の取得に失敗しました。</p>
        ) : (
          <>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-600">対象日</p>
                <p className="font-semibold text-slate-900">{uninspectedQuery.data?.date ?? '-'}</p>
              </div>
              <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-600">稼働中加工機</p>
                <p className="font-semibold text-slate-900">{uninspectedQuery.data?.totalRunningMachines ?? 0}</p>
              </div>
              <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-600">点検済み（稼働中）</p>
                <p className="font-semibold text-emerald-700">{uninspectedQuery.data?.inspectedRunningCount ?? 0}</p>
              </div>
              <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-600">未点検</p>
                <p className="font-semibold text-red-700">{uninspectedQuery.data?.uninspectedCount ?? 0}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-200">
                  <tr className="border-b-2 border-slate-500">
                    <th className="px-2 py-1 font-semibold text-slate-900">設備管理番号</th>
                    <th className="px-2 py-1 font-semibold text-slate-900">加工機名</th>
                    <th className="px-2 py-1 font-semibold text-slate-900">略称</th>
                    <th className="px-2 py-1 font-semibold text-slate-900">加工機分類</th>
                    <th className="px-2 py-1 font-semibold text-slate-900">メーカー</th>
                    <th className="px-2 py-1 font-semibold text-slate-900">工程分類</th>
                  </tr>
                </thead>
                <tbody>
                  {(uninspectedQuery.data?.uninspectedMachines ?? []).map((machine) => (
                    <tr key={machine.id} className="border-t border-slate-500">
                      <td className="px-2 py-1 font-mono text-sm text-slate-800">{machine.equipmentManagementNumber}</td>
                      <td className="px-2 py-1 text-slate-800">{machine.name}</td>
                      <td className="px-2 py-1 text-slate-700">{machine.shortName ?? '-'}</td>
                      <td className="px-2 py-1 text-slate-700">{machine.classification ?? '-'}</td>
                      <td className="px-2 py-1 text-slate-700">{machine.maker ?? '-'}</td>
                      <td className="px-2 py-1 text-slate-700">{machine.processClassification ?? '-'}</td>
                    </tr>
                  ))}
                  {(uninspectedQuery.data?.uninspectedMachines?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-4 text-center text-sm font-semibold text-emerald-700">
                        未点検の加工機はありません。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
