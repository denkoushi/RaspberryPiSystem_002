import { describe, expect, it, vi } from 'vitest';

import { GmailRateLimitedDeferredError, GmailRequestGateService } from '../../backup/gmail-request-gate.service.js';
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
    const subject = mime.slice(mime.indexOf('Subject:'), mime.indexOf('Content-Type:'));
    const encodedWords = Array.from(subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g));
    expect(encodedWords.length).toBeGreaterThan(1);
    expect(encodedWords.every(([word]) => word.length <= 75)).toBe(true);
    expect(encodedWords.map(([, word]) => Buffer.from(word!, 'base64').toString('utf8')).join('')).toBe(mail.subject);

    const name = mime.match(/Content-Type: application\/pdf;\r\n name="([^"]+)"/)?.[1] ?? '';
    const nameWords = Array.from(name.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g));
    expect(nameWords.map(([, word]) => Buffer.from(word!, 'base64').toString('utf8')).join('')).toBe(mail.filename);
    expect(mime).not.toContain('manual.pdf');
    expect(mime).toContain('Content-Disposition: attachment;\r\n filename*0*=UTF-8\'\'');
    expect(mime).not.toMatch(/ filename="/);

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
    expect(sendMessageFromMimeUpload).toHaveBeenLastCalledWith(
      expect.stringContaining('Content-Type: application/pdf'), expect.any(Function),
      { timeoutMs: 60_000, signal: expect.any(AbortSignal) }
    );
  });

  it('detects an existing Gmail cooldown before rendering', async () => {
    const snapshot = vi.spyOn(GmailRequestGateService.prototype, 'getStateSnapshot').mockResolvedValueOnce({
      state: 'COOLDOWN', cooldownUntil: '2026-11-20T00:00:00Z', last429At: null, relockLevel: 0,
    });
    try {
      await expect(procedureManualGmailSender.assertAvailable()).rejects.toMatchObject({
        statusCode: 503, code: 'PROCEDURE_MAIL_GMAIL_DEFERRED',
      });
    } finally {
      snapshot.mockRestore();
    }
  });

  it('maps deferral discovered by the upload gate to the same 503', async () => {
    sendMessageFromMimeUpload.mockRejectedValueOnce(new GmailRateLimitedDeferredError({
      cooldownUntil: new Date('2026-11-20T00:00:00Z'), retryAfterMs: 60_000, operation: 'gmail.users.messages.send',
    }));
    await expect(procedureManualGmailSender.send(mail, beforeSend)).rejects.toMatchObject({
      statusCode: 503, code: 'PROCEDURE_MAIL_GMAIL_DEFERRED',
    });
  });

  it.each(['TimeoutError', 'ETIMEDOUT', 'ECONNABORTED'])('reports an unknown result on upload timeout (%s)', async (code) => {
    sendMessageFromMimeUpload.mockRejectedValueOnce(Object.assign(new Error('Timed out'), { code }));
    await expect(procedureManualGmailSender.send(mail, beforeSend)).rejects.toMatchObject({
      statusCode: 504, code: 'PROCEDURE_MAIL_RESULT_UNKNOWN',
    });
  });

  it('recognizes the node-fetch abort nested inside the Gaxios and client errors', async () => {
    const fetchError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    sendMessageFromMimeUpload.mockRejectedValueOnce(new Error('Failed to send message', {
      cause: new Error(fetchError.message, { cause: fetchError }),
    }));
    await expect(procedureManualGmailSender.send(mail, beforeSend)).rejects.toMatchObject({
      statusCode: 504, code: 'PROCEDURE_MAIL_RESULT_UNKNOWN',
    });
  });

  it('bounds the whole Gmail phase and aborts the upload signal', async () => {
    vi.useFakeTimers();
    try {
      sendMessageFromMimeUpload.mockImplementationOnce(() => new Promise(() => {}));
      const result = expect(procedureManualGmailSender.send(mail, beforeSend)).rejects.toMatchObject({
        statusCode: 504, code: 'PROCEDURE_MAIL_RESULT_UNKNOWN',
      });
      await vi.advanceTimersByTimeAsync(80_000);
      await result;
      expect(sendMessageFromMimeUpload.mock.lastCall?.[2].signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
