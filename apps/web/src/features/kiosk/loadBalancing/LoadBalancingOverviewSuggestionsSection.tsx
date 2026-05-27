import type { ProductionScheduleLoadBalancingSuggestionItem } from '../../../api/client';

type Props = {
  suggestions: ProductionScheduleLoadBalancingSuggestionItem[];
  error: unknown;
};

export function LoadBalancingOverviewSuggestionsSection({ suggestions, error }: Props) {
  return (
    <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-white">社内移管サジェスト（工程行）</p>
        {error ? (
          <span className="text-[11px] text-rose-200">
            {error instanceof Error ? error.message : 'エラー'}
          </span>
        ) : null}
      </div>
      {suggestions.length === 0 ? (
        <p className="text-xs text-white/60">
          ステップ2の「社内移管サジェスト」を押すと候補が表示されます（超過資源・分類・移管ルール・移管先余力に依存）。
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full border-collapse text-left text-[11px] text-white/90">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1">製番</th>
                <th className="px-2 py-1">注文</th>
                <th className="px-2 py-1">品番</th>
                <th className="px-2 py-1">から→へ</th>
                <th className="px-2 py-1">行分</th>
                <th className="px-2 py-1">移管後超過(元)</th>
                <th className="px-2 py-1">移管後超過(先)</th>
                <th className="px-2 py-1">ルール</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((suggestion) => (
                <tr key={suggestion.rowId} className="border-b border-white/5">
                  <td className="px-2 py-1 font-mono">{suggestion.fseiban}</td>
                  <td className="px-2 py-1 font-mono">{suggestion.productNo}</td>
                  <td className="px-2 py-1 font-mono">{suggestion.fhincd}</td>
                  <td className="px-2 py-1 font-mono">
                    {suggestion.resourceCdFrom}→{suggestion.resourceCdTo}
                  </td>
                  <td className="px-2 py-1">{Math.round(suggestion.rowMinutes)}</td>
                  <td className="px-2 py-1">{Math.round(suggestion.simulatedSourceOverAfter)}</td>
                  <td className="px-2 py-1">{Math.round(suggestion.simulatedDestinationOverAfter)}</td>
                  <td className="px-2 py-1 text-[10px] text-white/70">
                    {suggestion.fromClassCode}→{suggestion.toClassCode} / pri{suggestion.rulePriority} / eff
                    {suggestion.efficiencyRatio}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
