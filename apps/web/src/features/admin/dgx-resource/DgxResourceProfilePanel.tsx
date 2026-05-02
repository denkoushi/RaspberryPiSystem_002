import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  dgxResourceQueryKeys,
  getDgxResourceApiErrorMessage,
  postDgxResourceAction,
} from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';

import { DGX_POLICY_PROFILES, orderProfilesForUi } from './dgxResourceProfiles';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  onPolicyError: (message: string | null) => void;
};

function inferenceLooksDegraded(services: DgxResourceOverview['services']): boolean {
  const inf = services.find((s) => s.id === 'system-prod-inference');
  return inf?.status === 'degraded' || (inf?.badges ?? []).includes('degraded');
}

export function DgxResourceProfilePanel({ overview, onPolicyError }: Props) {
  const qc = useQueryClient();
  const policyMode = overview.policy.mode;

  const mutatePolicy = useMutation({
    mutationFn: postDgxResourceAction,
    onSuccess: async () => {
      onPolicyError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview }),
        qc.invalidateQueries({ queryKey: ['dgx-resource', 'events'] }),
      ]);
    },
    onError: (e) => {
      onPolicyError(getDgxResourceApiErrorMessage(e));
    },
  });

  const busy = mutatePolicy.isPending;
  const degraded = inferenceLooksDegraded(overview.services);
  const rb = overview.policy.previousMode;
  const canRollback = rb != null && rb !== policyMode;

  const currentCopy = DGX_POLICY_PROFILES[policyMode];

  return (
    <div className="flex shrink-0 flex-col gap-2.5 rounded-lg border border-sky-400/25 bg-sky-950/40 p-3">
      <h2 className="text-lg font-semibold text-sky-100/90">運用プロファイル</h2>
      <p className="text-sm leading-snug text-white/70">{currentCopy.description}</p>
      {degraded ? (
        <p className="rounded border border-amber-500/35 bg-amber-950/40 px-2.5 py-1.5 text-sm text-amber-100/95">
          推論レイヤが degraded の可能性があります（/v1/models）。切り替え前に復旧を推奨します。
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {orderProfilesForUi().map((p) => (
          <Button
            key={p.mode}
            type="button"
            variant={policyMode === p.mode ? 'primary' : 'secondary'}
            className="px-4 py-2 text-sm"
            disabled={busy}
            onClick={() => mutatePolicy.mutate({ type: 'SET_POLICY', policyMode: p.mode })}
          >
            {p.titleShort}
          </Button>
        ))}
      </div>
      <div className="border-t border-white/10 pt-2">
        {canRollback && rb ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="border border-white/15 px-3 py-2 text-sm"
              disabled={busy}
              onClick={() =>
                mutatePolicy.mutate({
                  type: 'SET_POLICY',
                  policyMode: rb,
                })
              }
            >
              直前モードへ戻す ({DGX_POLICY_PROFILES[rb].titleShort})
            </Button>
            <span className="text-sm text-white/45">安全ロールバック用（ひとつ前の状態）</span>
          </div>
        ) : (
          <p className="text-sm leading-tight text-white/40">
            まだ運用変更の履歴がありません。プロファイル変更後は「直前モードへ戻す」が使えます。
          </p>
        )}
      </div>
    </div>
  );
}
