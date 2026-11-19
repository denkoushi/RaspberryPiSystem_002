import { randomUUID } from 'node:crypto';

import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { wrapBase64ForRfc2045 } from '../reports/loan-report/loan-report-email-mime.js';

type PdfMail = {
  to: string;
  subject: string;
  filename: string;
  pdf: Buffer;
};

export interface ProcedureManualMailSender {
  send(mail: PdfMail, beforeSend: () => Promise<void>): Promise<{ id: string }>;
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

export function buildProcedureManualMime({ to, subject, filename, pdf }: PdfMail): string {
  if ([to, subject, filename].some((header) => /[\u0000-\u001f\u007f]/.test(header))) {
    throw new Error('Invalid mail header');
  }

  const boundary = randomUUID();
  // Keep UTF-8 characters whole across folded encoded words and filename continuations.
  const subjectWords = splitHeader(subject, 42, (char) => Buffer.from(char).toString('latin1'))
    .map((part) => `=?UTF-8?B?${Buffer.from(part, 'latin1').toString('base64')}?=`);
  const filenameParts = splitHeader(filename, 48, (char) =>
    Array.from(Buffer.from(char), (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('')
  ).map((part, index) => ` filename*${index}*=${index === 0 ? "UTF-8''" : ''}${part}`);

  return [
    'MIME-Version: 1.0',
    `To: ${to}`,
    `Subject: ${subjectWords.join('\r\n ')}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('要領書の控えを添付しました。\r\n').toString('base64'),
    `--${boundary}`,
    'Content-Type: application/pdf',
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
  async send(mail, beforeSend) {
    try {
      const config = await BackupConfigLoader.load();
      const client = await resolveGmailApiClientFromBackupConfig(config, { allowWait: false });
      return await client.sendMessageFromMimeUpload(buildProcedureManualMime(mail), beforeSend);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error ? error.cause : undefined;
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
      throw new ApiError(500, 'Gmail 送信に失敗しました', undefined, 'GMAIL_SEND_FAILED');
    }
  },
};
