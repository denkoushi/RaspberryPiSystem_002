import { formatDueDate } from '../../../features/kiosk/productionSchedule/formatDueDate';
import { normalizeMachineName } from '../../../features/kiosk/productionSchedule/machineName';

import { CollapsibleCard } from './CollapsibleCard';
import { CollapsibleSection } from './CollapsibleSection';

import type {
  ProductionScheduleDueManagementTriageItem,
} from '../../../api/client';
import type {
  GlobalRankFilter,
  GlobalRankItem,
  OrderedPlanItem,
  ProposalItemMeta,
  TriageZoneCounts
} from '../../../features/kiosk/productionSchedule/dueManagementViewModel';

type DueManagementLeftRailProps = {
  selectedFseiban: string | null;
  triageLoading: boolean;
  triageError: boolean;
  triageZoneCounts: TriageZoneCounts;
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
  globalRankProposalLoading: boolean;
  globalRankFilter: GlobalRankFilter;
  onGlobalRankFilterChange: (filter: GlobalRankFilter) => void;
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
    registration: boolean;
    globalRank: boolean;
    dailyPlan: boolean;
  };
  onToggleSection: (section: 'registration' | 'globalRank' | 'dailyPlan') => void;
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
          title="製番登録・納期前提"
          isOpen={props.sectionOpen.registration}
          onToggle={() => props.onToggleSection('registration')}
        >
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
              登録
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
          <div className="rounded border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-white/80">
            <div className="flex flex-wrap gap-2">
              <span>対象候補: {props.triageZoneCounts.total}</span>
              <span>選択済み: {props.triageZoneCounts.selected}</span>
              <span>危険: {props.triageZoneCounts.danger}</span>
              <span>注意: {props.triageZoneCounts.caution}</span>
              <span>余裕: {props.triageZoneCounts.safe}</span>
            </div>
            <p className="mt-1 text-[10px] text-white/60">
              登録製番にCSV実績が揃うと候補に現れ、全体ランキング生成に取り込まれます。
            </p>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="全体ランキング（主作業）"
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
              {props.autoGeneratePending ? '再生成中...' : '生成/再生成して保存'}
            </button>
            </>
          }
        >
          <p className="mb-2 text-[10px] text-white/60">
            納期設定後に全体順位を生成し、必要箇所を微調整します。今日の計画順はこの順位を起点に反映します。
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            <button
              type="button"
              className={`rounded px-2 py-1 text-[10px] ${
                props.globalRankFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              onClick={() => props.onGlobalRankFilterChange('all')}
            >
              全件
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 text-[10px] ${
                props.globalRankFilter === 'todayOnly' ? 'bg-blue-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              onClick={() => props.onGlobalRankFilterChange('todayOnly')}
            >
              今日対象
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 text-[10px] ${
                props.globalRankFilter === 'urgentOnly' ? 'bg-blue-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              onClick={() => props.onGlobalRankFilterChange('urgentOnly')}
            >
              危険/注意
            </button>
          </div>
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
          {props.globalRankProposalLoading ? <p className="text-[11px] text-white/60">スコア根拠を読み込み中...</p> : null}
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
                    <div className="flex items-center gap-1">
                      {item.isInTodayTriage ? (
                        <span className="rounded bg-blue-500/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-100">今日対象</span>
                      ) : item.isOutOfToday ? (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">対象外</span>
                      ) : null}
                      {item.isCarryover ? (
                        <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">引継ぎ</span>
                      ) : null}
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
                        {props.selectedSet.has(item.fseiban) ? '対象中' : '対象化'}
                      </button>
                    </div>
                  }
                >
                  <div className="mt-1 text-[10px] text-blue-100/90">
                    score: {props.proposalBySeiban.get(item.fseiban)?.score.toFixed(3) ?? '-'}
                  </div>
                  <div className="text-[10px] text-blue-100/90">
                    実績カバー率: {Math.round((props.proposalBySeiban.get(item.fseiban)?.coverageRatio ?? 0) * 100)}%
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(props.proposalBySeiban.get(item.fseiban)?.reasons ?? []).map((reason) => (
                      <span key={`${item.fseiban}-${reason}`} className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-100">
                        {reason}
                      </span>
                    ))}
                  </div>
                </CollapsibleCard>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="当日計画への反映（補助）"
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
          <p className="mb-2 text-[10px] text-white/60">全体ランキングから当日対象を切り出し、現場事情で順番を微調整して保存します。</p>
          <div className="mb-3 rounded border border-white/15 bg-white/5 p-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-white">今日対象候補（トリアージ属性）</p>
              <button
                type="button"
                className="rounded bg-slate-700 px-2 py-1 text-[10px] text-white hover:bg-slate-600"
                onClick={props.onToggleShowSelectedOnly}
              >
                {props.showSelectedOnly ? '全件表示' : '選択済みのみ'}
              </button>
            </div>
            {props.triageLoading ? <p className="text-[11px] text-white/70">候補を読み込み中...</p> : null}
            {props.triageError ? <p className="text-[11px] text-rose-300">候補取得に失敗しました</p> : null}
            {!props.triageLoading && props.filteredTriageCandidates.length === 0 ? (
              <p className="text-[11px] text-white/60">候補はありません（製番登録後にCSV反映を確認してください）</p>
            ) : null}
            <div className="space-y-1">
              {props.filteredTriageCandidates.map((item) => {
                const zoneLabel = item.zone === 'danger' ? '危険' : item.zone === 'caution' ? '注意' : '余裕';
                return (
                  <div key={`daily-candidate-${item.fseiban}`} className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => props.onSelectFseiban(item.fseiban)}
                    >
                      <span className="text-[11px] font-semibold text-white">{zoneLabel} / {item.fseiban}</span>
                      <span className="ml-2 text-[10px] text-white/70">納期: {formatDueDate(item.dueDate)}</span>
                    </button>
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
                  </div>
                );
              })}
            </div>
          </div>
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
      </div>
    </>
  );
}
