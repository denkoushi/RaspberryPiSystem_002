import type { LoanReportViewModel } from './loan-report.types.js';

export type LoanReportMailKind = 'draft' | 'send';

export function buildLoanReportAttachmentFilename(report: LoanReportViewModel): string {
  const slug = report.key;
  const id = report.reportId.replace(/[^a-zA-Z0-9-_]+/g, '_');
  return `loan-report_${slug}_${id}.html`;
}

/** RFC 2045 風の base64 行折り返し（Gmail raw メッセージ互換） */
export function wrapBase64ForRfc2045(base64: string): string {
  return base64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

export function buildLoanReportMailBodies(
  reportModel: LoanReportViewModel,
  kind: LoanReportMailKind
): { textBody: string; htmlBody: string } {
  const footer =
    kind === 'draft'
      ? '※ 本メールは管理コンソールから作成された下書きです。'
      : '※ 本メールは管理コンソールから送信されました。';

  const textBody = [
    '貸出レポート（HTML）を添付しました。',
    `カテゴリ: ${reportModel.category}`,
    `レポートID: ${reportModel.reportId}`,
    '',
    footer,
  ].join('\n');

  const htmlBody = `<p>貸出レポート（HTML）を添付しました。</p><p>カテゴリ: ${reportModel.category}<br/>レポートID: ${reportModel.reportId}</p><p>${footer}</p>`;

  return { textBody, htmlBody };
}

/**
 * multipart/mixed（alternative 本文 + HTML 添付）の raw MIME。
 * 下書き・即時送信で同一形式を再利用する。
 */
export function buildLoanReportMultipartMime(params: {
  to?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachmentName: string;
  attachmentHtml: string;
}): string {
  const boundary = `b=${Math.random().toString(16).slice(2)}_${Date.now()}`;
  const nl = '\r\n';

  const toLine = params.to?.trim() ? `To: ${params.to.trim()}` : 'To: ';
  const subject = `Subject: =?UTF-8?B?${Buffer.from(params.subject, 'utf8').toString('base64')}?=`;

  const textB64 = wrapBase64ForRfc2045(Buffer.from(params.textBody, 'utf8').toString('base64'));
  const htmlInlineB64 = wrapBase64ForRfc2045(Buffer.from(params.htmlBody, 'utf8').toString('base64'));
  const attachmentB64 = wrapBase64ForRfc2045(Buffer.from(params.attachmentHtml, 'utf8').toString('base64'));

  return [
    `MIME-Version: 1.0`,
    toLine,
    subject,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}_alt"`,
    '',
    `--${boundary}_alt`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    textB64,
    '',
    `--${boundary}_alt`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    htmlInlineB64,
    '',
    `--${boundary}_alt--`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Disposition: attachment; filename="${params.attachmentName}"`,
    `Content-Transfer-Encoding: base64`,
    '',
    attachmentB64,
    '',
    `--${boundary}--`,
    '',
  ].join(nl);
}
