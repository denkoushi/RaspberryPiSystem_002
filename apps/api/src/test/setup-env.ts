import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Local parallel runs: migrate the base DATABASE_URL, then from the repo root run
// bash scripts/ci/prepare-api-test-databases.sh <postgres-container> 4
// cd apps/api && API_TEST_DB_PER_WORKER=1 pnpm exec vitest run --fileParallelism=true --maxWorkers=4
// Keep DATABASE_URL pointed at the base DB; setup runs before each file's imports.
const poolId = process.env.API_TEST_DB_PER_WORKER === '1' ? process.env.VITEST_POOL_ID : undefined;
if (poolId && !/^[1-9]\d*$/.test(poolId)) throw new Error('Invalid VITEST_POOL_ID');

export function workerPath(value: string): string {
  const suffix = `_w${poolId}`;
  return poolId && !value.endsWith(suffix) ? `${value}${suffix}` : value;
}

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

if (poolId) {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = workerPath(databaseUrl.pathname);
  process.env.DATABASE_URL = databaseUrl.toString();

  const storageRoot = process.env.FILE_STORAGE_ROOT ?? process.env.PHOTO_STORAGE_DIR
    ?? process.env.PDF_STORAGE_DIR ?? '/tmp/test-photo-storage';
  const directories = {
    FILE_STORAGE_ROOT: storageRoot,
    PHOTO_STORAGE_DIR: storageRoot,
    PDF_STORAGE_DIR: storageRoot,
    CSV_DASHBOARD_STORAGE_DIR: storageRoot,
    SIGNAGE_RENDER_DIR: path.join(storageRoot, 'signage-rendered'),
    PDF_PAGES_DIR: path.join(storageRoot, 'pdf-pages'),
    ALERTS_DIR: path.join(storageRoot, 'alerts'),
    BACKUP_STORAGE_DIR: '/tmp/test-backups',
  };
  for (const [key, fallback] of Object.entries(directories)) {
    process.env[key] = workerPath(process.env[key] ?? fallback);
    mkdirSync(process.env[key], { recursive: true });
  }
  process.env.BACKUP_CONFIG_PATH = workerPath(process.env.BACKUP_CONFIG_PATH ?? '/tmp/test-backup.json');
  mkdirSync(path.dirname(process.env.BACKUP_CONFIG_PATH), { recursive: true });
}
