import { DgxResourceCurrentStateSummary } from './DgxResourceCurrentStateSummary';
import { DgxResourcePrimaryScenarioFlow } from './DgxResourcePrimaryScenarioFlow';

import type {
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
  DgxResourceOverview,
} from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  operator: DgxResourceOperatorConsoleApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  onControlUiError: (message: string | null) => void;
};

export function DgxResourceOperatorConsole({
  overview,
  operator,
  postDgxAction,
  actionBusy,
  onControlUiError,
}: Props) {
  return (
    <section className="flex min-h-0 flex-col gap-4 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-slate-950/80 to-cyan-950/25 p-3 shadow-lg shadow-black/20">
      <header className="shrink-0 space-y-2">
        <h2 className="text-xl font-bold text-cyan-50/95">DGX 運用ガイド</h2>
        <p className="text-sm text-white/55">通常はこの画面の順番どおり進めれば足ります。モードのみ直す・個別サービス復旧などは詳細へ。</p>
      </header>

      <DgxResourceCurrentStateSummary overview={overview} operator={operator} />

      <DgxResourcePrimaryScenarioFlow
        operator={operator}
        postDgxAction={postDgxAction}
        actionBusy={actionBusy}
        onControlUiError={onControlUiError}
      />
    </section>
  );
}
