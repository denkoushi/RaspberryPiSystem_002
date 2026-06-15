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
  externalBusy?: boolean;
  onControlUiError: (message: string | null) => void;
};

export function DgxResourceOperatorConsole({
  overview,
  operator,
  postDgxAction,
  actionBusy,
  externalBusy = false,
  onControlUiError,
}: Props) {
  return (
    <section className="flex min-h-0 flex-col gap-4 rounded-lg border border-white/12 bg-slate-950/65 p-3 shadow-lg shadow-black/20">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">DGX リソース</h1>
        <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
          運用ガイド
        </span>
      </header>

      <DgxResourceCurrentStateSummary overview={overview} operator={operator} />

      <DgxResourcePrimaryScenarioFlow
        operator={operator}
        modelProfiles={overview.modelProfiles}
        runtimeSummary={overview.runtimeSummary}
        postDgxAction={postDgxAction}
        actionBusy={actionBusy}
        externalBusy={externalBusy}
        onControlUiError={onControlUiError}
      />
    </section>
  );
}
