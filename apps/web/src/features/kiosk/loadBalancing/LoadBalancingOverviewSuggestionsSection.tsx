import { lbCard, lbTable, lbText } from './loadBalancingUiClasses';

import type { ProductionScheduleLoadBalancingSuggestionItem } from '../../../api/client';

type Props = {
  suggestions: ProductionScheduleLoadBalancingSuggestionItem[];
  error: unknown;
};

export function LoadBalancingOverviewSuggestionsSection({ suggestions, error }: Props) {
  return (
    <section className={lbCard.base}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className={lbText.section}>社内移管サジェスト（工程行）</p>
        {error ? (
          <span className={lbText.error}>
            {error instanceof Error ? error.message : 'エラー'}
          </span>
        ) : null}
      </div>
      {suggestions.length === 0 ? (
        <p className={lbText.muted}>
          ステップ2の「社内移管サジェスト」を押すと候補が表示されます（超過資源・分類・移管ルール・移管先余力に依存）。
        </p>
      ) : (
        <div className="max-h-[min(360px,42dvh)] overflow-auto">
          <table className={lbTable.root}>
            <thead className={lbTable.stickyHead}>
              <tr className={lbTable.headRow}>
                <th className={lbTable.headCell}>製番</th>
                <th className={lbTable.headCell}>注文</th>
                <th className={lbTable.headCell}>品番</th>
                <th className={lbTable.headCell}>から→へ</th>
                <th className={lbTable.headCell}>行分</th>
                <th className={lbTable.headCell}>移管後超過(元)</th>
                <th className={lbTable.headCell}>移管後超過(先)</th>
                <th className={lbTable.headCell}>ルール</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((suggestion) => (
                <tr key={suggestion.rowId} className={lbTable.bodyRow}>
                  <td className={`${lbTable.bodyCell} font-mono`}>{suggestion.fseiban}</td>
                  <td className={`${lbTable.bodyCell} font-mono`}>{suggestion.productNo}</td>
                  <td className={`${lbTable.bodyCell} font-mono`}>{suggestion.fhincd}</td>
                  <td className={`${lbTable.bodyCell} font-mono`}>
                    {suggestion.resourceCdFrom}→{suggestion.resourceCdTo}
                  </td>
                  <td className={lbTable.bodyCell}>{Math.round(suggestion.rowMinutes)}</td>
                  <td className={lbTable.bodyCell}>{Math.round(suggestion.simulatedSourceOverAfter)}</td>
                  <td className={lbTable.bodyCell}>{Math.round(suggestion.simulatedDestinationOverAfter)}</td>
                  <td className={`${lbTable.bodyCell} text-xs text-white/70`}>
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
