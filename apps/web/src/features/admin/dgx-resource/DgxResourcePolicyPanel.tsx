import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  dgxResourceQueryKeys,
  getDgxResourceApiErrorMessage,
  postDgxResourceAction,
} from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type ConfirmStopOpts = {
  title: string;
  description?: string;
  tone?: 'danger' | 'primary';
};

type Props = {
  overview: DgxResourceOverview;
  onPolicyError: (message: string | null) => void;
  confirmStop: (opts: ConfirmStopOpts) => Promise<boolean>;
};

export function DgxResourcePolicyPanel({ overview, onPolicyError, confirmStop }: Props) {
  const qc = useQueryClient();
  const policyMode = overview.policy.mode;
  const canControl = overview.runtime.runtimeControlConfigured;

  const mutate = useMutation({
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

  const busy = mutate.isPending;

  const warm = overview.runtime.warmWindow;

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-sky-400/25 bg-sky-950/40 p-2">
      <h2 className="text-xs font-semibold text-sky-100/90">運用ポリシー</h2>
      <p className="text-[10px] leading-snug text-white/70">
        {policyMode === 'business_first'
          ? '業務優先: LocalLLM を優先し、私用ワークロードは運用で抑制する前提です。'
          : '私用OK: GPU 競合は許容（運用側で監視）。'}
      </p>
      {warm.enabled ? (
        <p className="text-[10px] text-white/50">
          Warm: {warm.timeZone ?? '—'} · {warm.startHourInclusive}–{warm.endHourExclusive}（窓内は on_demand
          での自動 /stop が抑制されます）
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant={policyMode === 'business_first' ? 'primary' : 'secondary'}
          className="px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => mutate.mutate({ type: 'SET_POLICY', policyMode: 'business_first' })}
        >
          業務優先
        </Button>
        <Button
          type="button"
          variant={policyMode === 'private_ok' ? 'primary' : 'secondary'}
          className="px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => mutate.mutate({ type: 'SET_POLICY', policyMode: 'private_ok' })}
        >
          私用OK
        </Button>
      </div>
      <div className="border-t border-white/10 pt-2">
        <p className="mb-1 text-[10px] font-medium text-white/60">LocalLLM ランタイム（DGX gateway /start|/stop）</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy || !canControl}
            title={!canControl ? 'on_demand + 起動/停止URL が必要です' : undefined}
            onClick={() => mutate.mutate({ type: 'LOCAL_LLM_START', reason: 'admin_dgx_resource_ui' })}
          >
            起動
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500 disabled:opacity-60"
            disabled={busy || !canControl}
            title={!canControl ? 'on_demand + 起動/停止URL が必要です' : undefined}
            onClick={async () => {
              const ok = await confirmStop({
                title: 'LocalLLM ランタイムを停止しますか？',
                description: '実行中の推論があると失敗することがあります。',
                tone: 'danger',
              });
              if (!ok) return;
              mutate.mutate({ type: 'LOCAL_LLM_STOP', reason: 'admin_dgx_resource_ui' });
            }}
          >
            停止
          </Button>
        </div>
        <p className="mt-1 text-[9px] leading-tight text-white/45">
          mode: {overview.runtime.localLlmMode} / control: {canControl ? 'on' : 'off'}
        </p>
      </div>
    </div>
  );
}
