import { Button } from '../../../components/ui/Button';

import type { DgxControlTargetIdApi, DgxControlTargetSnapshotApi, DgxResourceOverview } from '../../../api/dgx-resource.types';

function badge(
  status: DgxControlTargetSnapshotApi['status'],
  badges: string[]
): { text: string; className: string } {
  if (badges.includes('policy')) {
    return { text: 'POLICY', className: 'border-amber-400/50 bg-amber-500/15 text-amber-200' };
  }
  if (status === 'running') return { text: 'RUN', className: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' };
  if (status === 'degraded')
    return { text: 'WARN', className: 'border-amber-400/40 bg-amber-500/15 text-amber-200' };
  if (status === 'stopped') return { text: 'OFF', className: 'border-red-400/35 bg-red-500/15 text-red-200' };
  return { text: 'N/A', className: 'border-white/15 bg-white/5 text-white/60' };
}

function kindLabel(kind: DgxControlTargetSnapshotApi['kind']): string {
  switch (kind) {
    case 'gateway':
      return 'ゲートウェイ';
    case 'http_probe':
      return 'HTTP 監視';
    case 'metrics_source':
      return 'メトリクス';
    default:
      return kind;
  }
}

function capabilitySummary(capabilities: DgxControlTargetSnapshotApi['capabilities']): string {
  if (capabilities.includes('start') && capabilities.includes('stop')) {
    return '操作: 起動・停止（設定されている POST hook）';
  }
  return '操作: 読取のみ';
}

function stopConfirmCopy(targetId: DgxControlTargetIdApi, displayName: string): {
  title: string;
  description: string;
} {
  switch (targetId) {
    case 'system-prod-gateway':
      return {
        title: `${displayName} を停止しますか？`,
        description: '実行中の推論やオンデマンド利用に影響します。',
      };
    case 'private-comfyui':
      return {
        title: '私用 ComfyUI を停止しますか？',
        description:
          'DGX 側の Comfy UI コンテナ等が停止試行されます。未保存ワークフローがあれば先に確認してください。',
      };
    case 'experiment-lab':
      return {
        title: 'experiment-lab を停止しますか？',
        description: '実験コンテナの停止試行です。検証データに注意してください。',
      };
    default:
      return {
        title: `${displayName} を停止しますか？`,
        description: '関連ワークロードが停止試行されます。',
      };
  }
}

type Props = {
  targets: DgxControlTargetSnapshotApi[];
  overview: DgxResourceOverview;
  targetActionError: { targetId: DgxControlTargetIdApi; message: string } | null;
  onControlUiError: (message: string | null) => void;
  confirmStop: (opts: {
    title: string;
    description?: string;
    tone?: 'danger' | 'primary';
  }) => Promise<boolean>;
  busy: boolean;
  onExecuteTarget: (targetId: DgxControlTargetIdApi, action: 'start' | 'stop') => void;
};

export function DgxResourceTargetGrid({
  targets,
  overview,
  targetActionError,
  onControlUiError,
  confirmStop,
  busy,
  onExecuteTarget,
}: Props) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
      {targets.map((t) => {
        const b = badge(t.status, t.badges);
        const canControlRuntime = t.capabilities.includes('start') && t.capabilities.includes('stop');
        const cardError = targetActionError?.targetId === t.id ? targetActionError.message : null;

        /** gateway は on_demand + 制御 URL、他は Pi5 env の hook URL が揃っているときのみ操作可 */
        const gatewayReady =
          t.id === 'system-prod-gateway' &&
          overview.runtime.runtimeControlConfigured &&
          canControlRuntime;
        const otherReady = t.id !== 'system-prod-gateway' && canControlRuntime;

        const showButtons = gatewayReady || otherReady;

        return (
          <section
            key={t.id}
            className="flex min-h-[6.5rem] flex-col rounded-lg border border-white/10 bg-slate-900/50 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-white">{t.displayName}</h3>
                <p className="truncate text-sm text-white/45">
                  {kindLabel(t.kind)} · {capabilitySummary(t.capabilities)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-sm font-bold ${b.className}`}>
                {b.text}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1 text-sm leading-snug text-white/55">
              {t.metaLines.slice(0, 3).map((line, i) => (
                <li key={i} className="truncate" title={line}>
                  {line}
                </li>
              ))}
            </ul>
            {showButtons ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                <Button
                  type="button"
                  variant="ghostOnDark"
                  disabled={busy}
                  onClick={() => {
                    onControlUiError(null);
                    onExecuteTarget(t.id as DgxControlTargetIdApi, 'start');
                  }}
                  className="border border-white/20 px-3 py-1.5 text-sm"
                >
                  起動
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    const copy = stopConfirmCopy(t.id as DgxControlTargetIdApi, t.displayName);
                    const ok = await confirmStop({
                      ...copy,
                      tone: 'danger',
                    });
                    if (!ok) return;
                    onControlUiError(null);
                    onExecuteTarget(t.id as DgxControlTargetIdApi, 'stop');
                  }}
                  className="px-3 py-1.5 text-sm"
                >
                  停止
                </Button>
              </div>
            ) : null}
            {cardError ? (
              <p className="mt-2 rounded border border-red-500/35 bg-red-950/40 px-2.5 py-1.5 text-sm text-red-100/95" role="alert">
                {cardError}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
