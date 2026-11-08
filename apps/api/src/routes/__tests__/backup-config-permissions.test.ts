import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe('backup config file permissions', () => {
  it.each([false, true])('saves valid JSON privately (existing file: %s)', async (existing) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-config-mode-'));
    directories.push(directory);
    const configPath = path.join(directory, 'backup.json');
    if (existing) await fs.writeFile(configPath, '{}', { mode: 0o644 });
    vi.stubEnv('BACKUP_CONFIG_PATH', configPath);
    BackupConfigLoader.setConfigPath(configPath);
    await BackupConfigLoader.save({ storage: { provider: 'local' }, targets: [] });
    expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toMatchObject({ storage: { provider: 'local' }, targets: [] });
    expect(await fs.readdir(directory)).toEqual(['backup.json']);
  });
});
