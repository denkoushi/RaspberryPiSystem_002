import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  dgxResourceQueryKeys,
  getDgxResourceApiErrorMessage,
  postDgxResourceAction,
} from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { DGX_POLICY_PROFILES, orderProfilesForUi } from './dgxResourceProfiles';

import type { DgxPolicyModeApi, DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  onControlUiError: (message: string | null) => void;
};

async function confirmWorkloadOrchestration(
  confirmFn: ReturnType<typeof useConfirm>,
  mode: DgxPolicyModeApi
): Promise<boolean> {
  if (mode === 'business_first') {
    return confirmFn({
      title: '業務優先：ワークロード自動調整',
      description:
        '実験ラボ・私用 ComfyUI が Pi5 の起停 URL に設定されている場合、停止リクエストを順に送信します（GPU競合 KB-364 の緩和）。業務側推論への影響はありません。',
      tone: 'primary',
    });
  }
  if (mode === 'experiment_first') {
    return confirmFn({
      title: '実験優先：ワークロード自動調整',
      description:
        '私用 ComfyUI の停止試行と、業務 gateway（on_demand + 制御 URL 済みのときのみ）ランタイムの停止試行が走ります。写真持出 VLM 等への影響が大きいため必ず確認してください。',
      tone: 'danger',
    });
  }
  return true;
}

function inferenceLooksDegraded(overview: DgxResourceOverview): boolean {
  const targets = overview.targets ?? [];
  const inf =
    targets.find((t) => t.id === 'system-prod-inference') ??
    overview.services.find((s) => s.id === 'system-prod-inference');
  return inf?.status === 'degraded' || (inf?.badges ?? []).includes('degraded');
}

export function DgxResourceProfilePanel({ overview, onControlUiError }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const policyMode = overview.policy.mode;
  const [applyWorkloadChanges, setApplyWorkloadChanges] = useState(false);

  const mutatePolicy = useMutation({
    mutationFn: postDgxResourceAction,
    onSuccess: async () => {
      onControlUiError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview }),
        qc.invalidateQueries({ queryKey: ['dgx-resource', 'events'] }),
      ]);
    },
    onError: (e) => {
      onControlUiError(getDgxResourceApiErrorMessage(e));
    },
  });

  const busy = mutatePolicy.isPending;
  const degraded = inferenceLooksDegraded(overview);
  const rb = overview.policy.previousMode;
  const canRollback = rb != null && rb !== policyMode;

  const currentCopy = DGX_POLICY_PROFILES[policyMode];

  return (
    <div className="flex shrink-0 flex-col gap-2.5 rounded-lg border border-sky-400/25 bg-sky-950/40 p-3">
      <h2 className="text-lg font-semibold text-sky-100/90">運用プロファイル</h2>
      <p className="text-sm leading-snug text-white/70">{currentCopy.description}</p>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-white/75">
        <input
          type="checkbox"
          className="mt-1 rounded border-white/30 bg-black/40"
          checked={applyWorkloadChanges}
          disabled={busy}
          onChange={(ev) => setApplyWorkloadChanges(ev.target.checked)}
        />
        <span>
          <span className="font-medium text-sky-100/90">モード適用時にワークロードも自動調整する</span>
          （チェックあり・かつ業務優先/実験優先への切替のみ、Pi5 が POST 送信。私用 OK への切替では通常何もしない）
        </span>
      </label>

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
            onClick={async () => {
              if (applyWorkloadChanges && (p.mode === 'business_first' || p.mode === 'experiment_first')) {
                const ok = await confirmWorkloadOrchestration(confirm, p.mode);
                if (!ok) return;
              }
              mutatePolicy.mutate({
                type: 'SET_POLICY',
                policyMode: p.mode,
                ...(applyWorkloadChanges ? { applyWorkloadChanges: true } : {}),
              });
            }}
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
                  applyWorkloadChanges: false,
                })
              }
            >
              直前モードへ戻す ({DGX_POLICY_PROFILES[rb].titleShort})
            </Button>
            <span className="text-sm text-white/45">安全ロールバック用（ひとつ前の状態のみ・ワークロード自動調整は行いません）</span>
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
