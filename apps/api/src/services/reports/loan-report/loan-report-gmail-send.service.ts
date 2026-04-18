import { logger } from '../../../lib/logger.js';
import { ApiError } from '../../../lib/errors.js';
import { BackupConfigLoader } from '../../backup/backup-config.loader.js';
import { resolveGmailApiClientFromBackupConfig } from '../../gmail/gmail-api-client.factory.js';
import {
  buildLoanReportAttachmentFilename,
  buildLoanReportMailBodies,
  buildLoanReportMultipartMime,
} from './loan-report-email-mime.js';
import type { LoanReportViewModel } from './loan-report.types.js';

export class LoanReportGmailSendService {
  async sendMessage(params: {
    reportModel: LoanReportViewModel;
    htmlDocument: string;
    subject: string;
    to: string;
  }): Promise<{ messageId: string }> {
    const config = await BackupConfigLoader.load();
    const client = await resolveGmailApiClientFromBackupConfig(config);

    const attachmentName = buildLoanReportAttachmentFilename(params.reportModel);
    const { textBody, htmlBody } = buildLoanReportMailBodies(params.reportModel, 'send');

    const raw = buildLoanReportMultipartMime({
      to: params.to,
      subject: params.subject,
      textBody,
      htmlBody,
      attachmentName,
      attachmentHtml: params.htmlDocument,
    });

    try {
      const sent = await client.sendMessageFromRawMime(raw);
      logger?.info(
        { messageId: sent.id, reportId: params.reportModel.reportId },
        '[LoanReportGmailSendService] Loan report email sent'
      );
      return { messageId: sent.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('insufficient authentication scopes') || msg.includes('403')) {
        throw new ApiError(
          400,
          'Gmail の権限が不足しています。gmail.send / gmail.compose を含むスコープで Gmail 再認可が必要です。',
          { detail: msg },
          'GMAIL_SCOPE_INSUFFICIENT'
        );
      }
      throw new ApiError(500, 'Gmail 送信に失敗しました', { detail: msg }, 'GMAIL_SEND_FAILED');
    }
  }
}
