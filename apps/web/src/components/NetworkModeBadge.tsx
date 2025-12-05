import { useNetworkModeStatus } from '../api/hooks';

const MODE_LABELS: Record<'local' | 'maintenance', string> = {
  local: 'ローカル運用モード',
  maintenance: 'メンテナンスモード'
};

const MODE_COLORS: Record<'local' | 'maintenance', string> = {
  local: 'bg-emerald-400',
  maintenance: 'bg-orange-400'
};

export function NetworkModeBadge() {
  const { data, isLoading, isError } = useNetworkModeStatus();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
        ネットワークモードを取得中...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
        ネットワークモードを取得できません
      </div>
    );
  }

  const color = MODE_COLORS[data.detectedMode];
  const label = MODE_LABELS[data.detectedMode];
  const mismatch = data.detectedMode !== data.configuredMode;
  const networkLabel = data.status === 'internet_connected' ? 'インターネット接続あり' : 'ローカルネットワークのみ';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
        <div className="text-sm font-semibold text-white">{label}</div>
        {mismatch ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
            設定値:{MODE_LABELS[data.configuredMode]}
          </span>
        ) : null}
      </div>
      <div className="text-[11px] text-white/60">
        {networkLabel}
        {data.latencyMs !== undefined ? ` / 判定 ${data.latencyMs?.toFixed(0)}ms` : null}
      </div>
      <div className="text-[11px] text-white/50">
        更新: {new Date(data.checkedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
    </div>
  );
}

