import type { DgxSparkHostOverview } from '../../../api/dgx-resource.types';

type Props = {
  sparkHost: DgxSparkHostOverview;
};

function statusJa(s: DgxSparkHostOverview['status']): string {
  switch (s) {
    case 'running':
      return '応答あり';
    case 'stopped':
      return '異常または未到達';
    case 'degraded':
      return '劣化';
    case 'unknown':
    default:
      return '未取得';
  }
}

function statusPillClass(s: DgxSparkHostOverview['status']): string {
  switch (s) {
    case 'running':
      return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300';
    case 'degraded':
      return 'border-amber-400/30 bg-amber-500/15 text-amber-300';
    case 'stopped':
      return 'border-red-400/30 bg-red-500/15 text-red-300';
    default:
      return 'border-white/20 bg-white/5 text-white/60';
  }
}

/** 右カラムを圧縮。詳細は折りたたみ。 */
export function DgxResourceSparkStatusPanel({ sparkHost }: Props) {
  const label = statusJa(sparkHost.status);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-slate-900/60 px-3 py-2">
      <span className="text-sm font-bold text-white">DGX Spark</span>
      <span className={`rounded-full border px-2.5 py-1 text-sm font-semibold ${statusPillClass(sparkHost.status)}`}>{label}</span>
      <span className="font-mono text-sm text-white/60">{new Date(sparkHost.probedAt).toLocaleTimeString('ja-JP')}</span>
      {sparkHost.errorBrief ? (
        <span className="max-w-full break-words text-sm leading-snug text-amber-300">{sparkHost.errorBrief}</span>
      ) : null}
      {!sparkHost.configured ? <span className="text-sm text-white/60">ENV 未設定</span> : null}

      <details className="ml-auto min-w-[8rem] text-sm">
        <summary className="cursor-pointer select-none font-medium text-white/70 hover:text-white">詳細</summary>
        <div className="mt-2 space-y-1 rounded-lg border border-white/15 bg-slate-950/60 p-2 text-sm text-white/70 open:max-w-md">
          <p className="text-xs leading-snug text-white/60">
            Pi5 からの簡易疎通。任意 URL: <span className="font-mono">DGX_RESOURCE_SPARK_HOST_STATUS_URL</span>
          </p>
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
            {sparkHost.probeUrl ? (
              <>
                <dt className="text-white/60">probe</dt>
                <dd className="break-all font-mono text-xs leading-snug text-white/70">{sparkHost.probeUrl}</dd>
              </>
            ) : null}
            {sparkHost.httpStatus != null ? (
              <>
                <dt className="text-white/60">HTTP</dt>
                <dd className="font-mono text-xs">{sparkHost.httpStatus}</dd>
              </>
            ) : null}
            <dt className="text-white/60">取得</dt>
            <dd className="font-mono text-xs">{new Date(sparkHost.probedAt).toLocaleString('ja-JP')}</dd>
          </dl>
        </div>
      </details>
    </div>
  );
}
