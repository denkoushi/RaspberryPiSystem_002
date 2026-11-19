import { describe, expect, it, vi } from 'vitest';

import { buildProcedureManualMime, procedureManualGmailSender } from '../procedure-manual-gmail-send.js';

const { sendMessageFromMimeUpload } = vi.hoisted(() => ({ sendMessageFromMimeUpload: vi.fn() }));
vi.mock('../../backup/backup-config.loader.js', () => ({
  BackupConfigLoader: { load: vi.fn(async () => ({})) },
}));
vi.mock('../../gmail/gmail-api-client.factory.js', () => ({
  resolveGmailApiClientFromBackupConfig: vi.fn(async () => ({ sendMessageFromMimeUpload })),
}));

const mail = {
  to: 'worker.001@example.com',
  subject: '組立要領書（最新版）'.repeat(10),
  filename: `${'組立要領書・部材A_'.repeat(10)}.pdf`,
  pdf: Buffer.from('test attachment bytes'.repeat(12)),
};

const beforeSend = vi.fn(async () => undefined);

describe('procedure manual Gmail MIME', () => {
  it('round-trips folded UTF-8 subject, filename and PDF attachment', () => {
    const mime = buildProcedureManualMime(mail);
    const encodedWords = Array.from(mime.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g));
    expect(encodedWords.length).toBeGreaterThan(1);
    expect(encodedWords.every(([word]) => word.length <= 75)).toBe(true);
    expect(encodedWords.map(([, word]) => Buffer.from(word!, 'base64').toString('utf8')).join('')).toBe(mail.subject);

    const segments = Array.from(mime.matchAll(/\r\n filename\*(\d+)\*=(?:UTF-8'')?([^;\r\n]+)/g));
    expect(segments.map(([, index]) => Number(index))).toEqual(segments.map((_, index) => index));
    expect(decodeURIComponent(segments.map(([, , bytes]) => bytes).join(''))).toBe(mail.filename);

    const attachment = mime.match(/Content-Type: application\/pdf[^]*?\r\n\r\n([\s\S]+?)\r\n--/)?.[1] ?? '';
    expect(attachment.split('\r\n').every((line) => line.length <= 76)).toBe(true);
    expect(Buffer.from(attachment, 'base64')).toEqual(mail.pdf);
    expect(mime).toContain(`\r\nTo: ${mail.to}\r\n`);
  });

  it.each(['to', 'subject', 'filename'] as const)('rejects raw control characters in %s', (field) => {
    expect(() => buildProcedureManualMime({ ...mail, [field]: 'value\r\nBcc: other@example.com' })).toThrow('Invalid mail header');
  });

  it('calls the media upload method and keeps the Gmail message id', async () => {
    sendMessageFromMimeUpload.mockResolvedValueOnce({ id: 'sent-id' });
    await expect(procedureManualGmailSender.send(mail, beforeSend)).resolves.toEqual({ id: 'sent-id' });
    expect(sendMessageFromMimeUpload).toHaveBeenLastCalledWith(expect.stringContaining('Content-Type: application/pdf'), beforeSend);
  });

  it('returns the existing Gmail permission error for an insufficient scope', async () => {
    sendMessageFromMimeUpload.mockRejectedValueOnce(new Error('Forbidden', {
      cause: { response: { status: 403, data: { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } } } },
    }));
    await expect(procedureManualGmailSender.send(mail, beforeSend)).rejects.toMatchObject({
      statusCode: 400, code: 'GMAIL_SCOPE_INSUFFICIENT',
    });
  });

  it('returns a send failure for a policy rejection with the same HTTP status', async () => {
    sendMessageFromMimeUpload.mockRejectedValueOnce(new Error('403 Forbidden: domain policy'));
    await expect(procedureManualGmailSender.send(mail, beforeSend)).rejects.toMatchObject({
      statusCode: 500, code: 'GMAIL_SEND_FAILED',
    });
  });
});
