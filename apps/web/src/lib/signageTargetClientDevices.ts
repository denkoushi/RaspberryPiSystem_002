import type { ClientDevice } from '../api/client';

export function isSignageDisplayClientDevice(client: ClientDevice): boolean {
  return client.isSignage === true;
}

/**
 * プレビュー・単一端末選択UI用: サイネージ用端末のみ、表示名順。
 * （スケジュール編集の `resolveSignageTargetClientCandidates` とは「既存割当の extras」が不要な場合に使う）
 */
export function listSignageDisplayClientDevicesSorted(clients: ClientDevice[]): ClientDevice[] {
  const signage = clients.filter(isSignageDisplayClientDevice);
  signage.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return signage;
}

/**
 * チェックボックス候補: サイネージ用端末 + 既に保存済みで別種別の端末（一覧外の既存割当を見失わない）
 */
export function resolveSignageTargetClientCandidates(
  allClients: ClientDevice[],
  selectedDeviceIds: string[]
): ClientDevice[] {
  const signage = allClients.filter(isSignageDisplayClientDevice);
  const signageIds = new Set(signage.map((c) => c.id));
  const extras = allClients.filter((c) => selectedDeviceIds.includes(c.id) && !signageIds.has(c.id));
  const merged = [...signage, ...extras];
  merged.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return merged;
}

export function formatSignageTargetSummary(
  targetClientDeviceIds: string[] | undefined | null,
  clientsById: Map<string, ClientDevice>
): string {
  const keys = targetClientDeviceIds?.filter((k) => k.length > 0) ?? [];
  if (keys.length === 0) {
    return '全端末';
  }
  const first = clientsById.get(keys[0]);
  const raw = keys[0];
  const label = first ? first.name : raw.length > 20 ? `${raw.slice(0, 18)}…` : raw;
  if (keys.length === 1) {
    return label;
  }
  /** 先頭1台は label、残りは「ほか N-1 台」 */
  return `${label} ほか ${keys.length - 1}台`;
}

export function buildClientDevicesById(clients: ClientDevice[]): Map<string, ClientDevice> {
  return new Map(clients.map((c) => [c.id, c]));
}
