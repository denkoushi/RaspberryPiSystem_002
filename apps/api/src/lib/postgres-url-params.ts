import type { PoolConfig } from 'pg';

export function postgresPoolConfig(databaseUrl: string, defaults = {
  connectionLimit: Number(process.env.DATABASE_PRISMA_CONNECTION_LIMIT ?? 10),
  poolTimeoutSeconds: Number(process.env.DATABASE_PRISMA_POOL_TIMEOUT_SECONDS ?? 20),
  connectTimeoutSeconds: Number(process.env.DATABASE_PRISMA_CONNECT_TIMEOUT_SECONDS ?? 10)
}): PoolConfig {
  const url = new URL(databaseUrl);
  const read = (key: string, fallback: number, minimum: number) => {
    const value = url.searchParams.has(key) ? Number(url.searchParams.get(key)) : fallback;
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`Invalid PostgreSQL pool setting: ${key}`);
    }
    url.searchParams.delete(key);
    return value;
  };
  const max = read('connection_limit', defaults.connectionLimit, 1);
  const poolTimeout = read('pool_timeout', defaults.poolTimeoutSeconds, 0);
  const connectTimeout = read('connect_timeout', defaults.connectTimeoutSeconds, 0);
  // pg は接続確立と空き接続待ちを1つの上限で扱う。Prisma 5 より早く失敗させないよう、
  // 0(無制限)を除いた長いほうの値を使う。
  const timeouts = [poolTimeout, connectTimeout].filter((value) => value > 0);
  return {
    connectionString: url.toString(),
    max,
    connectionTimeoutMillis: timeouts.length ? Math.max(...timeouts) * 1000 : 0
  };
}
