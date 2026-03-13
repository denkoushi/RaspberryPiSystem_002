import { isAxiosError } from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionScheduleDueManagementDailyPlan,
  useKioskProductionScheduleDueManagementGlobalRank,
  useKioskProductionScheduleDueManagementGlobalRankProposal,
  useKioskProductionScheduleDueManagementSeibanDetail,
  useKioskProductionScheduleDueManagementSummary,
  useKioskProductionScheduleDueManagementTriage,
  useKioskProductionScheduleProcessingTypeOptions,
  useKioskProductionScheduleSearchState,
  useUpdateKioskProductionScheduleDueManagementPartNote,
  useUpdateKioskProductionScheduleDueManagementPartProcessingType,
  useUpdateKioskProductionScheduleDueManagementPartPriorities,
  useUpdateKioskProductionScheduleDueManagementDailyPlan,
  useAutoGenerateKioskProductionScheduleDueManagementGlobalRank,
  useUpdateKioskProductionScheduleDueManagementSeibanDueDate,
  useUpdateKioskProductionScheduleDueManagementTriageSelection,
  useUpdateKioskProductionScheduleSearchState
} from '../../api/hooks';
import { DueManagementActiveContextBar } from '../../components/kiosk/dueManagement/DueManagementActiveContextBar';
import { DueManagementDetailPanel } from '../../components/kiosk/dueManagement/DueManagementDetailPanel';
import { DueManagementLayoutShell } from '../../components/kiosk/dueManagement/DueManagementLayoutShell';
import { DueManagementLeftRail } from '../../components/kiosk/dueManagement/DueManagementLeftRail';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { KioskKeyboardModal } from '../../components/kiosk/KioskKeyboardModal';
import { KioskNoteModal } from '../../components/kiosk/KioskNoteModal';
import { movePriorityItem, normalizeDueDateInput } from '../../features/kiosk/productionSchedule/dueManagement';
import {
  buildDailyPlanMetaBySeiban,
  buildGlobalRankItems,
  buildOrderedFhincds,
  buildOrderedParts,
  buildOrderedPlanItems,
  buildPartsByFhincd,
  buildProposalBySeiban,
  buildSummaryBySeiban,
  buildTriageBySeiban,
  buildTriageCandidates,
  buildVisibleSummaries,
  resolveNextSelectedFseiban
} from '../../features/kiosk/productionSchedule/dueManagementViewModel';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';
import { isMacEnvironment } from '../../lib/client-key/resolver';

