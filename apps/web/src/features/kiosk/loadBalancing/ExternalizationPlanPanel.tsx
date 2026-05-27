import { parsePartCandidateId } from './loadBalancingExternalization';
import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';

import type { ProductionScheduleLoadBalancingExternalizationCandidate } from '../../../api/client';

type ReplacementOption = {
  candidateId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  resolved: boolean;
  remainingOverMinutes: number;
};

type Props = {
  enabled: boolean;
  hasSelectedOverResources: boolean;
  selectedCandidateIds: string[];
  planResolved: boolean | null;
  planRemainingOverMinutes: number | null;
  candidateById: Map<string, ProductionScheduleLoadBalancingExternalizationCandidate>;
  replacementTargetId: string | null;
  replacementOptions: ReplacementOption[];
  isPlanning: boolean;
  isSimulating: boolean;
  isReplacementsLoading: boolean;
  actionError: string | null;
  onAutoPlan: () => void;
  onRemoveCandidate: (candidateId: string) => void;
  onLoadReplacements: (candidateId: string) => void;
  onApplyReplacement: (candidateId: string) => void;
  onClearPlan: () => void;
  embedded?: boolean;
};

export function ExternalizationPlanPanel({
  enabled,
  hasSelectedOverResources,
  selectedCandidateIds,
  planResolved,
  planRemainingOverMinutes,
  candidateById,
  replacementTargetId,
  replacementOptions,
  isPlanning,
  isSimulating,
  isReplacementsLoading,
  actionError,
  onAutoPlan,
  onRemoveCandidate,
  onLoadReplacements,
  onApplyReplacement,
  onClearPlan,
  embedded = false
}: Props) {
  return (
    <section
      className={
        embedded
          ? 'h-full rounded-lg border border-emerald-500/35 bg-emerald-950/20 p-2'
          : 'mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2'
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <LoadBalancingStepHeading step={3}>推奨セットで山を崩す</LoadBalancingStepHeading>
        <button
          type="button"
          className="ml-auto rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          disabled={!enabled || !hasSelectedOverResources || isPlanning || isSimulating}
          onClick={() => void onAutoPlan()}
        >
          {isPlanning ? '選定中…' : '推奨セットを自動選定'}
        </button>
        {selectedCandidateIds.length > 0 ? (
          <button
            type="button"
            className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white"
            onClick={onClearPlan}
          >
            クリア
          </button>
        ) : null}
      </div>

      {actionError ? (
        <p className="mb-2 text-xs text-rose-200" role="alert">
          {actionError}
        </p>
      ) : null}

      {selectedCandidateIds.length === 0 ? (
        <p className="text-xs text-white/60">
          超過資源を選び「推奨セットを自動選定」を押してください。部品単位で社内負荷除外を試算します（DBは更新しません）。
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-white/80">
            <span>
              選択 <strong className="text-emerald-300">{selectedCandidateIds.length} 部品</strong>
            </span>
            {planResolved === true ? (
              <span className="font-semibold text-emerald-300">超過解消見込み</span>
            ) : planResolved === false ? (
              <span className="font-semibold text-amber-300">未解消</span>
            ) : (
              <span>試算中</span>
            )}
            {planRemainingOverMinutes != null ? (
              <span>
                残超過 <strong className="text-white">{Math.round(planRemainingOverMinutes)} 分</strong>
              </span>
            ) : null}
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">製造番号</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">品名</th>
                  <th className="px-2 py-1">効果</th>
                  <th className="px-2 py-1">工程数</th>
                  <th className="px-2 py-1">操作</th>
                </tr>
              </thead>
              <tbody>
                {selectedCandidateIds.map((candidateId) => {
                  const candidate = candidateById.get(candidateId);
                  const parsed = parsePartCandidateId(candidateId);
                  return (
                    <tr key={candidateId} className="border-b border-white/5">
                      <td className="px-2 py-1 font-mono">{candidate?.fseiban ?? parsed.fseiban}</td>
                      <td className="px-2 py-1 font-mono">{candidate?.productNo ?? parsed.productNo}</td>
                      <td className="px-2 py-1 font-mono">{candidate?.fhincd ?? parsed.fhincd}</td>
                      <td className="px-2 py-1">{candidate?.fhinmei ?? '—'}</td>
                      <td className="px-2 py-1 font-semibold text-emerald-300">
                        {Math.round(candidate?.totalOverReductionMinutes ?? 0)}
                      </td>
                      <td className="px-2 py-1">{candidate?.operations.length ?? '—'}</td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="rounded bg-rose-800 px-2 py-1 text-[11px] font-semibold text-white"
                            onClick={() => void onRemoveCandidate(candidateId)}
                          >
                            外す
                          </button>
                          <button
                            type="button"
                            className="rounded bg-emerald-800 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                            disabled={isReplacementsLoading}
                            onClick={() => void onLoadReplacements(candidateId)}
                          >
                            入れ替え
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {replacementTargetId && replacementOptions.length > 0 ? (
        <div className="mt-3 rounded-md border border-emerald-500/20 bg-slate-950/50 p-2">
          <p className="mb-2 text-[11px] font-semibold text-emerald-100">代替候補（1件追加で試算）</p>
          <ul className="space-y-1 text-[11px] text-white/90">
            {replacementOptions.map((option) => (
              <li key={option.candidateId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">
                  {option.fseiban} / {option.productNo} / {option.fhincd}
                </span>
                <span className="text-white/70">{option.fhinmei || '—'}</span>
                <span className={option.resolved ? 'text-emerald-300' : 'text-amber-300'}>
                  残超過 {Math.round(option.remainingOverMinutes)} 分
                </span>
                <button
                  type="button"
                  className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white"
                  onClick={() => void onApplyReplacement(option.candidateId)}
                >
                  この部品に入れ替え
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
