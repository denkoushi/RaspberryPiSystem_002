import {
  formatReductionMinutes,
  overviewOverCellClassName,
  overviewResourceRowClassName
} from './loadBalancingOverviewDisplay';
import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';

import type { OverviewResourceBefore, OverviewResourceRowInput } from './loadBalancingOverviewDisplay';

type Props = {
  resources: OverviewResourceRowInput[];
  beforeByResourceCd: Map<string, OverviewResourceBefore>;
  showSimulationColumns: boolean;
  onReset: () => void;
};

export function LoadBalancingOverviewResultsTable({
  resources,
  beforeByResourceCd,
  showSimulationColumns,
  onReset
}: Props) {
  return (
    <section className="rounded-lg border border-white/15 bg-slate-950/40 p-2">
      <LoadBalancingStepHeading step={4} className="mb-2">
        試算結果を確認
      </LoadBalancingStepHeading>
      <div className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-left text-[11px] text-white/90">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1">資源CD</th>
              <th className="px-2 py-1">必要分</th>
              <th className="px-2 py-1">能力分</th>
              <th className="px-2 py-1">超過</th>
              {showSimulationColumns ? (
                <>
                  <th className="px-2 py-1">試算後必要分</th>
                  <th className="px-2 py-1">試算後超過</th>
                  <th className="px-2 py-1">削減分</th>
                </>
              ) : null}
              <th className="px-2 py-1">分類</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => {
              const before = beforeByResourceCd.get(resource.resourceCd);
              const beforeRequired = Math.round(before?.requiredMinutes ?? resource.requiredMinutes);
              const beforeOver = Math.round(before?.overMinutes ?? resource.overMinutes);
              const reduction = showSimulationColumns
                ? formatReductionMinutes(beforeRequired, Math.round(resource.requiredMinutes))
                : null;

              return (
                <tr key={resource.resourceCd} className={overviewResourceRowClassName(beforeOver)}>
                  <td className="px-2 py-1 font-mono">{resource.resourceCd}</td>
                  <td className="px-2 py-1">{beforeRequired}</td>
                  <td className="px-2 py-1">
                    {resource.availableMinutes == null ? '—' : Math.round(resource.availableMinutes)}
                  </td>
                  <td className={overviewOverCellClassName(beforeOver)}>{beforeOver}</td>
                  {showSimulationColumns ? (
                    <>
                      <td className="px-2 py-1">{Math.round(resource.requiredMinutes)}</td>
                      <td className={overviewOverCellClassName(Math.round(resource.overMinutes))}>
                        {Math.round(resource.overMinutes)}
                      </td>
                      <td className={reduction?.className}>{reduction?.text}</td>
                    </>
                  ) : null}
                  <td className="px-2 py-1">{resource.classCode ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showSimulationColumns ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white"
            onClick={onReset}
          >
            リセット
          </button>
          <button
            type="button"
            className="rounded-md bg-emerald-800 px-3 py-2 text-xs font-semibold text-white opacity-40"
            disabled
            title="将来の業務フローに接続予定（現在は試算のみ）"
          >
            計画確定・移管申請へ →
          </button>
        </div>
      ) : null}
    </section>
  );
}