const NOTE_MAX_LENGTH = 100;
const DUE_MANAGEMENT_TARGET_LOCATION_STORAGE_KEY = 'due-management-target-location';
const DEFAULT_TARGET_LOCATIONS = ['第2工場', 'トークプラザ', '第1工場'] as const;
const TARGET_LOCATION_SELECTOR_ENABLED = import.meta.env.VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED !== 'false';
const DUE_MANAGEMENT_LAYOUT_V2_ENABLED = import.meta.env.VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED === 'true';

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
  const isMac =
    typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const canSelectTargetLocation = isMac && TARGET_LOCATION_SELECTOR_ENABLED;
  const [targetLocation, setTargetLocation] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_TARGET_LOCATIONS[0];
    const stored = window.localStorage.getItem(DUE_MANAGEMENT_TARGET_LOCATION_STORAGE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_TARGET_LOCATIONS[0];
  });
  const rankingContext = useMemo(
    () => ({
      targetLocation: canSelectTargetLocation ? targetLocation : undefined,
      rankingScope: 'globalShared' as const
    }),
    [canSelectTargetLocation, targetLocation]
  );

  const summaryQuery = useKioskProductionScheduleDueManagementSummary();
  const triageQuery = useKioskProductionScheduleDueManagementTriage();
  const dailyPlanQuery = useKioskProductionScheduleDueManagementDailyPlan();
  const globalRankQuery = useKioskProductionScheduleDueManagementGlobalRank(rankingContext);
  const globalRankProposalQuery = useKioskProductionScheduleDueManagementGlobalRankProposal(rankingContext);
  const processingTypeOptionsQuery = useKioskProductionScheduleProcessingTypeOptions();
  const searchStateQuery = useKioskProductionScheduleSearchState();
  const updateSearchStateMutation = useUpdateKioskProductionScheduleSearchState();
  const updateTriageSelectionMutation = useUpdateKioskProductionScheduleDueManagementTriageSelection();
  const updateDailyPlanMutation = useUpdateKioskProductionScheduleDueManagementDailyPlan();
  const autoGenerateGlobalRankMutation = useAutoGenerateKioskProductionScheduleDueManagementGlobalRank();

  const searchStateUpdatedAtRef = useRef<string | null>(null);
  const searchStateEtagRef = useRef<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardValue, setKeyboardValue] = useState('');
  const [orderedPlanFseibans, setOrderedPlanFseibans] = useState<string[]>([]);
  const [isDailyPlanDirty, setIsDailyPlanDirty] = useState(false);

  const [selectedFseiban, setSelectedFseiban] = useState<string | null>(null);
  const detailQuery = useKioskProductionScheduleDueManagementSeibanDetail(selectedFseiban);
  const updateDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanDueDate();
  const updatePartPrioritiesMutation = useUpdateKioskProductionScheduleDueManagementPartPriorities();
  const updatePartProcessingMutation = useUpdateKioskProductionScheduleDueManagementPartProcessingType();
  const updatePartNoteMutation = useUpdateKioskProductionScheduleDueManagementPartNote();

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState('');
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNotePart, setEditingNotePart] = useState<{ fhincd: string; note: string } | null>(null);
  const [orderedFhincds, setOrderedFhincds] = useState<string[]>([]);
  const detail = detailQuery.data;
  const sharedHistory = useMemo(
    () => normalizeHistoryList(searchStateQuery.data?.state?.history ?? []),
    [searchStateQuery.data?.state?.history]
  );

  const summaryBySeiban = useMemo(() => buildSummaryBySeiban(summaryQuery.data), [summaryQuery.data]);
  const visibleSummaries = useMemo(() => buildVisibleSummaries(sharedHistory, summaryBySeiban), [sharedHistory, summaryBySeiban]);
  const triageCandidates = useMemo(() => buildTriageCandidates(triageQuery.data), [triageQuery.data]);
  const selectedSet = useMemo(
    () => new Set(triageQuery.data?.selectedFseibans ?? []),
    [triageQuery.data?.selectedFseibans]
  );
  const filteredTriageCandidates = useMemo(
    () => (showSelectedOnly ? triageCandidates.filter((item) => selectedSet.has(item.fseiban)) : triageCandidates),
    [showSelectedOnly, triageCandidates, selectedSet]
  );

  const triageBySeiban = useMemo(() => buildTriageBySeiban(triageCandidates), [triageCandidates]);

  useEffect(() => {
    const base = isDailyPlanDirty
      ? orderedPlanFseibans
      : (dailyPlanQuery.data?.orderedFseibans ?? triageQuery.data?.selectedFseibans ?? []);
    const next: string[] = [];
    const seen = new Set<string>();
    base.forEach((fseiban) => {
      const normalized = fseiban.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      next.push(normalized);
    });
    if (next.join('\u0000') !== orderedPlanFseibans.join('\u0000')) {
      setOrderedPlanFseibans(next);
    }
  }, [
    dailyPlanQuery.data?.orderedFseibans,
    isDailyPlanDirty,
    orderedPlanFseibans,
    selectedSet,
    triageQuery.data?.selectedFseibans
  ]);

  const dailyPlanItemMetaBySeiban = useMemo(() => buildDailyPlanMetaBySeiban(dailyPlanQuery.data), [dailyPlanQuery.data]);

  const orderedPlanItems = useMemo(
    () =>
      buildOrderedPlanItems({
        orderedPlanFseibans,
        selectedSet,
        summaryBySeiban,
        triageBySeiban,
        dailyPlanMetaBySeiban: dailyPlanItemMetaBySeiban
      }),
    [dailyPlanItemMetaBySeiban, orderedPlanFseibans, selectedSet, summaryBySeiban, triageBySeiban]
  );

  const globalRankItems = useMemo(
    () =>
      buildGlobalRankItems({
        orderedFseibans: globalRankQuery.data?.orderedFseibans,
        selectedSet,
        summaryBySeiban,
        triageBySeiban,
        dailyPlanMetaBySeiban: dailyPlanItemMetaBySeiban
      }),
    [dailyPlanItemMetaBySeiban, globalRankQuery.data?.orderedFseibans, selectedSet, summaryBySeiban, triageBySeiban]
  );

  const proposalBySeiban = useMemo(
    () => buildProposalBySeiban(globalRankProposalQuery.data),
    [globalRankProposalQuery.data]
  );

  const autoGenerateGlobalRank = async () => {
    await autoGenerateGlobalRankMutation.mutateAsync({
      minCandidateCount: 1,
      maxReorderDeltaRatio: 0.95,
      keepExistingTail: true,
      ...rankingContext
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DUE_MANAGEMENT_TARGET_LOCATION_STORAGE_KEY, targetLocation);
  }, [targetLocation]);

  const saveDailyPlan = async () => {
    await updateDailyPlanMutation.mutateAsync({
      orderedFseibans: orderedPlanFseibans
    });
    setIsDailyPlanDirty(false);
  };

  const moveDailyPlanItem = (index: number, direction: -1 | 1) => {
    setOrderedPlanFseibans((prev) => movePriorityItem(prev, index, direction));
    setIsDailyPlanDirty(true);
  };

  const toggleTriageSelection = async (fseiban: string) => {
    const next = new Set(triageQuery.data?.selectedFseibans ?? []);
    if (next.has(fseiban)) {
      next.delete(fseiban);
    } else {
      next.add(fseiban);
    }
    await updateTriageSelectionMutation.mutateAsync({
      selectedFseibans: Array.from(next)
    });
  };

  useEffect(() => {
    const nextSelected = resolveNextSelectedFseiban({
      selectedFseiban,
      orderedPlanFseibans,
      triageCandidates,
      visibleSummaries
    });
    if (nextSelected !== selectedFseiban) {
      setSelectedFseiban(nextSelected);
    }
  }, [orderedPlanFseibans, selectedFseiban, triageCandidates, visibleSummaries]);

  useEffect(() => {
    if (!detail) return;
    setOrderedFhincds(buildOrderedFhincds(detail));
  }, [detail]);

  const partsByFhincd = useMemo(() => buildPartsByFhincd(detail), [detail]);

  const orderedParts = useMemo(() => buildOrderedParts(orderedFhincds, partsByFhincd), [orderedFhincds, partsByFhincd]);

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

  const openKeyboard = () => {
    setKeyboardValue(searchInput);
    setIsKeyboardOpen(true);
  };

  const confirmKeyboard = () => {
    setSearchInput(keyboardValue);
    setIsKeyboardOpen(false);
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

  const openPartNoteModal = (fhincd: string, note: string | null) => {
    setEditingNotePart({ fhincd, note: note ?? '' });
    setIsNoteModalOpen(true);
  };

  const closePartNoteModal = () => {
    setIsNoteModalOpen(false);
    setEditingNotePart(null);
  };

  const commitPartNote = (value: string) => {
    if (!selectedFseiban || !editingNotePart) return;
    updatePartNoteMutation.mutate(
      {
        fseiban: selectedFseiban,
        fhincd: editingNotePart.fhincd,
        note: value
      },
      {
        onSuccess: () => {
          closePartNoteModal();
        }
      }
    );
  };

  if (DUE_MANAGEMENT_LAYOUT_V2_ENABLED) {
    const selectedTriage = selectedFseiban ? triageBySeiban.get(selectedFseiban) ?? null : null;
    const triageZoneLabel = selectedTriage
      ? selectedTriage.zone === 'danger'
        ? '危険'
        : selectedTriage.zone === 'caution'
          ? '注意'
          : '余裕'
      : null;

    return (
      <div className="h-full">
        <DueManagementLayoutShell
          activeContext={
            <DueManagementActiveContextBar
              selectedFseiban={selectedFseiban}
              machineName={detailQuery.data?.machineName ?? null}
              dueDateLabel={formatDueDate(detailQuery.data?.dueDate ?? null)}
              triageZoneLabel={triageZoneLabel}
              isDailyPlanDirty={isDailyPlanDirty}
              isSavingDailyPlan={updateDailyPlanMutation.isPending}
              isSavingPartPriorities={updatePartPrioritiesMutation.isPending}
              isUpdatingDueDate={updateDueDateMutation.isPending}
            />
          }
          leftRail={
            <DueManagementLeftRail
              selectedFseiban={selectedFseiban}
              summaryLoading={summaryQuery.isLoading}
              summaryError={summaryQuery.isError}
              visibleSummaries={visibleSummaries}
              triageLoading={triageQuery.isLoading}
              triageError={triageQuery.isError}
              filteredTriageCandidates={filteredTriageCandidates}
              selectedSet={selectedSet}
              showSelectedOnly={showSelectedOnly}
              onToggleShowSelectedOnly={() => setShowSelectedOnly((prev) => !prev)}
              onToggleTriageSelection={(fseiban) => void toggleTriageSelection(fseiban)}
              triagePending={updateTriageSelectionMutation.isPending}
              canSelectTargetLocation={canSelectTargetLocation}
              targetLocation={targetLocation}
              targetLocations={DEFAULT_TARGET_LOCATIONS}
              onTargetLocationChange={setTargetLocation}
              autoGeneratePending={autoGenerateGlobalRankMutation.isPending}
              autoGenerateError={autoGenerateGlobalRankMutation.isError}
              autoGenerateGuardRejectedReason={
                autoGenerateGlobalRankMutation.data?.guard.rejected
                  ? autoGenerateGlobalRankMutation.data.guard.reason ?? 'unknown'
                  : null
              }
              autoGenerateAppliedRatioPercent={
                autoGenerateGlobalRankMutation.data?.applied
                  ? Math.round(autoGenerateGlobalRankMutation.data.guard.reorderDeltaRatio * 100)
                  : null
              }
              onAutoGenerate={() => void autoGenerateGlobalRank()}
              globalRankLoading={globalRankQuery.isLoading}
              globalRankError={globalRankQuery.isError}
              globalRankItems={globalRankItems}
              proposalBySeiban={proposalBySeiban}
              dailyPlanLoading={dailyPlanQuery.isLoading}
              orderedPlanItems={orderedPlanItems}
              isDailyPlanDirty={isDailyPlanDirty}
              dailyPlanPending={updateDailyPlanMutation.isPending}
              onSaveDailyPlan={() => void saveDailyPlan()}
              onMoveDailyPlanItem={moveDailyPlanItem}
              searchInput={searchInput}
              onSearchInputChange={setSearchInput}
              onOpenKeyboard={openKeyboard}
              onApplySearch={() => void applySearch()}
              sharedHistory={sharedHistory}
              onRemoveFromHistory={(fseiban) => void removeFromHistory(fseiban)}
              onSelectFseiban={setSelectedFseiban}
            />
          }
          detailPanel={
            <DueManagementDetailPanel
              detailLoading={detailQuery.isLoading}
              detailError={detailQuery.isError}
              selectedFseiban={selectedFseiban}
              fseiban={detailQuery.data?.fseiban ?? null}
              machineName={detailQuery.data?.machineName ?? null}
              dueDate={detailQuery.data?.dueDate ?? null}
              orderedParts={orderedParts}
              processingTypeOptions={processingTypeOptionsQuery.data ?? []}
              updatePartProcessingPending={updatePartProcessingMutation.isPending}
              updatePartPrioritiesPending={updatePartPrioritiesMutation.isPending}
              updatePartNotePending={updatePartNoteMutation.isPending}
              onOpenDatePicker={openDatePicker}
              onSavePartPriorities={savePartPriorities}
              onSaveProcessingType={saveProcessingType}
              onOpenPartNoteModal={openPartNoteModal}
              onMovePart={(index, direction) => setOrderedFhincds((prev) => movePriorityItem(prev, index, direction))}
            />
          }
        />
        <KioskDatePickerModal
          isOpen={isDatePickerOpen}
          value={editingDueDate}
          onCancel={() => setIsDatePickerOpen(false)}
          onCommit={commitDueDate}
        />
        <KioskKeyboardModal
          isOpen={isKeyboardOpen}
          value={keyboardValue}
          onChange={setKeyboardValue}
          onCancel={() => setIsKeyboardOpen(false)}
          onConfirm={confirmKeyboard}
        />
        <KioskNoteModal
          isOpen={isNoteModalOpen}
          value={editingNotePart?.note ?? ''}
          maxLength={NOTE_MAX_LENGTH}
          onCancel={closePartNoteModal}
          onCommit={commitPartNote}
        />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[380px_1fr]">
      <section className="overflow-hidden rounded-lg border border-white/20 bg-slate-900/60">
        <header className="border-b border-white/20 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">製番一覧（納期管理）</h2>
        </header>
        <div className="h-[calc(100%-52px)] overflow-auto px-3 py-3">
          <div className="mb-3 rounded border border-white/20 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">今日判断候補（トリアージ）</h3>
              <button
                type="button"
                className="rounded bg-slate-700 px-2 py-1 text-[11px] text-white hover:bg-slate-600"
                onClick={() => setShowSelectedOnly((prev) => !prev)}
              >
                {showSelectedOnly ? '全件表示' : '選択済みのみ'}
              </button>
            </div>
            {triageQuery.isLoading ? <p className="text-[11px] text-white/70">候補を読み込み中...</p> : null}
            {triageQuery.isError ? <p className="text-[11px] text-rose-300">候補取得に失敗しました</p> : null}
            {!triageQuery.isLoading && filteredTriageCandidates.length === 0 ? (
              <p className="text-[11px] text-white/60">候補はありません（検索登録製番を追加してください）</p>
            ) : null}
            <div className="space-y-2">
              {filteredTriageCandidates.map((item) => {
                const zoneStyle =
                  item.zone === 'danger'
                    ? 'border-rose-300/60 bg-rose-500/20 text-rose-100'
                    : item.zone === 'caution'
                      ? 'border-amber-300/60 bg-amber-500/20 text-amber-100'
                      : 'border-emerald-300/60 bg-emerald-500/20 text-emerald-100';
                const zoneLabel = item.zone === 'danger' ? '危険' : item.zone === 'caution' ? '注意' : '余裕';
                return (
                  <div key={item.fseiban} className={`rounded border p-2 ${zoneStyle}`}>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setSelectedFseiban(item.fseiban)}
                      >
                        <div className="text-xs font-semibold">
                          {zoneLabel} / <span className="font-mono">{item.fseiban}</span>
                        </div>
                        <div className="text-[10px] opacity-90">納期: {formatDueDate(item.dueDate)}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleTriageSelection(item.fseiban)}
                        className={`rounded px-2 py-1 text-[10px] font-semibold ${
                          selectedSet.has(item.fseiban)
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                        disabled={updateTriageSelectionMutation.isPending}
                      >
                        {selectedSet.has(item.fseiban) ? '選択済み' : '選択'}
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.reasons.map((reason) => (
                        <span key={`${item.fseiban}-${reason.code}`} className="rounded bg-black/20 px-2 py-0.5 text-[10px]">
                          {reason.message}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mb-3 rounded border border-white/20 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">全体ランキング（親）</h3>
              {canSelectTargetLocation ? (
                <select
                  value={targetLocation}
                  onChange={(event) => setTargetLocation(event.target.value)}
                  className="h-7 rounded border border-white/30 bg-slate-800 px-2 text-[11px] text-white"
                >
                  {DEFAULT_TARGET_LOCATIONS.map((location) => (
                    <option key={location} value={location}>
                      対象: {location}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                onClick={() => void autoGenerateGlobalRank()}
                disabled={autoGenerateGlobalRankMutation.isPending}
              >
                {autoGenerateGlobalRankMutation.isPending ? '自動生成中...' : '自動生成して保存'}
              </button>
            </div>
            <p className="mb-2 text-[10px] text-white/60">
              拠点全体の継続順位です。今日の計画順（子）はこの並びを起点に作成されます。
            </p>
            {autoGenerateGlobalRankMutation.isError ? (
              <p className="mb-2 text-[11px] text-rose-300">自動生成に失敗しました。再実行してください。</p>
            ) : null}
            {autoGenerateGlobalRankMutation.data?.guard.rejected ? (
              <p className="mb-2 text-[11px] text-amber-300">
                自動生成は安全ガードで未適用: {autoGenerateGlobalRankMutation.data.guard.reason ?? 'unknown'}
              </p>
            ) : null}
            {autoGenerateGlobalRankMutation.data?.applied ? (
              <p className="mb-2 text-[11px] text-emerald-300">
                自動生成を保存しました（差分率 {Math.round(autoGenerateGlobalRankMutation.data.guard.reorderDeltaRatio * 100)}%）
              </p>
            ) : null}
            {globalRankQuery.isLoading ? <p className="text-[11px] text-white/70">全体ランキングを読み込み中...</p> : null}
            {globalRankQuery.isError ? <p className="text-[11px] text-rose-300">全体ランキングの取得に失敗しました</p> : null}
            {globalRankProposalQuery.isLoading ? (
              <p className="text-[11px] text-white/60">スコア根拠を読み込み中...</p>
            ) : null}
            {!globalRankQuery.isLoading && globalRankItems.length === 0 ? (
              <p className="text-[11px] text-white/60">全体ランキングはまだ作成されていません</p>
            ) : null}
            <div className="space-y-2">
              {globalRankItems.map((item, index) => (
                <button
                  key={`global-rank-${item.fseiban}`}
                  type="button"
                  className="w-full rounded border border-white/20 bg-slate-800/60 p-2 text-left text-white hover:bg-slate-700/60"
                  onClick={() => setSelectedFseiban(item.fseiban)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold">
                      {index + 1}. <span className="font-mono">{item.fseiban}</span>
                    </div>
                    <div className="flex gap-1">
                      {item.isInTodayTriage ? (
                        <span className="rounded bg-blue-500/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-100">
                          今日対象
                        </span>
                      ) : item.isOutOfToday ? (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">
                          対象外
                        </span>
                      ) : null}
                      {item.isCarryover ? (
                        <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">
                          引継ぎ
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-[10px] text-white/75">
                    {normalizeMachineName(item.summary?.machineName ?? item.triage?.machineName ?? null) || '-'}
                  </div>
                  <div className="text-[10px] text-white/75">
                    納期: {formatDueDate(item.summary?.dueDate ?? item.triage?.dueDate ?? null)}
                  </div>
                  <div className="mt-1 text-[10px] text-blue-100/90">
                    score: {proposalBySeiban.get(item.fseiban)?.score.toFixed(3) ?? '-'}
                  </div>
                  <div className="text-[10px] text-blue-100/90">
                    実績カバー率: {Math.round((proposalBySeiban.get(item.fseiban)?.coverageRatio ?? 0) * 100)}%
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(proposalBySeiban.get(item.fseiban)?.reasons ?? []).map((reason) => (
                      <span key={`${item.fseiban}-${reason}`} className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-100">
                        {reason}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3 rounded border border-white/20 bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">今日の計画順（子：全体ランキングから切り出し）</h3>
              <button
                type="button"
                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                onClick={() => void saveDailyPlan()}
                disabled={updateDailyPlanMutation.isPending || orderedPlanItems.length === 0 || !isDailyPlanDirty}
              >
                {updateDailyPlanMutation.isPending ? '保存中...' : '順序を保存'}
              </button>
            </div>
            <p className="mb-2 text-[10px] text-white/60">
              今日対象として選んだ製番を、当日の事情で前後させる実行順です。
            </p>
            {dailyPlanQuery.isLoading ? <p className="text-[11px] text-white/70">計画順を読み込み中...</p> : null}
            {!dailyPlanQuery.isLoading && orderedPlanItems.length === 0 ? (
              <p className="text-[11px] text-white/60">トリアージで製番を選択すると計画順を編集できます</p>
            ) : null}
            <div className="space-y-2">
              {orderedPlanItems.map((item, index) => (
                <div key={item.fseiban} className="rounded border border-white/20 bg-slate-800/70 p-2 text-white">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" className="text-left" onClick={() => setSelectedFseiban(item.fseiban)}>
                      <div className="text-xs font-semibold">
                        {index + 1}. <span className="font-mono">{item.fseiban}</span>
                        {item.meta.isCarryover ? (
                          <span className="ml-2 rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">
                            引継ぎ
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-white/75">
                        {normalizeMachineName(item.summary?.machineName ?? item.triage?.machineName ?? null) || '-'}
                      </div>
                      <div className="text-[10px] text-white/75">
                        納期: {formatDueDate(item.summary?.dueDate ?? item.triage?.dueDate ?? null)}
                      </div>
                    </button>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded bg-slate-700 px-2 py-1 text-[10px] hover:bg-slate-600 disabled:opacity-50"
                        onClick={() => moveDailyPlanItem(index, -1)}
                        disabled={index === 0}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded bg-slate-700 px-2 py-1 text-[10px] hover:bg-slate-600 disabled:opacity-50"
                        onClick={() => moveDailyPlanItem(index, 1)}
                        disabled={index === orderedPlanItems.length - 1}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

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
              onClick={openKeyboard}
              className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
              aria-label="キーボードを開く"
            >
              ⌨
            </button>
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
              const isActive = selectedFseiban === fseiban;
              return (
                <button
                  key={fseiban}
                  type="button"
                  onClick={() => setSelectedFseiban(fseiban)}
                  className={`relative flex h-8 items-center rounded-full border px-3 pr-7 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'border-emerald-300 bg-emerald-400 text-slate-900'
                      : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <span className="font-mono">{fseiban}</span>
                  <button
                    type="button"
                    className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-slate-900 ${
                      isActive ? 'bg-slate-200' : 'bg-white'
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeFromHistory(fseiban);
                    }}
                    aria-label={`履歴から削除: ${fseiban}`}
                  >
                    ×
                  </button>
                </button>
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
                  <span className="ml-2 text-xs font-normal text-white/70">
                    {normalizeMachineName(item.machineName) || '-'}
                  </span>
                </span>
                <span className="text-xs text-white/70">{formatDueDate(item.dueDate)}</span>
              </div>
              <div className="mt-1 text-xs text-white/70">
                部品 {item.partsCount}件 / 工程 {item.processCount}件 / 所要 {Math.round(item.totalRequiredMinutes)} min
              </div>
              <div className="mt-1 text-[11px] text-sky-200/90">
                実績カバー率 {Math.round(item.actualCoverageRatio * 100)}%
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
              <span className="ml-2">{normalizeMachineName(detailQuery.data?.machineName) || '-'}</span>
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
                  <th className="px-2 py-2">製造order番号</th>
                  <th className="px-2 py-2">品名</th>
                  <th className="px-2 py-2">処理</th>
                  <th className="px-2 py-2">工程数</th>
                  <th className="px-2 py-2">工程進捗</th>
                  <th className="px-2 py-2">所要(min)</th>
                  <th className="px-2 py-2">実績基準時間(分/個)</th>
                  <th className="px-2 py-2">備考</th>
                  <th className="px-2 py-2">提案順位</th>
                  <th className="px-2 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {orderedParts.map((part, index) => (
                  <tr key={part?.fhincd ?? index} className="border-b border-white/10">
                    <td className="px-2 py-2">{index + 1}</td>
                    <td className="px-2 py-2 font-mono">{part?.fhincd}</td>
                    <td className="px-2 py-2 font-mono">{part?.productNo || '-'}</td>
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
                        {(part?.processes ?? []).map((process) => {
                          const resourceNames = process.resourceNames ?? [];
                          const tooltip = resourceNames.length > 0 ? resourceNames.join('\n') : undefined;
                          const ariaLabel =
                            resourceNames.length > 0
                              ? `${process.resourceCd}: ${resourceNames.join(' / ')}`
                              : process.resourceCd;
                          return (
                            <span
                              key={process.rowId}
                              className={`rounded border px-2 py-1 text-[10px] ${
                                process.isCompleted
                                  ? 'border-slate-400 bg-white/10 text-white/70 opacity-50 grayscale'
                                  : 'border-blue-300 bg-blue-500/30 text-blue-100'
                              }`}
                              title={tooltip}
                              aria-label={ariaLabel}
                            >
                              {process.resourceCd}
                              {process.processOrder !== null ? `-${process.processOrder}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-2 py-2">{Math.round(part?.totalRequiredMinutes ?? 0)}</td>
                    <td className="px-2 py-2">
                      {typeof part?.actualPerPieceMinutes === 'number' ? part.actualPerPieceMinutes.toFixed(2) : '-'}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => openPartNoteModal(part?.fhincd ?? '', part?.note ?? null)}
                        className="max-w-[180px] truncate rounded bg-white/10 px-2 py-1 text-left text-[11px] text-white/90 hover:bg-white/20"
                        disabled={updatePartNoteMutation.isPending}
                        title={part?.note ?? ''}
                      >
                        {part?.note?.trim() ? part.note : '編集'}
                      </button>
                    </td>
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
      <KioskKeyboardModal
        isOpen={isKeyboardOpen}
        value={keyboardValue}
        onChange={setKeyboardValue}
        onCancel={() => setIsKeyboardOpen(false)}
        onConfirm={confirmKeyboard}
      />
      <KioskNoteModal
        isOpen={isNoteModalOpen}
        value={editingNotePart?.note ?? ''}
        maxLength={NOTE_MAX_LENGTH}
        onCancel={closePartNoteModal}
        onCommit={commitPartNote}
      />
    </div>
  );
}
