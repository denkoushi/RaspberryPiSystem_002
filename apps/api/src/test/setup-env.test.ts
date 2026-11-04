import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(path.join(tmpdir(), 'api-worker-setup-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const setupUrl = new URL('./setup-env.ts', import.meta.url).href;
const databaseUrl = 'postgresql://test:p%40ss@127.0.0.1:55432/borrow_return?schema=public&connection_limit=2';

function runSetup(overrides: NodeJS.ProcessEnv = {}) {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { existsSync } from 'node:fs';
    await import(${JSON.stringify(setupUrl)});
    const keys = ['DATABASE_URL', 'FILE_STORAGE_ROOT', 'PHOTO_STORAGE_DIR', 'PDF_STORAGE_DIR',
      'CSV_DASHBOARD_STORAGE_DIR', 'SIGNAGE_RENDER_DIR', 'PDF_PAGES_DIR', 'ALERTS_DIR',
      'BACKUP_STORAGE_DIR', 'BACKUP_CONFIG_PATH'];
    console.log(JSON.stringify({ env: Object.fromEntries(keys.map(key => [key, process.env[key]])),
      directoriesExist: keys.slice(1, -1).every(key => existsSync(process.env[key] ?? '')) }));
  `], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test', NODE_NO_WARNINGS: '1', DATABASE_URL: databaseUrl,
      FILE_STORAGE_ROOT: path.join(root, 'storage'),
      PDF_STORAGE_DIR: path.join(root, 'storage'),
      PHOTO_STORAGE_DIR: path.join(root, 'storage'),
      BACKUP_STORAGE_DIR: path.join(root, 'backups'),
      BACKUP_CONFIG_PATH: path.join(root, 'config', 'backup.json'),
      ...overrides,
    },
  })) as { env: Record<string, string>; directoriesExist: boolean };
}

describe('API worker setup before file imports', () => {
  it.each(['1', '2', '3', '4'])('isolates pool %s while preserving URL connection options', (poolId) => {
    const { env, directoriesExist } = runSetup({ API_TEST_DB_PER_WORKER: '1', VITEST_POOL_ID: poolId });
    expect(env.DATABASE_URL).toBe(databaseUrl.replace('/borrow_return?', `/borrow_return_w${poolId}?`));
    for (const key of ['FILE_STORAGE_ROOT', 'PHOTO_STORAGE_DIR', 'PDF_STORAGE_DIR', 'CSV_DASHBOARD_STORAGE_DIR']) {
      expect(env[key]).toBe(path.join(root, `storage_w${poolId}`));
    }
    expect(env.BACKUP_STORAGE_DIR).toBe(path.join(root, `backups_w${poolId}`));
    expect(env.BACKUP_CONFIG_PATH).toBe(path.join(root, 'config', `backup.json_w${poolId}`));
    for (const key of ['SIGNAGE_RENDER_DIR', 'PDF_PAGES_DIR', 'ALERTS_DIR']) {
      expect(env[key]).toMatch(new RegExp(`_w${poolId}$`));
    }
    expect(directoriesExist).toBe(true);
  });

  it.each([
    { VITEST_POOL_ID: '2' },
    { API_TEST_DB_PER_WORKER: '0', VITEST_POOL_ID: '2' },
    { API_TEST_DB_PER_WORKER: '1' },
  ])('leaves existing settings untouched without both opt-in and pool ID: %j', (overrides) => {
    const { env } = runSetup(overrides);
    expect(env.DATABASE_URL).toBe(databaseUrl);
    expect(env.FILE_STORAGE_ROOT).toBe(path.join(root, 'storage'));
    expect(env.BACKUP_CONFIG_PATH).toBe(path.join(root, 'config', 'backup.json'));
    expect(env.SIGNAGE_RENDER_DIR).toBeUndefined();
  });

  it('does not suffix the database twice when setup runs again in the same worker', () => {
    const { env } = runSetup({ API_TEST_DB_PER_WORKER: '1', VITEST_POOL_ID: '1',
      DATABASE_URL: databaseUrl.replace('/borrow_return?', '/borrow_return_w1?') });
    expect(new URL(env.DATABASE_URL).pathname).toBe('/borrow_return_w1');
  });
});
