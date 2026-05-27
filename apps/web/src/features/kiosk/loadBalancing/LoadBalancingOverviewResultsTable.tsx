import {
  formatReductionMinutes,
  overviewOverCellClassName,
  overviewResourceRowClassName
} from './loadBalancingOverviewDisplay';
import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';
import { lbBtn, lbCard, lbTable } from './loadBalancingUiClasses';

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
    <section className={lbCard.base}>
      <LoadBalancingStepHeading step={4}>試算結果を確認</LoadBalancingStepHeading>
      <div className="max-h-[min(280px,36dvh)] overflow-auto">
        <table className={lbTable.root}>
          <thead className={lbTable.stickyHead}>
            <tr className={lbTable.headRow}>
              <th className={lbTable.headCell}>資源CD</th>
              <th className={lbTable.headCell}>必要分</th>
              <th className={lbTable.headCell}>能力分</th>
              <th className={lbTable.headCell}>超過</th>
              {showSimulationColumns ? (
                <>
                  <th className={lbTable.headCell}>試算後必要分</th>
                  <th className={lbTable.headCell}>試算後超過</th>
                  <th className={lbTable.headCell}>削減分</th>
                </>
              ) : null}
              <th className={lbTable.headCell}>分類</th>
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
                  <td className={`${lbTable.bodyCell} font-mono`}>{resource.resourceCd}</td>
                  <td className={lbTable.bodyCell}>{beforeRequired}</td>
                  <td className={lbTable.bodyCell}>
                    {resource.availableMinutes == null ? '—' : Math.round(resource.availableMinutes)}
                  </td>
                  <td className={overviewOverCellClassName(beforeOver)}>{beforeOver}</td>
                  {showSimulationColumns ? (
                    <>
                      <td className={lbTable.bodyCell}>{Math.round(resource.requiredMinutes)}</td>
                      <td className={overviewOverCellClassName(Math.round(resource.overMinutes))}>
                        {Math.round(resource.overMinutes)}
                      </td>
                      <td className={reduction?.className}>{reduction?.text}</td>
                    </>
                  ) : null}
                  <td className={lbTable.bodyCell}>{resource.classCode ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showSimulationColumns ? (
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          <button type="button" className={`${lbBtn.base} ${lbBtn.slate}`} onClick={onReset}>
            リセット
          </button>
          <button
            type="button"
            className={`${lbBtn.base} ${lbBtn.greenLg} opacity-40`}
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
