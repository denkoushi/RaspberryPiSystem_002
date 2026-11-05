import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { backupConfigChange: { create: vi.fn() } } }));
vi.mock('../../../services/backup/backup-scheduler.js', () => ({ getBackupScheduler: () => ({ reload: vi.fn() }) }));
vi.mock('../../../services/kiosk-documents/kiosk-document-gmail.scheduler.js', () => ({ getKioskDocumentGmailScheduler: () => ({ reload: vi.fn() }) }));

import { BackupConfigLoader } from '../../../services/backup/backup-config.loader.js';
import { registerBackupConfigReadRoutes } from '../config-read.js';
import { registerBackupConfigWriteRoutes } from '../config-write.js';

const secrets = {
  dropbox: { appSecret: '${TEST_BACKUP_SECRET}', refreshToken: 'db-refresh', accessToken: 'db-access', appKey: '${TEST_BACKUP_SECRET}' },
  gmail: { clientSecret: 'gmail-secret', refreshToken: '${TEST_BACKUP_SECRET}', accessToken: 'gmail-access' },
  accessToken: 'legacy-access', refreshToken: 'legacy-refresh', appSecret: 'legacy-secret',
  clientSecret: 'legacy-client', gmailAccessToken: 'legacy-gmail-access', gmailRefreshToken: 'legacy-gmail-refresh',
};

describe('backup config secrets', () => {
  let app: ReturnType<typeof Fastify>;
  let directory: string;
  let configPath: string;
  const readFile = async () => JSON.parse(await fs.readFile(configPath, 'utf8'));
  const headers = () => ({ authorization: `Bearer ${jwt.sign({ sub: 'admin', username: 'admin', role: 'ADMIN', mfaEnabled: true }, process.env.JWT_ACCESS_SECRET!)}` });
  const get = async () => {
    const response = await app.inject({ method: 'GET', url: '/backup/config', headers: headers() });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  const put = (payload: object) => app.inject({ method: 'PUT', url: '/backup/config', payload, headers: headers() });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-secrets-'));
    configPath = path.join(directory, 'backup.json');
    vi.stubEnv('BACKUP_CONFIG_PATH', configPath);
    vi.stubEnv('TEST_BACKUP_SECRET', 'resolved-test-secret');
    await fs.writeFile(configPath, JSON.stringify({ storage: { provider: 'dropbox', options: secrets }, targets: [{ kind: 'file', source: '/tmp/a', enabled: true }] }));
    app = Fastify();
    await registerBackupConfigReadRoutes(app);
    await registerBackupConfigWriteRoutes(app);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('redacts every nested and legacy secret, including env and literal values', async () => {
    const config = await get();
    for (const [key, value] of Object.entries(secrets)) {
      if (typeof value === 'object') {
        for (const secret of Object.keys(value).filter((field) => field !== 'appKey')) {
          expect(config.storage.options[key][secret]).toBe('[REDACTED]');
        }
      } else expect(config.storage.options[key]).toBe('[REDACTED]');
    }
  });

  it('round trips GET through PUT without writing env values or redaction sentinels', async () => {
    expect((await put(await get())).statusCode).toBe(200);
    const saved = await readFile();
    expect(saved.storage.options.dropbox.appSecret).toBe('${TEST_BACKUP_SECRET}');
    expect(saved.storage.options.gmail.refreshToken).toBe('${TEST_BACKUP_SECRET}');
    expect(saved.storage.options.dropbox.appKey).toBe('${TEST_BACKUP_SECRET}');
    expect(saved.storage.options.gmail.clientSecret).toBe('gmail-secret');
    expect(JSON.stringify(saved)).not.toContain('resolved-test-secret');
    expect(JSON.stringify(saved)).not.toContain('[REDACTED]');
  });

  it.each(['fields', 'provider', 'options'])('restores undefined secrets when omitting %s', async (omitted) => {
    const config = await get();
    if (omitted === 'options') delete config.storage.options;
    else if (omitted === 'provider') delete config.storage.options.dropbox;
    else delete config.storage.options.dropbox.appSecret;
    expect((await put(config)).statusCode).toBe(200);
    expect((await readFile()).storage.options.dropbox.appSecret).toBe('${TEST_BACKUP_SECRET}');
  });

  it('keeps the whole previous namespace when it is omitted', async () => {
    const before = (await readFile()).storage.options.dropbox;
    const config = await get();
    delete config.storage.options.dropbox;
    expect((await put(config)).statusCode).toBe(200);
    expect((await readFile()).storage.options.dropbox).toEqual(before);
  });

  it.each(['new-secret', ''])('saves an explicit new secret or empty string (%j)', async (value) => {
    const config = await get();
    config.storage.options.dropbox.appSecret = value;
    expect((await put(config)).statusCode).toBe(200);
    expect((await readFile()).storage.options.dropbox.appSecret).toBe(value);
  });

  it('preserves env references through target add, update, template add and delete', async () => {
    const requests = [
      { method: 'POST' as const, url: '/backup/config/targets', payload: { kind: 'file', source: '/tmp/b' } },
      { method: 'PUT' as const, url: '/backup/config/targets/0', payload: { enabled: false } },
      { method: 'POST' as const, url: '/backup/config/targets/from-template', payload: { templateId: (await app.inject({ method: 'GET', url: '/backup/config/templates', headers: headers() })).json().templates[0].id, overrides: { source: '/tmp/template' } } },
      { method: 'DELETE' as const, url: '/backup/config/targets/0' },
    ];
    for (const request of requests) {
      expect((await app.inject({ ...request, headers: headers() })).statusCode).toBe(200);
      expect((await readFile()).storage.options.dropbox.appSecret).toBe('${TEST_BACKUP_SECRET}');
    }
  });

  it('preserves normalized legacy env references and permits fresh OAuth tokens through save', async () => {
    await fs.writeFile(configPath, JSON.stringify({ storage: { provider: 'gmail', options: { accessToken: '${TEST_BACKUP_SECRET}', clientSecret: '${TEST_BACKUP_SECRET}' } }, targets: [] }));
    expect((await put(await get())).statusCode).toBe(200);
    expect((await readFile()).storage.options.gmail.accessToken).toBe('${TEST_BACKUP_SECRET}');
    const config = await BackupConfigLoader.load();
    config.storage.options!.gmail!.accessToken = 'fresh-oauth-token';
    await BackupConfigLoader.save(config);
    expect((await readFile()).storage.options.gmail.accessToken).toBe('fresh-oauth-token');
    expect((await readFile()).storage.options.gmail.clientSecret).toBe('${TEST_BACKUP_SECRET}');
  });

  it('keeps unresolved references and never saves a sentinel without a stored value', async () => {
    vi.stubEnv('TEST_BACKUP_SECRET', '');
    const config = await get();
    config.storage.options.gmail.refreshToken = '[REDACTED]';
    config.storage.options.gmail.clientSecret = '[REDACTED]';
    await fs.writeFile(configPath, JSON.stringify({ storage: { provider: 'local', options: { dropbox: { appSecret: '${TEST_BACKUP_SECRET}' } } }, targets: [] }));
    expect((await put(config)).statusCode).toBe(200);
    const saved = await readFile();
    expect(saved.storage.options.dropbox.appSecret).toBe('${TEST_BACKUP_SECRET}');
    expect(saved.storage.options.gmail.clientSecret).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('[REDACTED]');
  });
});
