import { DgxResourceKpiStrip } from './DgxResourceKpiStrip';
import { DgxResourceRuntimeSummaryStrip } from './DgxResourceRuntimeSummaryStrip';

import type { DgxResourceKpis, DgxResourceRuntimeSummaryApi } from '../../../api/dgx-resource.types';

type Props = {
  kpis: DgxResourceKpis;
  runtimeSummary?: DgxResourceRuntimeSummaryApi;
};

/**
 * DGX リソース画面の KPI 帯（再設計）: 上段メトリクス + 下段実行時状態。
 */
export function DgxResourceStatusBoard({ kpis, runtimeSummary }: Props) {
  return (
    <div className="space-y-2">
      <DgxResourceKpiStrip kpis={kpis} />
      {runtimeSummary ? <DgxResourceRuntimeSummaryStrip runtimeSummary={runtimeSummary} /> : null}
    </div>
  );
}
