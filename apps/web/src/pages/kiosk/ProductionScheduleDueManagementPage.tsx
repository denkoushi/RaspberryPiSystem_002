import { isAxiosError } from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionScheduleDueManagementSeibanDetail,
  useKioskProductionScheduleDueManagementSummary,
  useKioskProductionScheduleProcessingTypeOptions,
  useKioskProductionScheduleSearchState,
  useUpdateKioskProductionScheduleDueManagementPartProcessingType,
  useUpdateKioskProductionScheduleDueManagementPartPriorities,
  useUpdateKioskProductionScheduleDueManagementSeibanDueDate,
  useUpdateKioskProductionScheduleSearchState
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { SeibanHistoryButton } from '../../components/kiosk/SeibanHistoryButton';
import { movePriorityItem, normalizeDueDateInput } from '../../features/kiosk/productionSchedule/dueManagement';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';

const normalizeHistoryList = (items: string[]) => {
  const unique = new Set<string>();
  const next: string[] = [];
  items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => {
      if (unique.has(item)) return;
      unique.add(item);
      next.push(item);
    });
  return next.slice(0, 20);
};

export function ProductionScheduleDueManagementPage() {
  const summaryQuery = useKioskProductionScheduleDueManagementSummary();
  const processingTypeOptionsQuery = useKioskProductionScheduleProcessingTypeOptions();
  const searchStateQuery = useKioskProductionScheduleSearchState();
  const updateSearchStateMutation = useUpdateKioskProductionScheduleSearchState();

  const searchStateUpdatedAtRef = useRef<string | null>(null);
  const searchStateEtagRef = useRef<string | null>(null);
  const [searchInput, setSearchInput] = useState('');

  const [selectedFseiban, setSelectedFseiban] = useState<string | null>(null);
  const detailQuery = useKioskProductionScheduleDueManagementSeibanDetail(selectedFseiban);
  const updateDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanDueDate();
  const updatePartPrioritiesMutation = useUpdateKioskProductionScheduleDueManagementPartPriorities();
  const updatePartProcessingMutation = useUpdateKioskProductionScheduleDueManagementPartProcessingType();

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState('');
  const [orderedFhincds, setOrderedFhincds] = useState<string[]>([]);
  const detail = detailQuery.data;
  type DuePart = NonNullable<typeof detailQuery.data>['parts'][number];
  type SummaryItem = NonNullable<typeof summaryQuery.data>[number];
  const sharedHistory = useMemo(
    () => normalizeHistoryList(searchStateQuery.data?.state?.history ?? []),
    [searchStateQuery.data?.state?.history]
  );

  const summaryBySeiban = useMemo(() => {
    const map = new Map<string, SummaryItem>();
    (summaryQuery.data ?? []).forEach((item) => map.set(item.fseiban, item));
    return map;
  }, [summaryQuery.data]);
  const visibleSummaries = useMemo(
    () => sharedHistory.map((fseiban) => summaryBySeiban.get(fseiban)).filter((item): item is SummaryItem => Boolean(item)),
    [sharedHistory, summaryBySeiban]
  );

  useEffect(() => {
    if (selectedFseiban && visibleSummaries.some((item) => item.fseiban === selectedFseiban)) {
      return;
    }
    const firstFseiban = visibleSummaries[0]?.fseiban;
    setSelectedFseiban(firstFseiban ?? null);
  }, [selectedFseiban, visibleSummaries]);

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

  useEffect(() => {
    const incomingEtag = searchStateQuery.data?.etag ?? null;
    if (incomingEtag) {
      searchStateEtagRef.current = incomingEtag;
    }
    const incomingUpdatedAt = searchStateQuery.data?.updatedAt ?? null;
    if (incomingUpdatedAt) {
      searchStateUpdatedAtRef.current = incomingUpdatedAt;
    }
  }, [searchStateQuery.data?.etag, searchStateQuery.data?.updatedAt]);

  const updateSharedHistory = async (
    nextHistory: string[],
    operation: { type: 'add' | 'remove'; value: string },
    attempt = 0
  ) => {
    if (!searchStateEtagRef.current) {
      const latest = await searchStateQuery.refetch();
      const latestEtag = latest.data?.etag ?? null;
      if (latestEtag) searchStateEtagRef.current = latestEtag;
    }
    const ifMatch = searchStateEtagRef.current;
    if (!ifMatch) return;
    try {
      const result = await updateSearchStateMutation.mutateAsync({
        state: { history: nextHistory },
        ifMatch
      });
      searchStateUpdatedAtRef.current = result.updatedAt;
      if (result.etag) {
        searchStateEtagRef.current = result.etag;
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409 && attempt < 2) {
        const details = (error.response?.data?.details ?? {}) as {
          state?: { history?: string[] };
          etag?: string | null;
        };
        const latestHistory = normalizeHistoryList(details.state?.history ?? []);
        const rebased =
          operation.type === 'add'
            ? normalizeHistoryList([operation.value, ...latestHistory])
            : latestHistory.filter((item) => item !== operation.value);
        if (details.etag) {
          searchStateEtagRef.current = details.etag;
        }
        await updateSharedHistory(rebased, operation, attempt + 1);
      }
      throw error;
    }
  };

  const applySearch = async () => {
    const trimmed = searchInput.trim();
    if (trimmed.length === 0) return;
    const nextHistory = normalizeHistoryList([trimmed, ...sharedHistory]);
    await updateSharedHistory(nextHistory, { type: 'add', value: trimmed });
    setSelectedFseiban(trimmed);
    setSearchInput('');
  };

  const removeFromHistory = async (fseiban: string) => {
    const nextHistory = sharedHistory.filter((item) => item !== fseiban);
    await updateSharedHistory(nextHistory, { type: 'remove', value: fseiban });
    if (selectedFseiban === fseiban) {
      setSelectedFseiban(nextHistory[0] ?? null);
    }
  };

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

  const saveProcessingType = (fhincd: string, processingType: string) => {
    if (!selectedFseiban) return;
    updatePartProcessingMutation.mutate({
      fseiban: selectedFseiban,
      fhincd,
      processingType
    });
  };

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
      <section className="overflow-hidden rounded-lg border border-white/20 bg-slate-900/60">
        <header className="border-b border-white/20 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">製番一覧（納期管理）</h2>
        </header>
        <div className="h-[calc(100%-52px)] overflow-auto px-3 py-3">
          <div className="mb-3 flex gap-2">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void applySearch();
                }
              }}
              placeholder="製番を検索"
              className="h-9 flex-1 rounded border border-white/20 bg-white px-2 text-xs text-slate-900"
            />
            <button
              type="button"
              onClick={() => void applySearch()}
              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            >
              検索
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {sharedHistory.map((fseiban) => {
              const summary = summaryBySeiban.get(fseiban);
              return (
                <SeibanHistoryButton
                  key={fseiban}
                  seiban={fseiban}
                  machineName={summary?.machineName}
                  isActive={selectedFseiban === fseiban}
                  isComplete={false}
                  canMoveLeft={false}
                  canMoveRight={false}
                  onToggle={() => setSelectedFseiban(fseiban)}
                  onRemove={() => void removeFromHistory(fseiban)}
                  onMoveLeft={() => {}}
                  onMoveRight={() => {}}
                />
              );
            })}
          </div>
          {summaryQuery.isLoading ? <p className="px-4 py-3 text-sm text-white/80">読み込み中...</p> : null}
          {summaryQuery.isError ? <p className="px-4 py-3 text-sm text-rose-300">取得に失敗しました。</p> : null}
          {visibleSummaries.map((item) => (
            <button
              key={item.fseiban}
              type="button"
              onClick={() => setSelectedFseiban(item.fseiban)}
              className={`w-full border-b border-white/10 px-4 py-3 text-left hover:bg-white/10 ${
                selectedFseiban === item.fseiban ? 'bg-blue-600/30' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-white">
                  {item.fseiban}
                  <span className="ml-2 text-xs font-normal text-white/70">{item.machineName ?? '-'}</span>
                </span>
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
              <span className="ml-2">{detailQuery.data?.machineName ?? '-'}</span>
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
                  <th className="px-2 py-2">工程進捗</th>
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
                    <td className="px-2 py-2">
                      <select
                        value={part?.processingType ?? ''}
                        onChange={(event) => {
                          if (!part?.fhincd) return;
                          saveProcessingType(part.fhincd, event.target.value);
                        }}
                        className="h-8 w-24 rounded border border-slate-300 bg-white px-2 text-xs text-black"
                        disabled={updatePartProcessingMutation.isPending}
                      >
                        <option value="">-</option>
                        {(processingTypeOptionsQuery.data ?? []).filter((option) => option.enabled).map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">{part?.processCount ?? 0}</td>
                    <td className="px-2 py-2">
                      <div className="mb-1 text-[10px] text-white/80">
                        {part?.completedProcessCount ?? 0}/{part?.totalProcessCount ?? 0}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(part?.processes ?? []).map((process) => (
                          <span
                            key={process.rowId}
                            className={`rounded border px-2 py-1 text-[10px] ${
                              process.isCompleted
                                ? 'border-slate-500 bg-slate-600 text-slate-200'
                                : 'border-blue-300 bg-blue-500/30 text-blue-100'
                            }`}
                          >
                            {process.resourceCd}
                            {process.processOrder !== null ? `-${process.processOrder}` : ''}
                          </span>
                        ))}
                      </div>
                    </td>
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
