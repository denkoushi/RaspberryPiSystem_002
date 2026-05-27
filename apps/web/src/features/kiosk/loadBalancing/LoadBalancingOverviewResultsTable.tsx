import {
  formatReductionMinutes,
  overviewOverCellClassName,
  overviewResourceRowClassName
} from './loadBalancingOverviewDisplay';
import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';
import { lbBtn, lbCard, lbResultsTableCol, lbTable } from './loadBalancingUiClasses';

import type { OverviewResourceBefore, OverviewResourceRowInput } from './loadBalancingOverviewDisplay';

type Props = {
  resources: OverviewResourceRowInput[];
  beforeByResourceCd: Map<string, OverviewResourceBefore>;
  showSimulationColumns: boolean;
  onReset: () => void;
  /** 棒グラフ列と同幅の左スタック内に配置 */
  embedded?: boolean;
};

export function LoadBalancingOverviewResultsTable({
  resources,
  beforeByResourceCd,
  showSimulationColumns,
  onReset,
  embedded = false
}: Props) {
  const numHead = `${lbTable.headCell} ${lbResultsTableCol.num}`;
  const numCell = lbTable.valueCell;

  return (
    <section className={lbCard.base}>
      <LoadBalancingStepHeading step={4}>試算結果を確認</LoadBalancingStepHeading>
      <div
        className={
          embedded
            ? 'max-h-[min(240px,32dvh)] overflow-auto'
            : 'max-h-[min(280px,36dvh)] overflow-auto'
        }
      >
        <table className={lbTable.compact}>
          <thead className={lbTable.stickyHead}>
            <tr className={lbTable.headRow}>
              <th className={`${lbTable.headCell} ${lbResultsTableCol.resourceCd}`}>資源CD</th>
              <th className={numHead}>必要分</th>
              <th className={numHead}>能力分</th>
              <th className={numHead}>超過</th>
              {showSimulationColumns ? (
                <>
                  <th className={numHead}>試算後必要</th>
                  <th className={numHead}>試算後超過</th>
                  <th className={numHead}>削減分</th>
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
                  <td className={`${lbTable.bodyCell} font-mono ${lbResultsTableCol.resourceCd}`}>
                    {resource.resourceCd}
                  </td>
                  <td className={`${numCell} ${lbResultsTableCol.num}`}>{beforeRequired}</td>
                  <td className={`${numCell} ${lbResultsTableCol.num}`}>
                    {resource.availableMinutes == null ? '—' : Math.round(resource.availableMinutes)}
                  </td>
                  <td className={`${overviewOverCellClassName(beforeOver)} ${lbResultsTableCol.num}`}>
                    {beforeOver}
                  </td>
                  {showSimulationColumns ? (
                    <>
                      <td className={`${numCell} ${lbResultsTableCol.num}`}>
                        {Math.round(resource.requiredMinutes)}
                      </td>
                      <td
                        className={`${overviewOverCellClassName(Math.round(resource.overMinutes))} ${lbResultsTableCol.num}`}
                      >
                        {Math.round(resource.overMinutes)}
                      </td>
                      <td className={`${reduction?.className} ${lbResultsTableCol.num}`}>{reduction?.text}</td>
                    </>
                  ) : null}
                  <td className={`${lbTable.bodyCell} ${lbResultsTableCol.classCode}`}>
                    {resource.classCode ?? '—'}
                  </td>
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
