import { Button } from '../../../components/ui/Button';

import type { DgxControlTargetSnapshotApi, DgxResourceOverview } from '../../../api/dgx-resource.types';

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
    return '操作: 起動・停止（DGX /start | /stop）';
  }
  return '操作: 読取のみ';
}

type Props = {
  targets: DgxControlTargetSnapshotApi[];
  overview: DgxResourceOverview;
  onControlUiError: (message: string | null) => void;
  confirmStop: (opts: {
    title: string;
    description?: string;
    tone?: 'danger' | 'primary';
  }) => Promise<boolean>;
  onGatewayStart: () => void;
  onGatewayStop: () => void;
  gatewayBusy: boolean;
};

export function DgxResourceTargetGrid({
  targets,
  overview,
  onControlUiError,
  confirmStop,
  onGatewayStart,
  onGatewayStop,
  gatewayBusy,
}: Props) {
  const canGatewayControl =
    overview.runtime.runtimeControlConfigured &&
    targets.some((t) => t.id === 'system-prod-gateway' && t.capabilities.includes('start'));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
      {targets.map((t) => {
        const b = badge(t.status, t.badges);
        const isGateway = t.id === 'system-prod-gateway';

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
              {t.metaLines.slice(0, 2).map((line, i) => (
                <li key={i} className="truncate" title={line}>
                  {line}
                </li>
              ))}
            </ul>
            {isGateway && canGatewayControl ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                <Button
                  type="button"
                  variant="ghostOnDark"
                  disabled={gatewayBusy}
                  onClick={() => {
                    onControlUiError(null);
                    onGatewayStart();
                  }}
                  className="border border-white/20 px-3 py-1.5 text-sm"
                >
                  起動
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={gatewayBusy}
                  onClick={async () => {
                    const ok = await confirmStop({
                      title: 'system-prod-gateway を停止しますか？',
                      description: '実行中の推論があると失敗することがあります。',
                      tone: 'danger',
                    });
                    if (!ok) return;
                    onControlUiError(null);
                    onGatewayStop();
                  }}
                  className="bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
                >
                  停止
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
