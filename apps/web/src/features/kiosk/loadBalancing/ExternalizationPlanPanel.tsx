import { parsePartCandidateId } from './loadBalancingExternalization';
import { formatPositiveReductionMinutes } from './loadBalancingOverviewDisplay';
import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';
import { lbBtn, lbCard, lbTable, lbText } from './loadBalancingUiClasses';

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
  /** 左列にグラフ+試算表を置き、右ペインの表スクロールを広げる */
  workspaceLayout?: boolean;
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
  embedded = false,
  workspaceLayout = false
}: Props) {
  const planTableScrollClass = workspaceLayout
    ? 'max-h-[min(520px,58dvh)] overflow-auto'
    : 'max-h-[min(220px,30dvh)] overflow-auto';

  return (
    <section
      className={
        embedded
          ? `${lbCard.emerald} ${workspaceLayout ? 'min-h-0 xl:min-h-[min(640px,72dvh)]' : ''}`
          : `mt-3 ${lbCard.emerald}`
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <LoadBalancingStepHeading step={3} className="mb-0">
          推奨セットで山を崩す
        </LoadBalancingStepHeading>
        <button
          type="button"
          className={`${lbBtn.base} ${lbBtn.green} ml-auto`}
          disabled={!enabled || !hasSelectedOverResources || isPlanning || isSimulating}
          onClick={() => void onAutoPlan()}
        >
          {isPlanning ? '選定中…' : '推奨セットを自動選定'}
        </button>
        {selectedCandidateIds.length > 0 ? (
          <button type="button" className={`${lbBtn.base} ${lbBtn.slate}`} onClick={onClearPlan}>
            クリア
          </button>
        ) : null}
      </div>

      {actionError ? (
        <p className={`mb-2 ${lbText.error}`} role="alert">
          {actionError}
        </p>
      ) : null}

      {selectedCandidateIds.length === 0 ? (
        <p className={lbText.muted}>
          超過資源を選び「推奨セットを自動選定」を押してください。部品単位で社内負荷除外を試算します（DBは更新しません）。
        </p>
      ) : (
        <>
          <div className={`mb-2 flex flex-wrap gap-3 ${lbText.body}`}>
            <span>
              選択 <strong className={lbText.success}>{selectedCandidateIds.length} 部品</strong>
            </span>
            {planResolved === true ? (
              <span className={lbText.success}>超過解消見込み</span>
            ) : planResolved === false ? (
              <span className={lbText.warning}>未解消</span>
            ) : (
              <span>試算中</span>
            )}
            {planRemainingOverMinutes != null ? (
              <span>
                残超過 <strong className="text-white">{Math.round(planRemainingOverMinutes)} 分</strong>
              </span>
            ) : null}
          </div>
          <div className={planTableScrollClass}>
            <table className={lbTable.root}>
              <thead className={lbTable.stickyHead}>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>製番</th>
                  <th className={lbTable.headCell}>製造番号</th>
                  <th className={lbTable.headCell}>品番</th>
                  <th className={lbTable.headCell}>品名</th>
                  <th className={lbTable.headCell}>効果</th>
                  <th className={lbTable.headCell}>工程数</th>
                  <th className={lbTable.headCell}>操作</th>
                </tr>
              </thead>
              <tbody>
                {selectedCandidateIds.map((candidateId) => {
                  const candidate = candidateById.get(candidateId);
                  const parsed = parsePartCandidateId(candidateId);
                  return (
                    <tr key={candidateId} className={lbTable.bodyRow}>
                      <td className={`${lbTable.bodyCell} font-mono`}>
                        {candidate?.fseiban ?? parsed.fseiban}
                      </td>
                      <td className={`${lbTable.bodyCell} font-mono`}>
                        {candidate?.productNo ?? parsed.productNo}
                      </td>
                      <td className={`${lbTable.bodyCell} font-mono`}>{candidate?.fhincd ?? parsed.fhincd}</td>
                      <td className={lbTable.bodyCell}>{candidate?.fhinmei ?? '—'}</td>
                      <td className={`${lbTable.bodyCell} ${lbText.success}`}>
                        {formatPositiveReductionMinutes(candidate?.totalOverReductionMinutes ?? 0)}
                      </td>
                      <td className={lbTable.bodyCell}>{candidate?.operations.length ?? '—'}</td>
                      <td className={lbTable.bodyCell}>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className={lbBtn.roseSm}
                            onClick={() => void onRemoveCandidate(candidateId)}
                          >
                            外す
                          </button>
                          <button
                            type="button"
                            className={`${lbBtn.greenSm} disabled:opacity-40`}
                            disabled={isReplacementsLoading}
                            onClick={() => void onLoadReplacements(candidateId)}
                          >
                            入替
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
        <div className={`mt-3 ${lbCard.inset}`}>
          <p className="mb-2 text-sm font-semibold text-emerald-100">代替候補（1件追加で試算）</p>
          <ul className={`space-y-1.5 ${lbText.body}`}>
            {replacementOptions.map((option) => (
              <li key={option.candidateId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">
                  {option.fseiban} / {option.productNo} / {option.fhincd}
                </span>
                <span className="text-white/70">{option.fhinmei || '—'}</span>
                <span className={option.resolved ? lbText.success : lbText.warning}>
                  残超過 {Math.round(option.remainingOverMinutes)} 分
                </span>
                <button
                  type="button"
                  className={`${lbBtn.base} rounded-md bg-emerald-700 px-2.5 py-1.5 text-[0.8125rem]`}
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
