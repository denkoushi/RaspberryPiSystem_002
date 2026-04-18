import { ApiError } from '../../../lib/errors.js';
import { BackupConfigLoader } from '../../backup/backup-config.loader.js';
import { resolveGmailApiClientFromBackupConfig } from '../../gmail/gmail-api-client.factory.js';
import type { LoanReportViewModel } from './loan-report.types.js';

function buildAttachmentFilename(report: LoanReportViewModel): string {
  const slug = report.key;
  const id = report.reportId.replace(/[^a-zA-Z0-9-_]+/g, '_');
  return `loan-report_${slug}_${id}.html`;
}

function wrapBase64(base64: string): string {
  return base64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

export function buildLoanReportDraftMime(params: {
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

  const textB64 = wrapBase64(Buffer.from(params.textBody, 'utf8').toString('base64'));
  const htmlInlineB64 = wrapBase64(Buffer.from(params.htmlBody, 'utf8').toString('base64'));
  const attachmentB64 = wrapBase64(Buffer.from(params.attachmentHtml, 'utf8').toString('base64'));

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

export class LoanReportGmailDraftService {
  async createDraft(params: {
    reportModel: LoanReportViewModel;
    htmlDocument: string;
    subject: string;
    to?: string;
  }): Promise<{ draftId: string; messageId?: string }> {
    const config = await BackupConfigLoader.load();
    const client = await resolveGmailApiClientFromBackupConfig(config);

    const attachmentName = buildAttachmentFilename(params.reportModel);
    const textBody = [
      '貸出レポート（HTML）を添付しました。',
      `カテゴリ: ${params.reportModel.category}`,
      `レポートID: ${params.reportModel.reportId}`,
      '',
      '※ 本メールは管理コンソールから作成された下書きです。',
    ].join('\n');

    const htmlBody = `<p>貸出レポート（HTML）を添付しました。</p><p>カテゴリ: ${params.reportModel.category}<br/>レポートID: ${params.reportModel.reportId}</p>`;

    const raw = buildLoanReportDraftMime({
      to: params.to,
      subject: params.subject,
      textBody,
      htmlBody,
      attachmentName,
      attachmentHtml: params.htmlDocument,
    });

    try {
      const created = await client.createDraftFromRawMime(raw);
      return { draftId: created.id, messageId: created.messageId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('insufficient authentication scopes') || msg.includes('403')) {
        throw new ApiError(
          400,
          'Gmail の権限が不足しています。gmail.compose を含むスコープで Gmail 再認可が必要です。',
          { detail: msg },
          'GMAIL_SCOPE_INSUFFICIENT'
        );
      }
      throw new ApiError(500, 'Gmail 下書きの作成に失敗しました', { detail: msg }, 'GMAIL_DRAFT_FAILED');
    }
  }
}
