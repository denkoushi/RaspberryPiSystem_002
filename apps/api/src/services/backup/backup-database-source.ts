/**
 * バックアップ設定が表す論理DB名を取り出す。
 * 接続先の差し替え（Docker、テスト、一時DB）とは独立した保存・保持キーとして使う。
 */
export function databaseNameFromSource(source: string | undefined): string | undefined {
  const value = source?.trim();
  if (!value) return undefined;

  if (value.startsWith('postgresql://') || value.startsWith('postgres://')) {
    try {
      const parsed = new URL(value);
      return parsed.pathname.replace(/^\//, '') || undefined;
    } catch {
      return undefined;
    }
  }

  return !value.includes('/') && !value.includes(':') ? value : undefined;
}

export function resolveDatabaseBackupSource(
  configuredSource: string | undefined,
  connectionUrl: string
): string {
  return databaseNameFromSource(configuredSource) ?? databaseNameFromSource(connectionUrl) ?? 'database';
}
