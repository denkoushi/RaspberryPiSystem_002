import { CsvImportExecutionService } from '../../imports/csv-import-execution.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../../lib/prisma.js';
import { defaultBackupConfig } from '../../backup/backup-config.js';
import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { GmailStorageProvider } from '../../backup/storage/gmail-storage.provider.js';
import { MachineSignalGmailIngestionService } from '../../machine-signal/machine-signal-gmail-ingestion.service.js';
import { AssemblyProcedureGmailImportService } from '../../assembly/assembly-procedure-gmail-import.service.js';
import { GmailSenderVerificationSession, runWithGmailSenderVerification } from '../gmail-sender-verification-session.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { alert: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) } } }));
vi.mock('../../alerts/alerts-config.js', () => ({ loadAlertsDispatcherConfig: vi.fn().mockResolvedValue({ routing: {} }), resolveRouteKey: vi.fn().mockReturnValue('ops') }));

function message(id: string, passed = true): GmailMessage {
  return { id, threadId: id, labelIds: ['INBOX', 'UNREAD'], snippet: '', internalDateMs: 1, payload: {
    headers: [
      { name: 'Subject', value: 'DocumentASM' },
      { name: 'From', value: `Private local <private@${passed ? 'thkintechs.co.jp' : 'example.com'}>` },
      { name: 'Authentication-Results', value: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass' },
    ],
    parts: [{ filename: 'valid.pdf', mimeType: 'application/pdf', body: { attachmentId: `${id}-attachment` } }],
  } };
}
function port() {
  return {
    searchMessages: vi.fn().mockResolvedValue(['bad-1', 'good', 'bad-2']),
    searchMessagesLimited: vi.fn().mockResolvedValue(['bad-1', 'good', 'bad-2']),
    searchMessagesAll: vi.fn().mockResolvedValue(['bad-1', 'good', 'bad-2']),
    getMessage: vi.fn(async (id: string) => message(id, id === 'good')),
    getAttachment: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    getFirstAttachment: vi.fn().mockResolvedValue({ buffer: Buffer.from('csv'), filename: 'valid.csv' }),
    trashMessage: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    archiveMessage: vi.fn().mockResolvedValue(undefined),
  };
}
function csv() {
  const provider = new GmailStorageProvider({ oauth2Client: new OAuth2Client(), accessToken: 'test', gmailIngestSenderPolicy: defaultBackupConfig.gmailIngestSenderPolicy });
  const gmail = port();
  gmail.getMessage.mockImplementation(async (id) => {
    const mail = message(id, id === 'good');
    mail.payload!.headers![0].value = 'CSV Import';
    return mail;
  });
  const raw = provider.getGmailApiClient();
  for (const key of Object.keys(gmail) as Array<keyof typeof gmail>) vi.spyOn(raw, key).mockImplementation(gmail[key] as never);
  return { provider, gmail };
}
const disabledConfig = { ...defaultBackupConfig, gmailIngestSenderPolicy: { allowedSenderDomains: [] } };
beforeEach(() => vi.clearAllMocks());

function expectAlert(count = 2) {
  expect(prisma.alert.create).toHaveBeenCalledTimes(1);
  expect(prisma.alert.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    type: 'gmail-sender-rejected', severity: 'WARNING', details: { count, domains: ['example.com'], disabled: false },
    deliveries: { create: expect.objectContaining({ routeKey: 'ops', status: 'PENDING' }) },
  }) });
  expect(JSON.stringify(vi.mocked(prisma.alert.create).mock.calls)).not.toContain('private');
}

