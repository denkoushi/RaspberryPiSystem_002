import { randomUUID } from 'node:crypto';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { GmailRateLimitedDeferredError, GmailRequestGateService } from '../backup/gmail-request-gate.service.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { wrapBase64ForRfc2045 } from '../reports/loan-report/loan-report-email-mime.js';

type PdfMail = {
  to: string;
  subject: string;
  filename: string;
  pdf: Buffer;
};

export interface ProcedureManualMailSender {
  assertAvailable(): Promise<void>;
  send(mail: PdfMail, beforeSend: () => Promise<void>): Promise<{ id: string }>;
}

const uploadTimeoutMs = 60_000;
const gmailPhaseTimeoutMs = 80_000;
const gmailGate = new GmailRequestGateService();

function gmailDeferredError(): ApiError {
  return new ApiError(503, 'Gmail は送信待機中です', undefined, 'PROCEDURE_MAIL_GMAIL_DEFERRED');
}

function resultUnknownError(): ApiError {
  return new ApiError(504, '送信結果を確認できませんでした。メールが届いたか確認してください', undefined, 'PROCEDURE_MAIL_RESULT_UNKNOWN');
}

function splitHeader(value: string, maxLength: number, encode: (char: string) => string): string[] {
  const parts: string[] = [];
  let part = '';
  for (const char of value) {
    const encoded = encode(char);
    if (part.length + encoded.length > maxLength) {
      parts.push(part);
      part = '';
    }
    part += encoded;
  }
  parts.push(part);
  return parts;
}

function encodeHeaderWords(value: string): string {
  return splitHeader(value, 42, (char) => Buffer.from(char).toString('latin1'))
    .map((part) => `=?UTF-8?B?${Buffer.from(part, 'latin1').toString('base64')}?=`).join('\r\n ');
}

export function buildProcedureManualMime({ to, subject, filename, pdf }: PdfMail): string {
  // eslint-disable-next-line no-control-regex -- reject CR/LF and other control characters in headers
  if ([to, subject, filename].some((header) => /[\u0000-\u001f\u007f]/.test(header))) {
    throw new Error('Invalid mail header');
  }

  const boundary = randomUUID();
  // Keep UTF-8 characters whole across folded encoded words and filename continuations.
  const filenameParts = splitHeader(filename, 48, (char) =>
    Array.from(Buffer.from(char), (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('')
  ).map((part, index) => ` filename*${index}*=${index === 0 ? "UTF-8''" : ''}${part}`);

  return [
    'MIME-Version: 1.0',
    `To: ${to}`,
    `Subject: ${encodeHeaderWords(subject)}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('要領書の控えを添付しました。\r\n').toString('base64'),
    `--${boundary}`,
    'Content-Type: application/pdf;',
    ` name="${encodeHeaderWords(filename)}"`,
    'Content-Disposition: attachment;',
    filenameParts.join(';\r\n'),
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64ForRfc2045(pdf.toString('base64')),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export const procedureManualGmailSender: ProcedureManualMailSender = {
  async assertAvailable() {
    if ((await gmailGate.getStateSnapshot()).state === 'COOLDOWN') throw gmailDeferredError();
  },

  async send(mail, beforeSend) {
    const controller = new AbortController();
    const timeoutError = resultUnknownError();
    const deadline = performance.now() + gmailPhaseTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, gmailPhaseTimeoutMs);
    });

    try {
      const upload = BackupConfigLoader.load().then(async (config) => {
        const client = await resolveGmailApiClientFromBackupConfig(config, { allowWait: false });
        controller.signal.throwIfAborted();
        return client.sendMessageFromMimeUpload(buildProcedureManualMime(mail), async () => {
          await beforeSend();
          if (performance.now() >= deadline) throw timeoutError;
        }, { timeoutMs: uploadTimeoutMs, signal: controller.signal });
      });
      return await Promise.race([upload, timeout]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof GmailRateLimitedDeferredError) throw gmailDeferredError();
      const cause = error instanceof Error ? error.cause : undefined;
      const { code, status } = (error as { code?: unknown; status?: unknown } | null) ?? {};
      // Gaxios uses node-fetch in Node, which wraps a timeout as a nested AbortError.
      const fetchError = cause instanceof Error ? cause.cause : undefined;
      if (code === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || status === 504
        || (fetchError instanceof Error && fetchError.name === 'AbortError')) {
        throw resultUnknownError();
      }
      const message = error instanceof Error ? error.message : String(error);
      const apiError = (cause as {
        response?: { data?: { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] } } };
      } | undefined)?.response?.data?.error;
      if (/insufficient authentication scopes|insufficient permission/i.test(message)
        || apiError?.errors?.some(({ reason }) => reason === 'insufficientPermissions')
        || apiError?.details?.some(({ reason }) => reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
        throw new ApiError(
          400,
          'Gmail の権限が不足しています。gmail.send / gmail.compose を含むスコープで Gmail 再認可が必要です。',
          undefined,
          'GMAIL_SCOPE_INSUFFICIENT'
        );
      }
      // Log only Gmail's status and reason; the request error can carry the MIME body and OAuth headers.
      logger.warn({
        gmailStatus: status,
        gmailCode: code,
        gmailReasons: [...(apiError?.errors ?? []), ...(apiError?.details ?? [])].map(({ reason }) => reason),
        gmailMessage: message.slice(0, 300),
      }, '[ProcedureManualMail] Gmail send failed');
      throw new ApiError(500, 'Gmail 送信に失敗しました', undefined, 'GMAIL_SEND_FAILED');
    } finally {
      clearTimeout(timer);
    }
  },
};
