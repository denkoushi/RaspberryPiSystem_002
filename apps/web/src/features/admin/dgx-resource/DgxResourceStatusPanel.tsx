import type { DgxResourceOverview } from '../../../api/dgx-resource.types';
import type { CSSProperties, ReactNode } from 'react';

export function formatDgxTime(value: string | null, seconds = false): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Date(value).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  });
}

export const formatGiB = (bytes: number | null) => bytes == null ? '—' : (bytes / 1024 ** 3).toFixed(1);
export const memoryPercent = (bytes: number | null, total: number | null) =>
  bytes != null && total != null && total > 0 ? Math.max(0, Math.min(100, bytes / total * 100)) : 0;

export function DgxResourceStatusPanel({ overview, stopControls }: { overview: DgxResourceOverview; stopControls: ReactNode }) {
  const { business, metrics, businessReturn } = overview;
  const returning = businessReturn.state === 'in_progress';
  const running = business.llm.state === 'ok';
  const profile = overview.modelProfiles.find((item) => item.id === (returning ? businessReturn.profileId : business.activeProfile?.id));
  const label = returning ? '切り替え中' : business.llm.state === 'unconfigured' ? '確認できません' : running ? '稼働中' : '停止中';
  const color = returning ? 'var(--signal)' : running ? 'var(--live)' : 'var(--halt)';
  const { unifiedMemUsedBytes: used, unifiedMemTotalBytes: total, modelMemBytes: model, otherMemBytes: other } = metrics;
  const free = used != null && total != null ? Math.max(0, total - used) : null;
  const modelPercent = memoryPercent(model, total);
  const usedPercent = memoryPercent(used, total);
  const memoryLabel = `メモリ使用 ${formatGiB(used)} GiB / ${formatGiB(total)} GiB`;
  const embeddingLabel = { ok: '正常', failed: '失敗', not_observed: '未確認', disabled: '未使用' }[business.embedding.state];
  const step = businessReturn.phase === 'checking' ? 2 : 1;
  return <section className="dgx-gauge-shell" aria-label="業務 LLM の状態">
    <div className={`dgx-gauge ${!running && !returning ? 'dgx-halted' : ''}`} style={{ '--state-c': color } as CSSProperties}>
      <div className="dgx-g-id">
        <p className="dgx-state" role="status"><span className="dgx-lamp" />{label}</p>
        <div className="dgx-model">
          <div className="dgx-name">{returning ? profile?.displayName ?? 'モデルを読み込み中' : running ? business.activeProfile?.displayName ?? 'モデル名を確認できません' : business.llm.state === 'unconfigured' ? '状態を確認できません' : '業務 LLM 停止'}</div>
          <div className="dgx-spec">{running || returning ? <>
            {profile?.quantizationLabel && <span>{profile.quantizationLabel}</span>}
            {profile && <span>{profile.backendLabel}</span>}
            {profile?.supportsVision && <span>▧ 画像対応</span>}
          </> : <span>{business.llm.state === 'unconfigured' ? '接続設定を確認してください' : 'キオスクの AI 機能は使えません'}</span>}</div>
        </div>
        {running && !returning && <div className="dgx-checks">
          <span className="dgx-chk" style={{ '--c': 'var(--live)' } as CSSProperties}><i />応答 正常</span>
          <span className="dgx-chk" style={{ '--c': business.embedding.state === 'ok' ? 'var(--live)' : 'var(--hold)' } as CSSProperties}><i />写真の埋め込み {embeddingLabel}</span>
        </div>}
      </div>
      <div className="dgx-g-meter">
        {returning ? <>
          <div className="dgx-steps" aria-label="切替の進行状況" role="status">{['停止', '起動', '応答確認'].map((title, index) =>
            <div key={title} className={`dgx-step ${index < step ? 'dgx-done' : index === step ? 'dgx-now' : ''}`} aria-current={index === step ? 'step' : undefined}>
              <i aria-hidden="true" /><span>{index < step && <span className="dgx-sr-only">完了: </span>}{title}</span>
            </div>)}</div>
          <div className="dgx-checks"><span className="dgx-chk" style={{ '--c': 'var(--hold)' } as CSSProperties}><i />キオスクの AI 機能は一時停止中</span></div>
        </> : null}
        <>
          <div className="dgx-mem">
            <div className="dgx-head"><span>メモリ</span><b>{formatGiB(used)} / {formatGiB(total)} GiB</b></div>
            <div className="dgx-ring" style={{ '--a': `${modelPercent}%`, '--b': `${usedPercent}%` } as CSSProperties} role="img" aria-label={memoryLabel}>
              <div><b>{formatGiB(used)}</b><small>/ {formatGiB(total)} GiB</small></div>
            </div>
            <div className="dgx-stack" role="img" aria-label={memoryLabel}>
              <span style={{ width: `${modelPercent}%`, background: 'var(--model-mem)' }} />
              <span style={{ width: `${Math.max(0, usedPercent - modelPercent)}%`, background: 'var(--other-mem)' }} />
            </div>
            <div className="dgx-legend">{[['モデル', model, 'model'], ['その他', other, 'other'], ['空き', free, 'free']].map(([title, bytes, key]) =>
              <span key={key} style={{ '--c': `var(--${key}-mem)` } as CSSProperties}><i />{title} {formatGiB(bytes as number | null)}</span>)}</div>
          </div>
          <div className="dgx-readouts">{[['GPU', metrics.gpuUtilPct, '%'], ['温度', metrics.temperatureC, '℃'], ['電力', metrics.powerW, 'W']].map(([title, value, unit]) =>
            <div className="dgx-ro" key={title}><small>{title}</small><b>{value ?? '—'}<em>{unit}</em></b></div>)}</div>
        </>
      </div>
      <div className="dgx-g-act">{running && !returning && stopControls}</div>
    </div>
  </section>;
}