describe('Gmail sender policy ingestion boundaries', () => {
  it('CSV skips rejected messages and imports verified mail with one alert', async () => {
    const { provider, gmail } = csv();
    const result = await provider.downloadAllWithMetadata('CSV Import');
    expect(result).toEqual([{ buffer: Buffer.from('csv'), messageId: 'good', messageSubject: 'CSV Import' }]);
    expect(gmail.getFirstAttachment).toHaveBeenCalledTimes(1);
    expect(gmail.getFirstAttachment).toHaveBeenCalledWith('good');
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    expect(gmail.markAsRead).not.toHaveBeenCalled();
    expect(gmail.archiveMessage).not.toHaveBeenCalled();
    expectAlert();
  });
  it.each(['trashMessage', 'markAsRead'] as const)('provider %s verifies the sender before changing mail', async (operation) => {
    const { provider, gmail } = csv();
    await expect(provider[operation]('bad-1')).rejects.toMatchObject({ name: 'GmailSenderRejectedError' });
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    expect(gmail.markAsRead).not.toHaveBeenCalled();
    await expect(provider[operation]('good')).resolves.toBeUndefined();
    expect(gmail[operation]).toHaveBeenCalledExactlyOnceWith('good');
    expect(gmail.getMessage).toHaveBeenCalledWith('bad-1');
    expect(gmail.getMessage).toHaveBeenCalledWith('good');
  });
  it('machine signals skips rejected messages and continues with verified mail', async () => {
    const gmail = port();
    gmail.getMessage.mockImplementation(async (id) => {
      const mail = message(id, id === 'good');
      mail.payload!.parts![0].filename = 'daily.csv';
      return mail;
    });
    const importFiles = vi.fn().mockResolvedValue({ importedCount: 1 });
    const service = new MachineSignalGmailIngestionService(async () => gmail, importFiles, { machineSignalImportRun: { findFirst: vi.fn().mockResolvedValue(null) } } as never);
    expect(await service.runOnce({ config: defaultBackupConfig, allowWait: false })).toMatchObject({ processed: 1, skipped: 2 });
    expect(importFiles).toHaveBeenCalledTimes(1);
    expect(gmail.getAttachment).toHaveBeenCalledTimes(1);
    expect(gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('good');
    expect(gmail.markAsRead).toHaveBeenCalledExactlyOnceWith('good');
    expectAlert();
  });
  it('assembly documents skip rejected messages and continue with verified mail', async () => {
    const gmail = port();
    const writeGmailDraft = vi.fn().mockResolvedValue({ status: 'created', document: {} });
    const service = new AssemblyProcedureGmailImportService({ loadConfig: async () => defaultBackupConfig, createMailGateway: async () => gmail, draftWriter: { writeGmailDraft } });
    expect(await service.ingest()).toMatchObject({ imported: 1, trashed: 1, failed: 0 });
    expect(writeGmailDraft).toHaveBeenCalledTimes(1);
    expect(gmail.getAttachment).toHaveBeenCalledTimes(1);
    expect(gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('good');
    expect(gmail.markAsRead).not.toHaveBeenCalled();
    expectAlert();
  });
  it.each(['csv', 'machine', 'assembly', 'schedule'] as const)('%s does not search or fetch when the allowlist is empty', async (route) => {
    const gmail = port();
    if (route === 'csv') {
      const provider = new GmailStorageProvider({ oauth2Client: new OAuth2Client(), accessToken: 'test', gmailIngestSenderPolicy: { allowedSenderDomains: [] } });
      for (const key of Object.keys(gmail) as Array<keyof typeof gmail>) vi.spyOn(provider.getGmailApiClient(), key).mockImplementation(gmail[key] as never);
      await expect(provider.downloadAllWithMetadata('CSV Import')).rejects.toThrow('No messages found');
    } else if (route === 'machine') {
      await new MachineSignalGmailIngestionService(async () => gmail).runOnce({ config: disabledConfig, allowWait: false });
    } else if (route === 'schedule') {
      const config = { ...disabledConfig, storage: { ...disabledConfig.storage, provider: 'gmail' as const } };
      await expect(new CsvImportExecutionService().execute({ config, importSchedule: { id: 'test', name: 'test', schedule: '* * * * *', enabled: true, replaceExisting: false, targets: [{ type: 'employees', source: 'CSV Import' }] } })).resolves.toEqual({});
    } else {
      await new AssemblyProcedureGmailImportService({ loadConfig: async () => disabledConfig, createMailGateway: async () => gmail, draftWriter: { writeGmailDraft: vi.fn() } }).ingest();
    }
    expect(gmail.searchMessages).not.toHaveBeenCalled();
    expect(gmail.searchMessagesLimited).not.toHaveBeenCalled();
    expect(gmail.searchMessagesAll).not.toHaveBeenCalled();
    expect(gmail.getMessage).not.toHaveBeenCalled();
    expect(gmail.getAttachment).not.toHaveBeenCalled();
    expect(gmail.getFirstAttachment).not.toHaveBeenCalled();
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
    expect(prisma.alert.create).toHaveBeenCalledWith({ data: expect.objectContaining({ details: { count: 0, domains: [], disabled: true } }) });
  });
  it('aggregates nested targets and repeated rejected IDs into one invocation alert', async () => {
    const { provider } = csv();
    await runWithGmailSenderVerification(defaultBackupConfig, async () => {
      await provider.downloadAllWithMetadata('CSV Import');
      await provider.downloadAllWithMetadata('CSV Import');
    });
    expectAlert();
  });
  it('protects direct body/attachment reads and cleanup retries, and still notifies after failure', async () => {
    const session = new GmailSenderVerificationSession(defaultBackupConfig);
    const raw = port();
    const gmail = session.wrap(raw);
    for (const operation of [() => gmail.getMessage('bad'), () => gmail.getAttachment('bad', 'id'), () => gmail.getFirstAttachment('bad'), () => gmail.trashMessage('bad'), () => gmail.markAsRead('bad'), () => gmail.archiveMessage('bad')]) {
      await expect(operation()).rejects.toMatchObject({ name: 'GmailSenderRejectedError', domain: 'example.com' });
    }
    expect(raw.getAttachment).not.toHaveBeenCalled();
    expect(raw.getFirstAttachment).not.toHaveBeenCalled();
    expect(raw.trashMessage).not.toHaveBeenCalled();
    expect(raw.markAsRead).not.toHaveBeenCalled();
    expect(raw.archiveMessage).not.toHaveBeenCalled();
    await session.notify();
    expectAlert(1);
  });
  it('does not fail ingestion when creating the rejection alert fails', async () => {
    vi.mocked(prisma.alert.create).mockRejectedValueOnce(new Error('unavailable'));
    const { provider } = csv();
    await expect(provider.downloadAllWithMetadata('CSV Import')).resolves.toHaveLength(1);
  });
});

describe('GmailSenderVerificationSession cache', () => {
  it('fetches a rejected message once and blocks later operations on it', async () => {
    const gmail = port();
    const session = new GmailSenderVerificationSession(defaultBackupConfig);
    const client = session.wrap(gmail);
    await expect(client.getMessage('bad-1')).rejects.toMatchObject({ reason: 'domain_not_allowed' });
    await expect(client.getMessage('bad-1')).rejects.toMatchObject({ reason: 'domain_not_allowed' });
    await expect(client.trashMessage('bad-1')).rejects.toMatchObject({ reason: 'domain_not_allowed' });
    await expect(client.getAttachment('bad-1', 'bad-1-attachment')).rejects.toMatchObject({ reason: 'domain_not_allowed' });
    expect(gmail.getMessage).toHaveBeenCalledTimes(1);
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    expect(gmail.getAttachment).not.toHaveBeenCalled();
    await client.getMessage('good');
    await client.markAsRead('good');
    expect(gmail.getMessage).toHaveBeenCalledTimes(2);
    expect(gmail.markAsRead).toHaveBeenCalledWith('good');
  });
});
