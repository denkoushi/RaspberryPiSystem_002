import clsx from 'clsx';

import { buildDgxResourceStatusSummaryModel } from './dgxResourceStatusSummaryModel';
import { policyModeBadgeTokens } from './dgxResourceUi';

import type { DgxResourceStatusSummaryNextActionTone } from './dgxResourceStatusSummaryModel';
import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
};

function nextActionToneClass(tone: DgxResourceStatusSummaryNextActionTone): string {
  switch (tone) {
    case 'good':
      return 'text-emerald-300';
    case 'warn':
      return 'text-amber-300';
    case 'danger':
      return 'text-red-300';
    case 'info':
    default:
      return 'text-sky-300';
  }
}

/** ダッシュボード最上部のコンパクト運用状態サマリー（1行）。 */
export function DgxResourceStatusSummary({ overview }: Props) {
  const model = buildDgxResourceStatusSummaryModel(overview);
  const policyBadgeClass = policyModeBadgeTokens(overview.policy.mode);

  return (
    <section
      className="grid grid-cols-1 gap-2 rounded-lg border border-white/15 bg-slate-900/60 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="DGX 運用状態サマリー"
    >
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase text-white/50">現在の運用モード</div>
        <div className="mt-1">
          <span className={clsx('inline-block rounded-full border px-2.5 py-1 text-sm font-bold', policyBadgeClass)}>
            {model.policyModeLabel}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-bold uppercase text-white/50">Active Model</div>
        <div className="mt-1 break-words text-sm font-bold leading-snug text-white" title={model.activeModelLabel}>
          {model.activeModelLabel}
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-bold uppercase text-white/50">Pi5 業務意図</div>
        {model.intentDisplayLabel ? (
          <>
            <div
              className={clsx(
                'mt-1 break-words text-sm font-bold leading-snug',
                model.intentMismatch ? 'text-amber-300' : 'text-sky-100'
              )}
              title={model.intentProfileId ?? undefined}
            >
              {model.intentDisplayLabel}
            </div>
            {model.intentMismatch && model.intentMismatchHint ? (
              <p className="mt-1 text-xs font-semibold leading-snug text-amber-300/90" role="alert">
                {model.intentMismatchHint}
              </p>
            ) : null}
          </>
        ) : (
          <div className="mt-1 text-sm font-semibold text-white/50">未設定</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-xs font-bold uppercase text-white/50">次にやること</div>
        <div
          className={clsx('mt-1 break-words text-sm font-semibold leading-snug', nextActionToneClass(model.nextActionTone))}
          role="status"
        >
          {model.nextActionLabel}
        </div>
      </div>
    </section>
  );
}
