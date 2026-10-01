import { formatAgo, judgeDelivery, type DeliveryStatus } from './hubModel';
import { useSignageClientImage } from './useSignageClientImage';

import type { ClientDevice, SignageManagementOverview } from '../../../api/client';

const DELIVERY_LABEL: Record<DeliveryStatus['state'], string> = {
  ok: '受信中',
  stale: '応答なし',
  never: '受信の記録なし',
};

function ScreenCard({
  client,
  delivery,
  selected,
  onSelect,
}: {
  client: ClientDevice;
  delivery: DeliveryStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const { imageUrl } = useSignageClientImage(client.apiKey, 60_000);
  return (
    <button type="button" className="sh-screen" aria-pressed={selected} onClick={onSelect}>
      {imageUrl ? (
        <img className="sh-screen-thumb" src={imageUrl} alt={`${client.name} に配信中の画像`} />
      ) : (
        <span className="sh-screen-thumb" aria-hidden="true" />
      )}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span className="sh-screen-name">{client.name}</span>
        <span className={`sh-status sh-status-${delivery.state}`}>
          {DELIVERY_LABEL[delivery.state]}
          {delivery.secondsAgo !== null ? ` · ${formatAgo(delivery.secondsAgo)}` : ''}
        </span>
      </span>
    </button>
  );
}

export function ScreensColumn({
  clients,
  overview,
  now,
  selectedClientKey,
  onSelect,
  isLoading,
}: {
  clients: ClientDevice[];
  overview: SignageManagementOverview | undefined;
  now: Date;
  selectedClientKey: string | null;
  onSelect: (apiKey: string) => void;
  isLoading: boolean;
}) {
  const interval = overview?.renderIntervalSeconds ?? 30;
  const entryOf = (apiKey: string) => overview?.clients.find((entry) => entry.apiKey === apiKey);
  const deliveries = clients.map((client) => judgeDelivery(entryOf(client.apiKey)?.lastFetchedAt ?? null, now, interval));
  const okCount = deliveries.filter((delivery) => delivery.state === 'ok').length;
  const selected = clients.find((client) => client.apiKey === selectedClientKey) ?? null;
  const selectedEntry = selected ? entryOf(selected.apiKey) : undefined;
  const selectedDelivery = selected ? deliveries[clients.indexOf(selected)] : null;
  const renderedSecondsAgo = selectedEntry?.renderedAt
    ? Math.max(0, Math.round((now.getTime() - new Date(selectedEntry.renderedAt).getTime()) / 1000))
    : null;
  const renderOk = renderedSecondsAgo !== null && renderedSecondsAgo <= Math.max(90, interval * 3);

  return (
    <section aria-label="端末" className="sh-col">
      <div className="sh-row-between" style={{ minHeight: 28 }}>
        <span className="sh-eyebrow">端末</span>
        <span className="sh-mono" style={{ fontSize: 12, color: 'var(--sh-muted)' }}>
          {okCount} / {clients.length} 受信中
        </span>
      </div>
      {isLoading && <p className="sh-hint">端末を読み込み中…</p>}
      {!isLoading && clients.length === 0 && (
        <p className="sh-hint">サイネージ用の端末が登録されていません。クライアント管理で登録してください。</p>
      )}
      {clients.map((client, index) => (
        <ScreenCard
          key={client.id}
          client={client}
          delivery={deliveries[index]}
          selected={client.apiKey === selectedClientKey}
          onSelect={() => onSelect(client.apiKey)}
        />
      ))}
      <div style={{ flex: 1 }} />
      {selected && selectedDelivery && (
        <div className="sh-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="sh-eyebrow">配信チェック · {selected.name}</span>
          <div className="sh-check-row">
            <span>サーバ描画</span>
            <span className="sh-mono" style={{ color: renderOk ? 'var(--sh-ok)' : 'var(--sh-warn)' }}>
              {renderedSecondsAgo === null ? '未描画' : formatAgo(renderedSecondsAgo)}
            </span>
          </div>
          <div className="sh-check-row">
            <span>端末の受信</span>
            <span
              className="sh-mono"
              style={{ color: selectedDelivery.state === 'ok' ? 'var(--sh-ok)' : 'var(--sh-warn)' }}
            >
              {formatAgo(selectedDelivery.secondsAgo)}
            </span>
          </div>
          {selectedDelivery.state !== 'ok' && (
            <p className="sh-hint" style={{ margin: 0 }}>
              端末が画像を取りに来ていません。電源・ネットワーク・Tailscale を確認してください。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
