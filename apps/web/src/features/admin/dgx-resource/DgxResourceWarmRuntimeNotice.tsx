import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
};

/** Warm 窓と LocalLLM モードの説明（制御ボタンは system-prod-gateway ターゲットカード側） */
export function DgxResourceWarmRuntimeNotice({ overview }: Props) {
  const warm = overview.runtime.warmWindow;
  const canControl = overview.runtime.runtimeControlConfigured;

  return (
    <div className="shrink-0 rounded-lg border border-slate-500/35 bg-slate-900/50 px-3 py-2.5 text-sm text-white/55">
      {warm.enabled ? (
        <p>
          Warm: {warm.timeZone ?? '—'} · {warm.startHourInclusive}–{warm.endHourExclusive}
          （窓内は on_demand での自動 /stop が抑制されます）
        </p>
      ) : null}
      <p className={warm.enabled ? 'mt-1' : ''}>
        LocalLLM mode: <span className="font-mono text-white/70">{overview.runtime.localLlmMode}</span>
        {' · '}
        gateway 制御:{' '}
        <span className="font-mono text-white/70">{canControl ? 'on' : 'off'}</span>
        {canControl ? null : (
          <span className="text-white/40">（on_demand かつ起動/停止 URL 設定時のみ）</span>
        )}
      </p>
    </div>
  );
}
