import type { ClientDevice } from '../api/client';

/**
 * サイネージ表示端末の候補判定。
 * ClientDevice に種別が無いため、運用上の apiKey 慣習（`-signage` / `signage` を含む）で絞る。
 * 将来 DB に deviceRole が入ればここを差し替える。
 */
export function isSignageDisplayClientDevice(client: ClientDevice): boolean {
  const key = client.apiKey.toLowerCase();
  return key.includes('signage');
}

/**
 * チェックボックス候補: サイネージ用端末 + 既に保存済みで別種別のキー（一覧外の既存割当を見失わない）
 */
export function resolveSignageTargetClientCandidates(
  allClients: ClientDevice[],
  selectedApiKeys: string[]
): ClientDevice[] {
  const signage = allClients.filter(isSignageDisplayClientDevice);
  const signageIds = new Set(signage.map((c) => c.id));
  const extras = allClients.filter((c) => selectedApiKeys.includes(c.apiKey) && !signageIds.has(c.id));
  const merged = [...signage, ...extras];
  merged.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return merged;
}

export function formatSignageTargetSummary(
  targetClientKeys: string[] | undefined | null,
  clientsByApiKey: Map<string, ClientDevice>
): string {
  const keys = targetClientKeys?.filter((k) => k.length > 0) ?? [];
  if (keys.length === 0) {
    return '全端末';
  }
  const first = clientsByApiKey.get(keys[0]);
  const raw = keys[0];
  const label = first ? first.name : raw.length > 20 ? `${raw.slice(0, 18)}…` : raw;
  if (keys.length === 1) {
    return label;
  }
  /** 先頭1台は label、残りは「ほか N-1 台」 */
  return `${label} ほか ${keys.length - 1}台`;
}

export function buildClientDevicesByApiKey(clients: ClientDevice[]): Map<string, ClientDevice> {
  return new Map(clients.map((c) => [c.apiKey, c]));
}
