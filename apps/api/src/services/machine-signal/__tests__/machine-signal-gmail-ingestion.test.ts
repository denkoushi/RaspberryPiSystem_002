import { describe, expect, it, vi } from 'vitest';

import type { BackupConfig } from '../../backup/backup-config.js';
import type { GmailMessage } from '../../backup/gmail-api-client.js';
import {
  hasGmailCredentials,
  MACHINE_SIGNAL_GMAIL_QUERY,
  MachineSignalGmailIngestionService,
  type MachineSignalGmailPort,
} from '../machine-signal-gmail-ingestion.service.js';
import type { SignalReportImportSummary } from '../signal-report-import.service.js';

const config = { storage: { provider: 'gmail', options: {} } } as unknown as BackupConfig;

const message = (id: string, names: string[]): GmailMessage => ({
  id,
  threadId: id,
  labelIds: [],
  snippet: '',
  internalDateMs: 0,
  payload: {
    mimeType: 'multipart/mixed',
    parts: names.map((filename, index) => ({
      filename,
      mimeType: 'text/csv',
      headers: [{ name: 'Content-Disposition', value: 'attachment' }],
      body: { attachmentId: `${id}-att-${index}` },
    })),
  } as GmailMessage['payload'],
});

const run = (overrides: Partial<SignalReportImportSummary>): SignalReportImportSummary => ({
  runId: 'run-1',
  status: 'SUCCESS',
  fileCount: 2,
  importedCount: 2,
  failedCount: 0,
  failures: [],
  reportDates: ['2026-10-01'],
  ...overrides,
});

function setup(options: { messages: GmailMessage[]; failedMessageIds?: string[] }) {
  const gmail: MachineSignalGmailPort = {
    searchMessagesLimited: vi.fn().mockResolvedValue(options.messages.map((item) => item.id)),
    getMessage: vi.fn(async (id: string) => options.messages.find((item) => item.id === id) as GmailMessage),
    getAttachment: vi.fn(async (_id: string, attachmentId: string) => Buffer.from(attachmentId)),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    trashMessage: vi.fn().mockResolvedValue(undefined),
  };
  const importFiles = vi.fn().mockResolvedValue(run({}));
  const db = {
    machineSignalImportRun: {
      findFirst: vi.fn(async ({ where }: { where: { gmailMessageId: string } }) =>
        options.failedMessageIds?.includes(where.gmailMessageId) ? { id: 'old' } : null
      ),
    },
  };
  const service = new MachineSignalGmailIngestionService(async () => gmail, importFiles, db as never);
  return { gmail, importFiles, service };
}

describe('MachineSignalGmailIngestionService', () => {
  it('imports every CSV attachment of the mail, then marks it read and trashes it', async () => {
    const { gmail, importFiles, service } = setup({
      messages: [message('m1', ['DailySummary_Signal1_20261001.csv', 'DailySummary_Signal2_20261001.csv', 'logo.png'])],
    });

    const summary = await service.runOnce({ config, allowWait: false });

    expect(gmail.searchMessagesLimited).toHaveBeenCalledWith(MACHINE_SIGNAL_GMAIL_QUERY, 3);
    expect(gmail.getAttachment).toHaveBeenCalledTimes(2);
    expect(importFiles).toHaveBeenCalledWith(
      [
        { fileName: 'DailySummary_Signal1_20261001.csv', content: Buffer.from('m1-att-0') },
        { fileName: 'DailySummary_Signal2_20261001.csv', content: Buffer.from('m1-att-1') },
      ],
      { source: 'GMAIL', gmailMessageId: 'm1' }
    );
    expect(gmail.markAsRead).toHaveBeenCalledWith('m1');
    expect(gmail.trashMessage).toHaveBeenCalledWith('m1');
    expect(summary).toMatchObject({ scanned: 1, processed: 1, skipped: 0 });
  });

  it('leaves a mail in the inbox when none of its attachments could be imported', async () => {
    const { gmail, importFiles, service } = setup({ messages: [message('m1', ['other.csv'])] });
    importFiles.mockResolvedValue(run({ status: 'FAILED', importedCount: 0, failedCount: 1, fileCount: 1 }));

    await service.runOnce({ config, allowWait: false });

    expect(gmail.markAsRead).not.toHaveBeenCalled();
    expect(gmail.trashMessage).not.toHaveBeenCalled();
  });

  it('does not download a mail again on schedule after it failed once', async () => {
    const { gmail, importFiles, service } = setup({ messages: [message('m1', ['other.csv'])], failedMessageIds: ['m1'] });

    const summary = await service.runOnce({ config, allowWait: false });

    expect(gmail.getMessage).not.toHaveBeenCalled();
    expect(importFiles).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('retries a failed mail when an admin runs the import by hand', async () => {
    const { gmail, service } = setup({
      messages: [message('m1', ['DailySummary_Signal1_20261001.csv'])],
      failedMessageIds: ['m1'],
    });

    await service.runOnce({ config, allowWait: true });

    expect(gmail.trashMessage).toHaveBeenCalledWith('m1');
  });

  it('keeps the mail when the import throws, so the next run can retry', async () => {
    const { gmail, importFiles, service } = setup({ messages: [message('m1', ['DailySummary_Signal1_20261001.csv'])] });
    importFiles.mockRejectedValue(new Error('db down'));

    await expect(service.runOnce({ config, allowWait: false })).rejects.toThrow('db down');
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    // 失敗後も次の実行を受け付ける。
    importFiles.mockResolvedValue(run({}));
    await expect(service.runOnce({ config, allowWait: false })).resolves.toMatchObject({ processed: 1 });
  });
});

describe('hasGmailCredentials', () => {
  it('is false until both the client and a refresh token are stored', () => {
    expect(hasGmailCredentials(config)).toBe(false);
    expect(
      hasGmailCredentials({
        storage: { provider: 'gmail', options: { gmail: { clientId: 'id', refreshToken: 'token' } } },
      } as unknown as BackupConfig)
    ).toBe(true);
  });
});
