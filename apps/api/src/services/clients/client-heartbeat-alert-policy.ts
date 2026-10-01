import crypto from 'crypto';

/**
 * 端末の定期連絡（status-agent の heartbeat, 毎分）が途絶えたことを判定する純粋ロジック。
 * SD カードが壊れると端末上の監視も止まるため、サーバー側で「来なくなった」ことを検知する。
 */

export const HEARTBEAT_STALE_ALERT_TYPE = 'client-heartbeat-stale';
export const HEARTBEAT_RECOVERED_ALERT_TYPE = 'client-heartbeat-recovered';

const DEFAULT_STALE_MINUTES = 10;
const DEFAULT_FORGET_DAYS = 7;
// 工場の Pi 端末だけを見る。開発用 Mac（mac-kiosk-*）や自宅の Zero 2 W（zero2w-*）は対象外。
const DEFAULT_CLIENT_ID_PATTERN = '^(raspi|raspberrypi)';

export interface HeartbeatAlertConfig {
  enabled: boolean;
  staleAfterMs: number;
  /** これより長く無連絡の端末は撤去済みとみなし、通知も復帰判定もしない。 */
  forgetAfterMs: number;
  clientIdPattern: RegExp;
}

export interface HeartbeatStatus {
  clientId: string;
  lastSeen: Date;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compilePattern(raw: string | undefined): RegExp {
  const source = raw && raw.trim() !== '' ? raw.trim() : DEFAULT_CLIENT_ID_PATTERN;
  try {
    return new RegExp(source);
  } catch {
    return new RegExp(DEFAULT_CLIENT_ID_PATTERN);
  }
}

export function loadHeartbeatAlertConfig(env: NodeJS.ProcessEnv = process.env): HeartbeatAlertConfig {
  return {
    enabled: (env.CLIENT_HEARTBEAT_ALERT_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    staleAfterMs: positiveNumber(env.CLIENT_HEARTBEAT_STALE_MINUTES, DEFAULT_STALE_MINUTES) * 60_000,
    forgetAfterMs: DEFAULT_FORGET_DAYS * 24 * 60 * 60_000,
    clientIdPattern: compilePattern(env.CLIENT_HEARTBEAT_CLIENT_ID_PATTERN)
  };
}

export function isMonitoredClient(clientId: string, config: HeartbeatAlertConfig): boolean {
  return config.clientIdPattern.test(clientId);
}

export function isStale(status: HeartbeatStatus, now: Date, config: HeartbeatAlertConfig): boolean {
  const silentMs = now.getTime() - status.lastSeen.getTime();
  return silentMs > config.staleAfterMs && silentMs <= config.forgetAfterMs;
}

/** 1回の途絶（同じ lastSeen のまま）につき1件だけ通知するための指紋。 */
export function staleAlertFingerprint(clientId: string, lastSeen: Date): string {
  return crypto
    .createHash('sha256')
    .update([HEARTBEAT_STALE_ALERT_TYPE, clientId, lastSeen.toISOString()].join(':'))
    .digest('hex');
}

export function recoveredAlertFingerprint(staleFingerprint: string): string {
  return crypto
    .createHash('sha256')
    .update([HEARTBEAT_RECOVERED_ALERT_TYPE, staleFingerprint].join(':'))
    .digest('hex');
}

function formatJst(date: Date): string {
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}

export function staleAlertMessage(status: HeartbeatStatus, now: Date): string {
  const minutes = Math.floor((now.getTime() - status.lastSeen.getTime()) / 60_000);
  return (
    `端末からの定期連絡が途絶えています: ${status.clientId}` +
    `（最終受信 ${formatJst(status.lastSeen)}、${minutes}分経過）。` +
    '電源・ネットワーク・SDカードを確認してください（意図した電源オフなら対応不要）。'
  );
}

export function recoveredAlertMessage(clientId: string, silentSince: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - silentSince.getTime()) / 60_000);
  return `端末からの定期連絡が復帰しました: ${clientId}（約${minutes}分間途絶）`;
}
