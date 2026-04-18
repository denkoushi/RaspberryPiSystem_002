import type { LoanReportCategoryKey, LoanReportPreviewPayload } from './loan-report.types.js';
import { LoanReportAggregateService, type LoanReportAggregateQuery } from './loan-report-aggregate.service.js';
import { LoanReportEvaluationService } from './loan-report-evaluation.service.js';
import { LoanReportHtmlRenderer } from './loan-report-html-renderer.js';
import { LoanReportGmailDraftService } from './loan-report-gmail-draft.service.js';
import { LoanReportGmailSendService } from './loan-report-gmail-send.service.js';

export class LoanReportService {
  constructor(
    private readonly aggregate = LoanReportAggregateService.createDefault(),
    private readonly evaluation = new LoanReportEvaluationService(),
    private readonly html = new LoanReportHtmlRenderer(),
    private readonly gmailDraft = new LoanReportGmailDraftService(),
    private readonly gmailSend = new LoanReportGmailSendService()
  ) {}

  static createDefault(): LoanReportService {
    return new LoanReportService();
  }

  async buildPreview(params: {
    category: LoanReportCategoryKey;
    periodFrom: Date;
    periodTo: Date;
    monthlyMonths: number;
    timeZone?: string;
    site?: string;
    author?: string;
    measuringInstrumentId?: string;
    riggingGearId?: string;
    itemId?: string;
  }): Promise<LoanReportPreviewPayload> {
    const q: LoanReportAggregateQuery = {
      category: params.category,
      periodFrom: params.periodFrom,
      periodTo: params.periodTo,
      monthlyMonths: params.monthlyMonths,
      timeZone: params.timeZone,
      measuringInstrumentId: params.measuringInstrumentId,
      riggingGearId: params.riggingGearId,
      itemId: params.itemId,
    };
    const normalized = await this.aggregate.loadNormalized(q);
    const reportModel = this.evaluation.buildViewModel({
      category: params.category,
      normalized,
      site: params.site,
      author: params.author,
    });
    const html = this.html.renderDocument(reportModel);
    return { reportModel, html };
  }

  async createGmailDraft(params: {
    category: LoanReportCategoryKey;
    periodFrom: Date;
    periodTo: Date;
    monthlyMonths: number;
    timeZone?: string;
    site?: string;
    author?: string;
    measuringInstrumentId?: string;
    riggingGearId?: string;
    itemId?: string;
    subject: string;
    to?: string;
  }): Promise<{ draftId: string; messageId?: string; reportModel: LoanReportPreviewPayload['reportModel'] }> {
    const preview = await this.buildPreview(params);
    const draft = await this.gmailDraft.createDraft({
      reportModel: preview.reportModel,
      htmlDocument: preview.html,
      subject: params.subject,
      to: params.to,
    });
    return { ...draft, reportModel: preview.reportModel };
  }

  async sendGmailMessage(params: {
    category: LoanReportCategoryKey;
    periodFrom: Date;
    periodTo: Date;
    monthlyMonths: number;
    timeZone?: string;
    site?: string;
    author?: string;
    measuringInstrumentId?: string;
    riggingGearId?: string;
    itemId?: string;
    subject: string;
    to: string;
  }): Promise<{ messageId: string; reportModel: LoanReportPreviewPayload['reportModel'] }> {
    const preview = await this.buildPreview(params);
    const sent = await this.gmailSend.sendMessage({
      reportModel: preview.reportModel,
      htmlDocument: preview.html,
      subject: params.subject,
      to: params.to,
    });
    return { messageId: sent.messageId, reportModel: preview.reportModel };
  }
}
