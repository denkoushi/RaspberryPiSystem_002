import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { BackupConfigLoader } from '../backup-config.loader';

const tmpDir = () => path.join(os.tmpdir(), `backup-config-loader-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);

describe('BackupConfigLoader.save legacy keys cleanup', () => {
  let workDir: string;
  let configPath: string;

  afterEach(async () => {
    delete process.env.BACKUP_CONFIG_PATH;
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should prune legacy Dropbox keys when options.dropbox has values (prefer new structure)', async () => {
    workDir = tmpDir();
    configPath = path.join(workDir, 'backup.json');
    await fs.mkdir(workDir, { recursive: true });
    // テスト実行コマンドでBACKUP_CONFIG_PATHが設定されている場合があるため、ここで確実に上書きする
    process.env.BACKUP_CONFIG_PATH = configPath;
    BackupConfigLoader.setConfigPath(configPath);

    await BackupConfigLoader.save({
      storage: {
        provider: 'dropbox',
        options: {
          basePath: '/unit-test',
          dropbox: {
            accessToken: 'NEW_DROPBOX_ACCESS',
            refreshToken: 'NEW_DROPBOX_REFRESH',
            appKey: 'NEW_APP_KEY',
            appSecret: 'NEW_APP_SECRET'
          },
          // legacy (conflicting)
          accessToken: 'OLD_DROPBOX_ACCESS',
          refreshToken: 'OLD_DROPBOX_REFRESH',
          appKey: 'OLD_APP_KEY',
          appSecret: 'OLD_APP_SECRET'
        }
      },
      targets: [
        { kind: 'file', source: '/tmp/source.txt', schedule: '0 4 * * *', enabled: true }
      ]
    });

    const saved = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(saved.storage.options.dropbox.accessToken).toBe('NEW_DROPBOX_ACCESS');
    expect(saved.storage.options.dropbox.refreshToken).toBe('NEW_DROPBOX_REFRESH');

    // legacy keys removed
    expect(saved.storage.options.accessToken).toBeUndefined();
    expect(saved.storage.options.refreshToken).toBeUndefined();
    expect(saved.storage.options.appKey).toBeUndefined();
    expect(saved.storage.options.appSecret).toBeUndefined();
  });

  it('should not prune legacy Dropbox accessToken when options.dropbox.accessToken is missing', async () => {
    workDir = tmpDir();
    configPath = path.join(workDir, 'backup.json');
    await fs.mkdir(workDir, { recursive: true });
    process.env.BACKUP_CONFIG_PATH = configPath;
    BackupConfigLoader.setConfigPath(configPath);

    await BackupConfigLoader.save({
      storage: {
        provider: 'dropbox',
        options: {
          dropbox: {
            // accessToken intentionally missing
            appKey: 'NEW_APP_KEY'
          },
          // legacy should be kept as a backward-compat safety net
          accessToken: 'OLD_DROPBOX_ACCESS',
          appKey: 'OLD_APP_KEY'
        }
      },
      targets: [
        { kind: 'file', source: '/tmp/source.txt', schedule: '0 4 * * *', enabled: true }
      ]
    });

    const saved = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(saved.storage.options.dropbox.appKey).toBe('NEW_APP_KEY');

    // accessToken stays because new structure lacks it
    expect(saved.storage.options.accessToken).toBe('OLD_DROPBOX_ACCESS');
    // appKey legacy is removed because new structure has appKey
    expect(saved.storage.options.appKey).toBeUndefined();
  });

  it('should prune legacy Gmail keys when options.gmail has values, without touching dropbox legacy accessToken', async () => {
    workDir = tmpDir();
    configPath = path.join(workDir, 'backup.json');
    await fs.mkdir(workDir, { recursive: true });
    process.env.BACKUP_CONFIG_PATH = configPath;
    BackupConfigLoader.setConfigPath(configPath);

    await BackupConfigLoader.save({
      storage: {
        provider: 'gmail',
        options: {
          gmail: {
            clientId: 'NEW_GMAIL_CLIENT_ID',
            clientSecret: 'NEW_GMAIL_CLIENT_SECRET',
            redirectUri: 'http://localhost/callback',
            accessToken: 'NEW_GMAIL_ACCESS',
            refreshToken: 'NEW_GMAIL_REFRESH',
            subjectPattern: '[CSV Import] employees',
            fromEmail: 'noreply@example.com'
          },
          // legacy gmail keys
          clientId: 'OLD_GMAIL_CLIENT_ID',
          clientSecret: 'OLD_GMAIL_CLIENT_SECRET',
          redirectUri: 'http://old/callback',
          subjectPattern: 'old-subject',
          fromEmail: 'old@example.com',
          gmailAccessToken: 'OLD_GMAIL_ACCESS',
          gmailRefreshToken: 'OLD_GMAIL_REFRESH',
          // dropbox legacy key (must not be touched by gmail cleanup alone)
          accessToken: 'LEGACY_DROPBOX_ACCESS_SHOULD_REMAIN'
        }
      },
      targets: [
        { kind: 'file', source: '/tmp/source.txt', schedule: '0 4 * * *', enabled: true }
      ]
    });

    const saved = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    expect(saved.storage.options.gmail.clientId).toBe('NEW_GMAIL_CLIENT_ID');
    expect(saved.storage.options.gmail.accessToken).toBe('NEW_GMAIL_ACCESS');

    // legacy gmail keys removed
    expect(saved.storage.options.clientId).toBeUndefined();
    expect(saved.storage.options.clientSecret).toBeUndefined();
    expect(saved.storage.options.redirectUri).toBeUndefined();
    expect(saved.storage.options.subjectPattern).toBeUndefined();
    expect(saved.storage.options.fromEmail).toBeUndefined();
    expect(saved.storage.options.gmailAccessToken).toBeUndefined();
    expect(saved.storage.options.gmailRefreshToken).toBeUndefined();

    // legacy dropbox key remains (gmail cleanup should not remove it)
    expect(saved.storage.options.accessToken).toBe('LEGACY_DROPBOX_ACCESS_SHOULD_REMAIN');
  });
});

