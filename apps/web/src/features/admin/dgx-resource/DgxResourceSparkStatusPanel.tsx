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
      return 'border-emerald-400/50 bg-emerald-950/45 text-emerald-50';
    case 'degraded':
      return 'border-amber-400/50 bg-amber-950/45 text-amber-50';
    case 'stopped':
      return 'border-red-400/45 bg-red-950/40 text-red-50';
    default:
      return 'border-white/25 bg-white/10 text-white/80';
  }
}

/** 右カラムを圧縮。詳細は折りたたみ。 */
export function DgxResourceSparkStatusPanel({ sparkHost }: Props) {
  const label = statusJa(sparkHost.status);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-violet-400/25 bg-violet-950/35 px-3 py-2">
      <span className="text-sm font-bold text-violet-100/95">DGX Spark</span>
      <span className={`rounded-full border px-2.5 py-1 text-sm font-semibold ${statusPillClass(sparkHost.status)}`}>{label}</span>
      <span className="font-mono text-sm text-white/55">{new Date(sparkHost.probedAt).toLocaleTimeString('ja-JP')}</span>
      {sparkHost.errorBrief ? (
        <span className="max-w-full truncate text-sm text-amber-100/95" title={sparkHost.errorBrief}>
          {sparkHost.errorBrief}
        </span>
      ) : null}
      {!sparkHost.configured ? <span className="text-sm text-white/45">ENV 未設定</span> : null}

      <details className="ml-auto min-w-[8rem] text-sm">
        <summary className="cursor-pointer select-none font-medium text-violet-200/90 hover:text-violet-100">詳細</summary>
        <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-black/25 p-2 text-sm text-white/75 open:max-w-md">
          <p className="text-xs leading-snug text-white/55">
            Pi5 からの簡易疎通。任意 URL: <span className="font-mono">DGX_RESOURCE_SPARK_HOST_STATUS_URL</span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
            {sparkHost.probeUrl ? (
              <>
                <dt className="text-white/45">probe</dt>
                <dd className="truncate font-mono text-xs text-white/65">{sparkHost.probeUrl}</dd>
              </>
            ) : null}
            {sparkHost.httpStatus != null ? (
              <>
                <dt className="text-white/45">HTTP</dt>
                <dd className="font-mono text-xs">{sparkHost.httpStatus}</dd>
              </>
            ) : null}
            <dt className="text-white/45">取得</dt>
            <dd className="font-mono text-xs">{new Date(sparkHost.probedAt).toLocaleString('ja-JP')}</dd>
          </dl>
        </div>
      </details>
    </div>
  );
}
