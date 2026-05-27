import { lbBtn, lbCard, lbTable, lbText } from './loadBalancingUiClasses';

import type {
  ProductionScheduleLoadBalancingOutsourcingCandidatesResponse,
  ProductionScheduleLoadBalancingOutsourcingSimulateResponse
} from '../../../api/client';

type Props = {
  overviewEnabled: boolean;
  selectedOverResourceCount: number;
  selectedCandidateRowIds: string[];
  candidateResult: ProductionScheduleLoadBalancingOutsourcingCandidatesResponse | null;
  simulateResult: ProductionScheduleLoadBalancingOutsourcingSimulateResponse | null;
  candidatesPending: boolean;
  simulatePending: boolean;
  candidatesError: unknown;
  simulateError: unknown;
  onLoadCandidates: () => void;
  onSimulate: () => void;
  onClearSimulate: () => void;
  onToggleRow: (rowId: string) => void;
};

export function LoadBalancingOverviewLegacyOutsourcingSection({
  overviewEnabled,
  selectedOverResourceCount,
  selectedCandidateRowIds,
  candidateResult,
  simulateResult,
  candidatesPending,
  simulatePending,
  candidatesError,
  simulateError,
  onLoadCandidates,
  onSimulate,
  onClearSimulate,
  onToggleRow
}: Props) {
  return (
    <section className={lbCard.amber}>
      <details className="group">
        <summary className={`cursor-pointer ${lbText.section} text-amber-100`}>
          ▶ 工程行単位の外注候補（従来・折りたたみ）
        </summary>
        <div className="mb-2 mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${lbBtn.base} ${lbBtn.amber}`}
            disabled={!overviewEnabled || candidatesPending || selectedOverResourceCount === 0}
            onClick={onLoadCandidates}
          >
            {candidatesPending ? '候補取得中…' : '外注候補を取得'}
          </button>
          <button
            type="button"
            className={`${lbBtn.base} rounded-lg bg-amber-700 px-3.5 py-2 text-sm`}
            disabled={
              !overviewEnabled ||
              simulatePending ||
              selectedOverResourceCount === 0 ||
              selectedCandidateRowIds.length === 0 ||
              candidateResult == null
            }
            onClick={onSimulate}
          >
            {simulatePending ? 'シミュレーション中…' : '選択行で累積シミュ'}
          </button>
          {simulateResult ? (
            <button type="button" className={`${lbBtn.base} ${lbBtn.slate}`} onClick={onClearSimulate}>
              シミュ結果をクリア
            </button>
          ) : null}
        </div>
        {candidatesError ? (
          <p className={`mb-2 ${lbText.error}`}>
            {candidatesError instanceof Error ? candidatesError.message : String(candidatesError)}
          </p>
        ) : null}
        {simulateError ? (
          <p className={`mb-2 ${lbText.error}`}>
            {simulateError instanceof Error ? simulateError.message : String(simulateError)}
          </p>
        ) : null}
        {(candidateResult?.candidates ?? []).length === 0 ? (
          <p className={lbText.muted}>
            超過資源を選び「外注候補を取得」を押してください。候補は超過改善効果の大きい順です（DBは更新しません）。
          </p>
        ) : (
          <div className="max-h-[min(360px,42dvh)] overflow-auto">
            <table className={lbTable.root}>
              <thead className={lbTable.stickyHead}>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>選択</th>
                  <th className={lbTable.headCell}>効果</th>
                  <th className={lbTable.headCell}>製番</th>
                  <th className={lbTable.headCell}>注文</th>
                  <th className={lbTable.headCell}>品番</th>
                  <th className={lbTable.headCell}>資源CD</th>
                  <th className={lbTable.headCell}>行分</th>
                </tr>
              </thead>
              <tbody>
                {(candidateResult?.candidates ?? []).map((candidate) => (
                  <tr key={candidate.rowId} className={lbTable.bodyRow}>
                    <td className={lbTable.bodyCell}>
                      <input
                        type="checkbox"
                        checked={selectedCandidateRowIds.includes(candidate.rowId)}
                        aria-label={`${candidate.fseiban} ${candidate.fhincd} を外注候補に選択`}
                        onChange={() => onToggleRow(candidate.rowId)}
                      />
                    </td>
                    <td className={lbTable.bodyCell}>{Math.round(candidate.overReductionMinutes)}</td>
                    <td className={`${lbTable.bodyCell} font-mono`}>{candidate.fseiban}</td>
                    <td className={`${lbTable.bodyCell} font-mono`}>{candidate.productNo}</td>
                    <td className={`${lbTable.bodyCell} font-mono`}>{candidate.fhincd}</td>
                    <td className={`${lbTable.bodyCell} font-mono`}>{candidate.resourceCd}</td>
                    <td className={lbTable.bodyCell}>{Math.round(candidate.rowMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {simulateResult ? (
          <div className={`mt-3 ${lbCard.inset} ${lbText.body}`}>
            <p>
              選択 {simulateResult.summary.selectedCount} 件 / 適用 {simulateResult.summary.appliedCount} 件 /
              スキップ {simulateResult.summary.skippedCount} 件
            </p>
            <p>
              社内負荷削減合計 {Math.round(simulateResult.summary.totalReducedMinutes)} 分 / 残超過{' '}
              {Math.round(simulateResult.summary.remainingOverMinutes)} 分
            </p>
          </div>
        ) : null}
      </details>
    </section>
  );
}
