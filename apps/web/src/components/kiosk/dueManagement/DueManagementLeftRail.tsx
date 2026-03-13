import { formatDueDate } from '../../../features/kiosk/productionSchedule/formatDueDate';
import { normalizeMachineName } from '../../../features/kiosk/productionSchedule/machineName';

import { CollapsibleCard } from './CollapsibleCard';
import { CollapsibleSection } from './CollapsibleSection';

import type {
  ProductionScheduleDueManagementSummaryItem,
  ProductionScheduleDueManagementTriageItem,
} from '../../../api/client';
import type { GlobalRankItem, OrderedPlanItem, ProposalItemMeta } from '../../../features/kiosk/productionSchedule/dueManagementViewModel';

type DueManagementLeftRailProps = {
  selectedFseiban: string | null;
  summaryLoading: boolean;
  summaryError: boolean;
  visibleSummaries: ProductionScheduleDueManagementSummaryItem[];
  triageLoading: boolean;
  triageError: boolean;
  filteredTriageCandidates: ProductionScheduleDueManagementTriageItem[];
  selectedSet: Set<string>;
  showSelectedOnly: boolean;
  onToggleShowSelectedOnly: () => void;
  onToggleTriageSelection: (fseiban: string) => void;
  triagePending: boolean;
  canSelectTargetLocation: boolean;
  targetLocation: string;
  targetLocations: readonly string[];
  onTargetLocationChange: (value: string) => void;
  autoGeneratePending: boolean;
  autoGenerateError: boolean;
  autoGenerateGuardRejectedReason: string | null;
  autoGenerateAppliedRatioPercent: number | null;
  onAutoGenerate: () => void;
  globalRankLoading: boolean;
  globalRankError: boolean;
  globalRankItems: GlobalRankItem[];
  proposalBySeiban: Map<string, ProposalItemMeta>;
  dailyPlanLoading: boolean;
  orderedPlanItems: OrderedPlanItem[];
  isDailyPlanDirty: boolean;
  dailyPlanPending: boolean;
  onSaveDailyPlan: () => void;
  onMoveDailyPlanItem: (index: number, direction: -1 | 1) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onOpenKeyboard: () => void;
  onApplySearch: () => void;
  sharedHistory: string[];
  onRemoveFromHistory: (fseiban: string) => void;
  onSelectFseiban: (fseiban: string) => void;
  sectionOpen: {
    triage: boolean;
    globalRank: boolean;
    dailyPlan: boolean;
  };
  onToggleSection: (section: 'triage' | 'globalRank' | 'dailyPlan') => void;
  triageCardOpenBySeiban: Record<string, boolean>;
  onToggleTriageCard: (fseiban: string) => void;
  globalRankCardOpenBySeiban: Record<string, boolean>;
  onToggleGlobalRankCard: (fseiban: string) => void;
  dailyPlanCardOpenBySeiban: Record<string, boolean>;
  onToggleDailyPlanCard: (fseiban: string) => void;
};

