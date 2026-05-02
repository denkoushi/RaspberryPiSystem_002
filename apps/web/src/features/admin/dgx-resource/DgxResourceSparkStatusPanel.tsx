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

export function DgxResourceSparkStatusPanel({ sparkHost }: Props) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-lg border border-violet-400/25 bg-violet-950/35 p-2">
      <h2 className="text-xs font-semibold text-violet-100/90">DGX Spark（ホスト）</h2>
      <p className="text-[10px] leading-snug text-white/65">
        Pi5 の簡易疎通（任意 URL）。ホスト状態の目安として{' '}
        <span className="font-mono">DGX_RESOURCE_SPARK_HOST_STATUS_URL</span> を設定します（メトリクス sidecar の /health
        等）。
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] text-white/80">
        <dt className="text-white/50">状態</dt>
        <dd className="font-medium">{statusJa(sparkHost.status)}</dd>
        <dt className="text-white/50">取得</dt>
        <dd className="truncate font-mono text-[9px] text-white/60">
          {new Date(sparkHost.probedAt).toLocaleString('ja-JP')}
        </dd>
        {sparkHost.probeUrl ? (
          <>
            <dt className="text-white/50">probe</dt>
            <dd className="truncate font-mono text-[9px] text-white/55">{sparkHost.probeUrl}</dd>
          </>
        ) : null}
        {sparkHost.httpStatus != null ? (
          <>
            <dt className="text-white/50">HTTP</dt>
            <dd className="font-mono">{sparkHost.httpStatus}</dd>
          </>
        ) : null}
      </dl>
      {sparkHost.errorBrief ? (
        <p className="rounded border border-amber-500/25 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-100/90">
          {sparkHost.errorBrief}
        </p>
      ) : null}
      {!sparkHost.configured ? (
        <p className="text-[10px] text-white/45">環境変数未設定のため監視のみスキップ中です。</p>
      ) : null}
    </div>
  );
}
