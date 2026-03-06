import { useEffect, useMemo, useState } from 'react';

import {
  useKioskProductionScheduleDueManagementSeibanDetail,
  useKioskProductionScheduleDueManagementSummary,
  useUpdateKioskProductionScheduleDueManagementPartPriorities,
  useUpdateKioskProductionScheduleDueManagementSeibanDueDate
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { movePriorityItem, normalizeDueDateInput } from '../../features/kiosk/productionSchedule/dueManagement';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';

export function ProductionScheduleDueManagementPage() {
  const summaryQuery = useKioskProductionScheduleDueManagementSummary();
  const [selectedFseiban, setSelectedFseiban] = useState<string | null>(null);
  const detailQuery = useKioskProductionScheduleDueManagementSeibanDetail(selectedFseiban);
  const updateDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanDueDate();
  const updatePartPrioritiesMutation = useUpdateKioskProductionScheduleDueManagementPartPriorities();

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState('');
  const [orderedFhincds, setOrderedFhincds] = useState<string[]>([]);
  const detail = detailQuery.data;
  type DuePart = NonNullable<typeof detailQuery.data>['parts'][number];

  useEffect(() => {
    if (selectedFseiban) return;
    const firstFseiban = summaryQuery.data?.[0]?.fseiban;
    if (firstFseiban) setSelectedFseiban(firstFseiban);
  }, [selectedFseiban, summaryQuery.data]);

  useEffect(() => {
    if (!detail) return;
    const prioritized = [...detail.parts]
      .sort((a, b) => {
        if (a.currentPriorityRank !== null && b.currentPriorityRank !== null) {
          return a.currentPriorityRank - b.currentPriorityRank;
        }
        if (a.currentPriorityRank !== null) return -1;
        if (b.currentPriorityRank !== null) return 1;
        return a.suggestedPriorityRank - b.suggestedPriorityRank;
      })
      .map((part) => part.fhincd);
    setOrderedFhincds(prioritized);
  }, [detail]);

  const partsByFhincd = useMemo(() => {
    const map = new Map<string, DuePart>();
    (detail?.parts ?? []).forEach((part) => map.set(part.fhincd, part));
    return map;
  }, [detail]);

  const orderedParts = useMemo(
    () => orderedFhincds.map((fhincd) => partsByFhincd.get(fhincd)).filter((part) => Boolean(part)),
    [orderedFhincds, partsByFhincd]
  );

  const openDatePicker = () => {
    if (!detailQuery.data?.fseiban) return;
    setEditingDueDate(normalizeDueDateInput(detailQuery.data.dueDate));
    setIsDatePickerOpen(true);
  };

  const commitDueDate = (value: string) => {
    if (!selectedFseiban) return;
    setEditingDueDate(value);
    updateDueDateMutation.mutate(
      { fseiban: selectedFseiban, dueDate: value },
      {
        onSuccess: () => {
          setIsDatePickerOpen(false);
        }
      }
    );
  };

  const savePartPriorities = () => {
    if (!selectedFseiban) return;
    updatePartPrioritiesMutation.mutate({
      fseiban: selectedFseiban,
      orderedFhincds
    });
  };

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
      <section className="overflow-hidden rounded-lg border border-white/20 bg-slate-900/60">
        <header className="border-b border-white/20 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">製番一覧（納期管理）</h2>
        </header>
        <div className="h-[calc(100%-52px)] overflow-auto">
          {summaryQuery.isLoading ? <p className="px-4 py-3 text-sm text-white/80">読み込み中...</p> : null}
          {summaryQuery.isError ? <p className="px-4 py-3 text-sm text-rose-300">取得に失敗しました。</p> : null}
          {(summaryQuery.data ?? []).map((item) => (
            <button
              key={item.fseiban}
              type="button"
              onClick={() => setSelectedFseiban(item.fseiban)}
              className={`w-full border-b border-white/10 px-4 py-3 text-left hover:bg-white/10 ${
                selectedFseiban === item.fseiban ? 'bg-blue-600/30' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-white">{item.fseiban}</span>
                <span className="text-xs text-white/70">{formatDueDate(item.dueDate)}</span>
              </div>
              <div className="mt-1 text-xs text-white/70">
                部品 {item.partsCount}件 / 工程 {item.processCount}件 / 所要 {Math.round(item.totalRequiredMinutes)} min
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-white/20 bg-slate-900/60">
        <header className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">部品優先順位（製番単位）</h2>
            <p className="text-xs text-white/70">
              製番: <span className="font-mono">{detailQuery.data?.fseiban ?? '-'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openDatePicker}
              className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
              disabled={!detailQuery.data}
            >
              納期日: {formatDueDate(detailQuery.data?.dueDate ?? null)}
            </button>
            <button
              type="button"
              onClick={savePartPriorities}
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              disabled={!selectedFseiban || updatePartPrioritiesMutation.isPending}
            >
              {updatePartPrioritiesMutation.isPending ? '保存中...' : '優先順位を保存'}
            </button>
          </div>
        </header>
        <div className="h-[calc(100%-52px)] overflow-auto p-4">
          {detailQuery.isLoading ? <p className="text-sm text-white/80">読み込み中...</p> : null}
          {detailQuery.isError ? <p className="text-sm text-rose-300">詳細取得に失敗しました。</p> : null}
          {!detailQuery.isLoading && orderedParts.length === 0 ? (
            <p className="text-sm text-white/80">製番を選択してください。</p>
          ) : null}
          {orderedParts.length > 0 ? (
            <table className="w-full border-collapse text-left text-xs text-white">
              <thead>
                <tr className="border-b border-white/20 text-white/80">
                  <th className="px-2 py-2">順位</th>
                  <th className="px-2 py-2">部品</th>
                  <th className="px-2 py-2">品名</th>
                  <th className="px-2 py-2">処理</th>
                  <th className="px-2 py-2">工程数</th>
                  <th className="px-2 py-2">所要(min)</th>
                  <th className="px-2 py-2">提案順位</th>
                  <th className="px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {orderedParts.map((part, index) => (
                  <tr key={part?.fhincd ?? index} className="border-b border-white/10">
                    <td className="px-2 py-2">{index + 1}</td>
                    <td className="px-2 py-2 font-mono">{part?.fhincd}</td>
                    <td className="px-2 py-2">{part?.fhinmei || '-'}</td>
                    <td className="px-2 py-2">{part?.processingType || '-'}</td>
                    <td className="px-2 py-2">{part?.processCount ?? 0}</td>
                    <td className="px-2 py-2">{Math.round(part?.totalRequiredMinutes ?? 0)}</td>
                    <td className="px-2 py-2">{part?.suggestedPriorityRank ?? '-'}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                          onClick={() => setOrderedFhincds((prev) => movePriorityItem(prev, index, -1))}
                          disabled={index === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                          onClick={() => setOrderedFhincds((prev) => movePriorityItem(prev, index, 1))}
                          disabled={index === orderedParts.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </section>
      <KioskDatePickerModal
        isOpen={isDatePickerOpen}
        value={editingDueDate}
        onCancel={() => setIsDatePickerOpen(false)}
        onCommit={commitDueDate}
      />
    </div>
  );
}