export function DueManagementLeftRail(props: DueManagementLeftRailProps) {
  return (
    <>
      <header className="border-b border-white/20 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">製番一覧（納期管理）</h2>
      </header>
      <div className="h-[calc(100%-52px)] overflow-auto px-3 py-3">
        <CollapsibleSection
          title="今日判断候補（トリアージ）"
          isOpen={props.sectionOpen.triage}
          onToggle={() => props.onToggleSection('triage')}
          actions={
            <button
              type="button"
              className="rounded bg-slate-700 px-2 py-1 text-[11px] text-white hover:bg-slate-600"
              onClick={props.onToggleShowSelectedOnly}
            >
              {props.showSelectedOnly ? '全件表示' : '選択済みのみ'}
            </button>
          }
        >
          {props.triageLoading ? <p className="text-[11px] text-white/70">候補を読み込み中...</p> : null}
          {props.triageError ? <p className="text-[11px] text-rose-300">候補取得に失敗しました</p> : null}
          {!props.triageLoading && props.filteredTriageCandidates.length === 0 ? (
            <p className="text-[11px] text-white/60">候補はありません（検索登録製番を追加してください）</p>
          ) : null}
          <div className="space-y-2">
            {props.filteredTriageCandidates.map((item) => {
              const zoneStyle =
                item.zone === 'danger'
                  ? 'border-rose-300/60 bg-rose-500/20 text-rose-100'
                  : item.zone === 'caution'
                    ? 'border-amber-300/60 bg-amber-500/20 text-amber-100'
                    : 'border-emerald-300/60 bg-emerald-500/20 text-emerald-100';
              const zoneLabel = item.zone === 'danger' ? '危険' : item.zone === 'caution' ? '注意' : '余裕';
              const isOpen = props.triageCardOpenBySeiban[item.fseiban] ?? props.selectedFseiban === item.fseiban;
              const machineName = normalizeMachineName(item.machineName) || '-';
              return (
                <CollapsibleCard
                  key={item.fseiban}
                  isOpen={isOpen}
                  onToggle={() => {
                    props.onSelectFseiban(item.fseiban);
                    props.onToggleTriageCard(item.fseiban);
                  }}
                  className={`${zoneStyle} ${props.selectedFseiban === item.fseiban ? 'ring-1 ring-white/70' : ''}`}
                  header={
                    <>
                      <div className="text-xs font-semibold">
                        {zoneLabel} / <span className="font-mono">{item.fseiban}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] opacity-90">
                        {machineName} / 納期: {formatDueDate(item.dueDate)}
                      </div>
                    </>
                  }
                  headerActions={
                    <button
                      type="button"
                      onClick={() => props.onToggleTriageSelection(item.fseiban)}
                      className={`rounded px-2 py-1 text-[10px] font-semibold ${
                        props.selectedSet.has(item.fseiban)
                          ? 'bg-blue-600 text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                      disabled={props.triagePending}
                    >
                      {props.selectedSet.has(item.fseiban) ? '選択済み' : '選択'}
                    </button>
                  }
                >
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.reasons.map((reason) => (
                      <span key={`${item.fseiban}-${reason.code}`} className="rounded bg-black/20 px-2 py-0.5 text-[10px]">
                        {reason.message}
                      </span>
                    ))}
                  </div>
                </CollapsibleCard>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="全体ランキング（親）"
          isOpen={props.sectionOpen.globalRank}
          onToggle={() => props.onToggleSection('globalRank')}
          actions={
            <>
            {props.canSelectTargetLocation ? (
              <select
                value={props.targetLocation}
                onChange={(event) => props.onTargetLocationChange(event.target.value)}
                className="h-7 rounded border border-white/30 bg-slate-800 px-2 text-[11px] text-white"
              >
                {props.targetLocations.map((location) => (
                  <option key={location} value={location}>
                    対象: {location}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              onClick={props.onAutoGenerate}
              disabled={props.autoGeneratePending}
            >
              {props.autoGeneratePending ? '自動生成中...' : '自動生成して保存'}
            </button>
            </>
          }
        >
          <p className="mb-2 text-[10px] text-white/60">
            拠点全体の継続順位です。今日の計画順（子）はこの並びを起点に作成されます。
          </p>
          {props.autoGenerateError ? (
            <p className="mb-2 text-[11px] text-rose-300">自動生成に失敗しました。再実行してください。</p>
          ) : null}
          {props.autoGenerateGuardRejectedReason ? (
            <p className="mb-2 text-[11px] text-amber-300">自動生成は安全ガードで未適用: {props.autoGenerateGuardRejectedReason}</p>
          ) : null}
          {props.autoGenerateAppliedRatioPercent !== null ? (
            <p className="mb-2 text-[11px] text-emerald-300">自動生成を保存しました（差分率 {props.autoGenerateAppliedRatioPercent}%）</p>
          ) : null}
          {props.globalRankLoading ? <p className="text-[11px] text-white/70">全体ランキングを読み込み中...</p> : null}
          {props.globalRankError ? <p className="text-[11px] text-rose-300">全体ランキングの取得に失敗しました</p> : null}
          {!props.globalRankLoading && props.globalRankItems.length === 0 ? (
            <p className="text-[11px] text-white/60">全体ランキングはまだ作成されていません</p>
          ) : null}
          <div className="space-y-2">
            {props.globalRankItems.map((item, index) => {
              const isOpen = props.globalRankCardOpenBySeiban[item.fseiban] ?? props.selectedFseiban === item.fseiban;
              const machineName = normalizeMachineName(item.summary?.machineName ?? item.triage?.machineName ?? null) || '-';
              return (
                <CollapsibleCard
                  key={`global-rank-${item.fseiban}`}
                  isOpen={isOpen}
                  onToggle={() => {
                    props.onSelectFseiban(item.fseiban);
                    props.onToggleGlobalRankCard(item.fseiban);
                  }}
                  className={`text-white hover:bg-slate-700/60 ${
                    props.selectedFseiban === item.fseiban ? 'border-cyan-300 bg-cyan-500/10' : 'border-white/20 bg-slate-800/60'
                  }`}
                  header={
                    <>
                      <div className="text-xs font-semibold">
                        {index + 1}. <span className="font-mono">{item.fseiban}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/75">
                        {machineName} / 納期: {formatDueDate(item.summary?.dueDate ?? item.triage?.dueDate ?? null)}
                      </div>
                    </>
                  }
                  headerActions={
                    <div className="flex gap-1">
                      {item.isInTodayTriage ? (
                        <span className="rounded bg-blue-500/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-100">今日対象</span>
                      ) : item.isOutOfToday ? (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">対象外</span>
                      ) : null}
                      {item.isCarryover ? (
                        <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">引継ぎ</span>
                      ) : null}
                    </div>
                  }
                >
                  <div className="mt-1 text-[10px] text-blue-100/90">
                    score: {props.proposalBySeiban.get(item.fseiban)?.score.toFixed(3) ?? '-'}
                  </div>
                  <div className="text-[10px] text-blue-100/90">
                    実績カバー率: {Math.round((props.proposalBySeiban.get(item.fseiban)?.coverageRatio ?? 0) * 100)}%
                  </div>
                </CollapsibleCard>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="今日の計画順（子：全体ランキングから切り出し）"
          isOpen={props.sectionOpen.dailyPlan}
          onToggle={() => props.onToggleSection('dailyPlan')}
          actions={
            <button
              type="button"
              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              onClick={props.onSaveDailyPlan}
              disabled={props.dailyPlanPending || props.orderedPlanItems.length === 0 || !props.isDailyPlanDirty}
            >
              {props.dailyPlanPending ? '保存中...' : '順序を保存'}
            </button>
          }
        >
          <p className="mb-2 text-[10px] text-white/60">今日対象として選んだ製番を、当日の事情で前後させる実行順です。</p>
          {props.dailyPlanLoading ? <p className="text-[11px] text-white/70">計画順を読み込み中...</p> : null}
          {!props.dailyPlanLoading && props.orderedPlanItems.length === 0 ? (
            <p className="text-[11px] text-white/60">トリアージで製番を選択すると計画順を編集できます</p>
          ) : null}
          <div className="space-y-2">
            {props.orderedPlanItems.map((item, index) => {
              const isOpen = props.dailyPlanCardOpenBySeiban[item.fseiban] ?? props.selectedFseiban === item.fseiban;
              const machineName = normalizeMachineName(item.summary?.machineName ?? item.triage?.machineName ?? null) || '-';
              return (
                <CollapsibleCard
                  key={item.fseiban}
                  isOpen={isOpen}
                  onToggle={() => {
                    props.onSelectFseiban(item.fseiban);
                    props.onToggleDailyPlanCard(item.fseiban);
                  }}
                  className="border-white/20 bg-slate-800/70 text-white"
                  header={
                    <>
                      <div className="text-xs font-semibold">
                        {index + 1}. <span className="font-mono">{item.fseiban}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/75">
                        {machineName} / 納期: {formatDueDate(item.summary?.dueDate ?? item.triage?.dueDate ?? null)}
                      </div>
                    </>
                  }
                  headerActions={
                    item.meta.isCarryover ? (
                      <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">引継ぎ</span>
                    ) : null
                  }
                >
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      className="rounded bg-slate-700 px-2 py-1 text-[10px] hover:bg-slate-600 disabled:opacity-50"
                      onClick={() => props.onMoveDailyPlanItem(index, -1)}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded bg-slate-700 px-2 py-1 text-[10px] hover:bg-slate-600 disabled:opacity-50"
                      onClick={() => props.onMoveDailyPlanItem(index, 1)}
                      disabled={index === props.orderedPlanItems.length - 1}
                    >
                      ↓
                    </button>
                  </div>
                </CollapsibleCard>
              );
            })}
          </div>
        </CollapsibleSection>

        <div className="mb-3 flex gap-2">
          <input
            value={props.searchInput}
            onChange={(event) => props.onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                props.onApplySearch();
              }
            }}
            placeholder="製番を検索"
            className="h-9 flex-1 rounded border border-white/20 bg-white px-2 text-xs text-slate-900"
          />
          <button
            type="button"
            onClick={props.onOpenKeyboard}
            className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
            aria-label="キーボードを開く"
          >
            ⌨
          </button>
          <button
            type="button"
            onClick={props.onApplySearch}
            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
          >
            検索
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {props.sharedHistory.map((fseiban) => {
            const isActive = props.selectedFseiban === fseiban;
            return (
              <button
                key={fseiban}
                type="button"
                onClick={() => props.onSelectFseiban(fseiban)}
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
                    props.onRemoveFromHistory(fseiban);
                  }}
                  aria-label={`履歴から削除: ${fseiban}`}
                >
                  ×
                </button>
              </button>
            );
          })}
        </div>
        {props.summaryLoading ? <p className="px-4 py-3 text-sm text-white/80">読み込み中...</p> : null}
        {props.summaryError ? <p className="px-4 py-3 text-sm text-rose-300">取得に失敗しました。</p> : null}
        {props.visibleSummaries.map((item) => (
          <button
            key={item.fseiban}
            type="button"
            onClick={() => props.onSelectFseiban(item.fseiban)}
            className={`w-full border-b border-white/10 px-4 py-3 text-left hover:bg-white/10 ${
              props.selectedFseiban === item.fseiban ? 'bg-blue-600/30' : ''
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
            <div className="mt-1 text-[11px] text-sky-200/90">実績カバー率 {Math.round(item.actualCoverageRatio * 100)}%</div>
          </button>
        ))}
      </div>
    </>
  );
}
