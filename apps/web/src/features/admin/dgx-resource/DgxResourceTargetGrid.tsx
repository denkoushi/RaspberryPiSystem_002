import { Button } from '../../../components/ui/Button';

import type { DgxControlTargetIdApi, DgxControlTargetSnapshotApi, DgxResourceOverview } from '../../../api/dgx-resource.types';

function badge(
  status: DgxControlTargetSnapshotApi['status'],
  badges: string[]
): { text: string; className: string } {
  if (badges.includes('policy')) {
    return { text: 'POLICY', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  if (status === 'running') return { text: 'RUN', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (status === 'degraded')
    return { text: 'WARN', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  if (status === 'stopped') return { text: 'OFF', className: 'border-slate-200 bg-slate-50 text-slate-600' };
  return { text: 'N/A', className: 'border-slate-300 bg-white text-slate-500' };
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
    case 'agent-container':
      return {
        title: 'agent-container を停止しますか？',
        description: 'Agent 用コンテナの停止試行です。実行中の自動エージェント処理に注意してください。',
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
            className="flex min-h-[6.5rem] flex-col rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-slate-950">{t.displayName}</h3>
                <p className="truncate text-sm text-slate-500">
                  {kindLabel(t.kind)} · {capabilitySummary(t.capabilities)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-sm font-bold ${b.className}`}>
                {b.text}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1 text-sm leading-snug text-slate-600">
              {t.metaLines.slice(0, 3).map((line, i) => (
                <li key={i} className="truncate" title={line}>
                  {line}
                </li>
              ))}
            </ul>
            {showButtons ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    onControlUiError(null);
                    onExecuteTarget(t.id as DgxControlTargetIdApi, 'start');
                  }}
                  className="border border-slate-300 px-3 py-1.5 text-sm"
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
              <p className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-700" role="alert">
                {cardError}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
