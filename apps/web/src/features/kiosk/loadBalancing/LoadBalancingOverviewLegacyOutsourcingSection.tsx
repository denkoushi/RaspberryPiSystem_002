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
    <section className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
      <details className="group">
        <summary className="cursor-pointer text-xs font-semibold text-amber-100">
          工程行単位の外注候補（従来・折りたたみ）
        </summary>
        <div className="mb-2 mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!overviewEnabled || candidatesPending || selectedOverResourceCount === 0}
            onClick={onLoadCandidates}
          >
            {candidatesPending ? '候補取得中…' : '外注候補を取得'}
          </button>
          <button
            type="button"
            className="rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
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
            <button
              type="button"
              className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white"
              onClick={onClearSimulate}
            >
              シミュ結果をクリア
            </button>
          ) : null}
        </div>
        {candidatesError ? (
          <p className="mb-2 text-xs text-rose-200">
            {candidatesError instanceof Error ? candidatesError.message : String(candidatesError)}
          </p>
        ) : null}
        {simulateError ? (
          <p className="mb-2 text-xs text-rose-200">
            {simulateError instanceof Error ? simulateError.message : String(simulateError)}
          </p>
        ) : null}
        {(candidateResult?.candidates ?? []).length === 0 ? (
          <p className="text-xs text-white/60">
            超過資源を選び「外注候補を取得」を押してください。候補は超過改善効果の大きい順です（DBは更新しません）。
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">選択</th>
                  <th className="px-2 py-1">効果</th>
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">注文</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">資源CD</th>
                  <th className="px-2 py-1">行分</th>
                </tr>
              </thead>
              <tbody>
                {(candidateResult?.candidates ?? []).map((candidate) => (
                  <tr key={candidate.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selectedCandidateRowIds.includes(candidate.rowId)}
                        aria-label={`${candidate.fseiban} ${candidate.fhincd} を外注候補に選択`}
                        onChange={() => onToggleRow(candidate.rowId)}
                      />
                    </td>
                    <td className="px-2 py-1">{Math.round(candidate.overReductionMinutes)}</td>
                    <td className="px-2 py-1 font-mono">{candidate.fseiban}</td>
                    <td className="px-2 py-1 font-mono">{candidate.productNo}</td>
                    <td className="px-2 py-1 font-mono">{candidate.fhincd}</td>
                    <td className="px-2 py-1 font-mono">{candidate.resourceCd}</td>
                    <td className="px-2 py-1">{Math.round(candidate.rowMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {simulateResult ? (
          <div className="mt-3 rounded-md border border-amber-500/20 bg-slate-950/40 p-2 text-[11px] text-white/80">
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
