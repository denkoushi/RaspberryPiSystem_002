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

export function DgxResourceRuntimeControlPanel({ overview, onPolicyError, confirmStop }: Props) {
  const qc = useQueryClient();
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
    <div className="flex shrink-0 flex-col gap-2.5 rounded-lg border border-slate-500/35 bg-slate-900/50 p-3">
      <h2 className="text-lg font-semibold text-white/85">ランタイム制御</h2>
      {warm.enabled ? (
        <p className="text-sm text-white/50">
          Warm: {warm.timeZone ?? '—'} · {warm.startHourInclusive}–{warm.endHourExclusive}（窓内は on_demand
          での自動 /stop が抑制されます）
        </p>
      ) : null}
      <div>
        <p className="mb-1 text-sm font-medium text-white/60">
          LocalLLM ランタイム（DGX gateway /start|/stop）
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="px-4 py-2 text-sm"
            disabled={busy || !canControl}
            title={!canControl ? 'on_demand + 起動/停止URL が必要です' : undefined}
            onClick={() => mutate.mutate({ type: 'LOCAL_LLM_START', reason: 'admin_dgx_resource_ui' })}
          >
            起動
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500 disabled:opacity-60"
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
        <p className="mt-1 text-sm leading-tight text-white/45">
          mode: {overview.runtime.localLlmMode} / control: {canControl ? 'on' : 'off'}
        </p>
      </div>
    </div>
  );
}
