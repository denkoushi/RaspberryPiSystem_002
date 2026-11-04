/**
 * Opt-in isolation for running API test files in parallel.
 *
 * With API_TEST_PER_WORKER_DB=1, the global setup (per-worker-db.global-setup.ts) clones the
 * migrated DATABASE_URL database into `<name>_w1..N` (one per Vitest worker), and setup-env.ts
 * points each worker's DATABASE_URL and test storage paths at its own copy via VITEST_POOL_ID.
 * Without the flag nothing changes: every file uses DATABASE_URL as-is, one file at a time.
 *
 * This module must not import application code (config/env, lib/prisma): setup-env.ts loads it
 * before any test file creates a Prisma client.
 */
import path from 'node:path';

export const PER_WORKER_DB_FLAG = 'API_TEST_PER_WORKER_DB';
const PER_WORKER_APPLIED_ENV = 'API_TEST_PER_WORKER_DB_APPLIED';

/** Directory-valued settings that tests write into; each worker gets a sibling directory. */
export const PER_WORKER_DIR_ENV_KEYS = [
  'FILE_STORAGE_ROOT',
  'PDF_STORAGE_DIR',
  'PHOTO_STORAGE_DIR',
  'BACKUP_STORAGE_DIR',
] as const;

/** File-valued settings that tests write into; each worker gets a sibling file. */
export const PER_WORKER_FILE_ENV_KEYS = ['BACKUP_CONFIG_PATH'] as const;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isPerWorkerDbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PER_WORKER_DB_FLAG] === '1';
}

export function databaseNameFromUrl(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
}

export function workerDatabaseName(baseName: string, poolId: number | string): string {
  return `${baseName}_w${poolId}`;
}

/** Same server, credentials and query string; only the database name changes. */
export function workerDatabaseUrl(baseUrl: string, poolId: number | string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${encodeURIComponent(workerDatabaseName(databaseNameFromUrl(baseUrl), poolId))}`;
  return url.toString();
}

/**
 * The global setup drops and recreates worker databases, so it only ever touches a loopback
 * server (the disposable CI container or a developer's local test PostgreSQL).
 */
export function assertDisposableDatabaseUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${PER_WORKER_DB_FLAG}=1 requires a loopback DATABASE_URL (got host ${url.hostname})`);
  }
  if (!databaseNameFromUrl(databaseUrl)) {
    throw new Error(`${PER_WORKER_DB_FLAG}=1 requires DATABASE_URL to name a database`);
  }
}

export function workerDirPath(dir: string, poolId: number | string): string {
  return `${dir.replace(/\/+$/, '')}-w${poolId}`;
}

export function workerFilePath(file: string, poolId: number | string): string {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}-w${poolId}${ext}`;
}

/**
 * Rewrites DATABASE_URL and the test storage paths in `env` for the current Vitest worker.
 * No-op unless the flag is set and Vitest assigned a pool id.
 */
export function applyPerWorkerTestEnv(env: NodeJS.ProcessEnv = process.env): void {
  const poolId = env.VITEST_POOL_ID;
  if (!isPerWorkerDbEnabled(env) || !poolId || !env.DATABASE_URL) return;
  // setupFiles run once per test file; never suffix twice if a worker process is reused.
  if (env[PER_WORKER_APPLIED_ENV]) return;
  env[PER_WORKER_APPLIED_ENV] = poolId;

  env.DATABASE_URL = workerDatabaseUrl(env.DATABASE_URL, poolId);
  for (const key of PER_WORKER_DIR_ENV_KEYS) {
    const value = env[key];
    if (value) env[key] = workerDirPath(value, poolId);
  }
  for (const key of PER_WORKER_FILE_ENV_KEYS) {
    const value = env[key];
    if (value) env[key] = workerFilePath(value, poolId);
  }
}
