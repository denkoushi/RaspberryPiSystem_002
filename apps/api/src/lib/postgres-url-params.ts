/**
 * PostgreSQL / Prisma の接続 URL にクエリパラメータをマージする。
 * DATABASE_URL に既に含まれるキーは上書きしない（明示設定を尊重）。
 */
export function mergePostgresUrlQueryParams(databaseUrl: string, params: Record<string, string>): string {
  const qIndex = databaseUrl.indexOf('?');
  const base = qIndex >= 0 ? databaseUrl.slice(0, qIndex) : databaseUrl;
  const existing = qIndex >= 0 ? new URLSearchParams(databaseUrl.slice(qIndex + 1)) : new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (!existing.has(key)) {
      existing.set(key, value);
    }
  }

  const qs = existing.toString();
  return qs.length > 0 ? `${base}?${qs}` : base;
}
