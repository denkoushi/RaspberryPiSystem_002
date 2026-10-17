import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

export function formatDgxTime(value: string | null, seconds = false): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Date(value).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  });
}

const statusLabels = {
  ready: ['使えます', 'text-emerald-300', 'bg-emerald-400'],
  ready_mismatch: ['使えます（モデル違い）', 'text-amber-300', 'bg-amber-400'],
  degraded: ['一部に問題があります', 'text-amber-300', 'bg-amber-400'],
  down: ['使えません', 'text-red-300', 'bg-red-400'],
  unconfigured: ['確認できません', 'text-slate-300', 'bg-slate-400'],
  returning: ['業務に戻しています', 'text-blue-300', 'bg-blue-400'],
} as const;

function Meter({ label, value, percent }: { label: string; value: string; percent?: number }) {
  return <div className="min-w-0">
    <dt className="text-sm text-slate-400">{label}</dt>
    <dd className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</dd>
    {percent !== undefined && <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.max(0, Math.min(100, percent))} className="mt-2 h-1.5 overflow-hidden rounded bg-slate-700">
      <div className="h-full rounded bg-blue-400" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>}
  </div>;
}

export function DgxResourceStatusPanel({ overview }: { overview: DgxResourceOverview }) {
  const { business, metrics } = overview;
  const [label, textColor, dotColor] = statusLabels[business.state];
  const embedding = business.embedding;
  const embeddingLabel = { ok: '直近は成功', failed: '直近は失敗', not_observed: 'まだ呼ばれていません', disabled: '使っていません' }[embedding.state];
  const embeddingDetail = embedding.state === 'ok' ? ` · ${formatDgxTime(embedding.lastSuccessAt)} に成功`
    : embedding.state === 'failed' ? ` · ${formatDgxTime(embedding.lastFailureAt)} に失敗。${embedding.lastErrorBrief ?? '処理を完了できませんでした'}` : '';
  const memoryKnown = metrics.unifiedMemUsedBytes !== null && metrics.unifiedMemTotalBytes !== null && metrics.unifiedMemTotalBytes > 0;
  return <section aria-label="業務 LLM の状態" className="rounded-xl border border-slate-700 bg-slate-900 p-5">
    <div className="grid gap-6 xl:grid-cols-[1.1fr_2fr]">
      <div>
        <h2 className="text-sm font-medium text-slate-300">業務 LLM</h2>
        <p role="status" className={`mt-2 flex items-center gap-3 text-2xl font-bold ${textColor}`}>
          <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${dotColor}`} />{label}
        </p>
        <p className="mt-3 break-words text-sm text-slate-200">動いているモデル: {business.activeProfile?.displayName ?? 'なし'}
          {business.matchesIntent === true && <span className="text-slate-400">（業務の既定と同じ）</span>}
        </p>
      </div>
      <dl className="grid gap-5 sm:grid-cols-3">
        <div><dt className="text-sm text-slate-400">LLM 本体</dt>
          <dd className="mt-2 font-semibold text-white">{{ ok: '応答あり', down: '応答なし', unconfigured: '未設定' }[business.llm.state]}</dd>
          <dd className="mt-2 text-xs leading-relaxed text-slate-400">DGX の窓口とモデル一覧の両方を確認</dd>
        </div>
        <div><dt className="text-sm text-slate-400">写真の埋め込み</dt>
          <dd className={`mt-2 font-semibold ${embedding.state === 'failed' ? 'text-amber-300' : 'text-white'}`}>{embeddingLabel}</dd>
          <dd className="mt-2 text-xs leading-relaxed text-slate-400">写真持出の類似検索{embeddingDetail}</dd>
        </div>
        <div><dt className="text-sm text-slate-400">業務で使うモデル</dt>
          <dd className="mt-2 break-words font-semibold text-white">{business.intendedProfile?.displayName ?? '未設定'}</dd>
          <dd className="mt-2 text-xs leading-relaxed text-slate-400">{business.matchesIntent === false ? '動いているモデルと違います'
            : business.intendedProfile ? '最後に「業務に戻す」で選んだもの' : '「業務に戻す」でモデルを選んでください'}</dd>
        </div>
      </dl>
    </div>
    <dl className="mt-5 grid grid-cols-2 gap-6 border-t border-slate-700 pt-4 lg:grid-cols-4">
      <Meter label="メモリ" value={memoryKnown ? `${(metrics.unifiedMemUsedBytes! / 1024 ** 3).toFixed(1)} / ${(metrics.unifiedMemTotalBytes! / 1024 ** 3).toFixed(1)} GB` : '—'}
        percent={memoryKnown ? metrics.unifiedMemUsedBytes! / metrics.unifiedMemTotalBytes! * 100 : undefined} />
      <Meter label="GPU" value={metrics.gpuUtilPct !== null ? `${metrics.gpuUtilPct} %` : '—'} percent={metrics.gpuUtilPct ?? undefined} />
      <Meter label="温度" value={metrics.temperatureC !== null ? `${metrics.temperatureC} ℃` : '—'} />
      <Meter label="電力" value={metrics.powerW !== null ? `${metrics.powerW} W` : '—'} />
    </dl>
  </section>;
}
