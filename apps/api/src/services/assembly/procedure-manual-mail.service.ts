import { createHash } from 'node:crypto';

import type { ProcedureManualPrintPage, ProcedureManualPrintPayload } from '@raspi-system/shared-types';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { PdfStorageRenderAdapter } from '../kiosk-documents/adapters/pdf-storage-render.adapter.js';
import { resolveActiveAssemblyOperatorNfcUid } from './assembly-operator-nfc-resolve.service.js';
import { mapAssemblyProcedureSequenceItem } from './assembly-procedure-sequence-item.js';
import { buildProcedureSteps, toSequenceDocument } from './assembly-procedure-sequence.service.js';
import { procedureManualGmailSender, type ProcedureManualMailSender } from './procedure-manual-gmail-send.js';
import { isProcedureManualMailLocalPart } from './procedure-manual-mail-address.js';
import { procedureManualPdfRenderer, type PdfProfile, type ProcedureManualPdfRenderer } from './procedure-manual-pdf.js';
import { resolvePublished } from './procedure-manual.service.js';

const maxPdfPages = 25;
const renderTimeoutMs = 75_000;
const targetPdfBytes = 12_000_000;
const maxPdfBytes = 14_000_000;
const pdfProfiles: PdfProfile[] = [
  { quality: 90, scale: 2 },
  { quality: 75, scale: 2 },
  { quality: 60, scale: 1.5 },
  { quality: 45, scale: 1.25 },
];

const tokyoDateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
});

export function formatProcedureManualMailTime(date: Date): string {
  return tokyoDateTime.format(date).slice(0, 16);
}

type SendInput = {
  documentId: string;
  revisionId: string;
  nfcUid: string;
  localPart: string;
};

type Client = { id: string; name: string };

let sending = false;
let activeRender: Promise<Buffer> | undefined;

export class ProcedureManualMailService {
  private readonly renderAdapter = new PdfStorageRenderAdapter();

  constructor(
    private readonly renderer: ProcedureManualPdfRenderer = procedureManualPdfRenderer,
    private readonly sender: ProcedureManualMailSender = procedureManualGmailSender,
    private readonly db: Pick<typeof prisma, 'assemblyProcedureDocument' | 'assemblyProcedureDocumentRevision' | 'employee' | 'procedureManualMailDelivery'> = prisma,
    private readonly getDomain = () => env.ASSEMBLY_PROCEDURE_MAIL_DOMAIN,
    private readonly now = () => new Date(),
  ) {}

  async send(input: SendInput, client: Client) {
    const domain = this.getDomain();
    if (!domain) {
      throw new ApiError(503, '要領書のメール送信は設定されていません', undefined, 'PROCEDURE_MAIL_DISABLED');
    }
    if (!isProcedureManualMailLocalPart(input.localPart)) {
      throw new ApiError(400, 'メールアドレスの @ より前を正しく入力してください', undefined, 'PROCEDURE_MAIL_INVALID_LOCAL_PART');
    }
    if (sending || activeRender) {
      throw new ApiError(409, '要領書を送信中です。少し待ってからもう一度お試しください', undefined, 'PROCEDURE_MAIL_BUSY');
    }

    sending = true;
    try {
      return await this.sendExclusively(input, client, `${input.localPart}@${domain}`);
    } finally {
      sending = false;
    }
  }

  private async requireCurrentPublished({ documentId, revisionId }: SendInput) {
    const document = await resolvePublished(documentId, this.db);
    if (document?.id !== revisionId) {
      throw new ApiError(409, '公開済みの最新版だけ送信できます。要領書を開き直してください', undefined, 'PROCEDURE_MAIL_REVISION_NOT_CURRENT');
    }
    return document;
  }

  private async getPages(document: Awaited<ReturnType<ProcedureManualMailService['requireCurrentPublished']>>): Promise<ProcedureManualPrintPage[]> {
    if (document.pages.length > maxPdfPages) {
      throw new ApiError(413, `要領書が ${maxPdfPages} ページを超えています`, undefined, 'PROCEDURE_MAIL_TOO_MANY_PAGES');
    }
    const item = mapAssemblyProcedureSequenceItem({
      id: document.id, sortOrder: 0, label: null,
      assemblyProcedureDocumentId: document.id, assemblyProcedureDocument: document,
      kioskDocumentId: null, kioskDocument: null,
    });
    const sequenceDocument = await toSequenceDocument(
      item, this.renderAdapter, new Map([[document.id, document.pages]]), new Map([[document.id, document.overlayElements]])
    );
    if (!sequenceDocument?.pages.length) {
      throw new ApiError(422, '画像のある要領書だけ送信できます', undefined, 'PROCEDURE_MAIL_NO_PAGES');
    }
    // Like ProcedureManualService.getAssignments, the manuals viewer expands pages in order.
    const { steps } = buildProcedureSteps([sequenceDocument], []);
    const overlaysByPage = new Map(sequenceDocument.pages.map((page) => [page.pageIndex, page.overlays]));
    return steps.map((step) => ({
      pageUrl: step.pageUrl,
      crop: step.viewMode === 'CROP' ? {
        xRatio: step.cropXRatio!,
        yRatio: step.cropYRatio!,
        widthRatio: step.cropWidthRatio!,
        heightRatio: step.cropHeightRatio!,
      } : null,
      overlays: overlaysByPage.get(step.pageIndex) ?? [],
      assets: sequenceDocument.assets,
    }));
  }

  private async sendExclusively(input: SendInput, client: Client, recipient: string) {
    const document = await this.requireCurrentPublished(input);
    const employee = await resolveActiveAssemblyOperatorNfcUid(this.db, input.nfcUid).catch((error: unknown) => {
      if (error instanceof ApiError && error.statusCode === 404) {
        throw new ApiError(404, error.message, undefined, 'PROCEDURE_MAIL_NFC_NOT_FOUND');
      }
      if (error instanceof ApiError && error.statusCode === 403) {
        throw new ApiError(403, '有効な社員のタグで送信してください', undefined, 'PROCEDURE_MAIL_NFC_INACTIVE');
      }
      throw error;
    });
    const pages = await this.getPages(document);
    await this.sender.assertAvailable();
    const outputTime = formatProcedureManualMailTime(this.now());
    const revisionNumber = document.revisionMetadata?.revisionNumber ?? 1;
    const revisionDate = formatProcedureManualMailTime(document.publishedAt ?? document.createdAt).slice(0, 10);
    // eslint-disable-next-line no-control-regex -- strip control characters from the title
    const title = document.name.replace(/[\u0000-\u001f\u007f]+/g, ' ');
    const revisionLabel = `第${revisionNumber}版(改版 ${revisionDate})`;
    const pdf = await this.renderPdf(pages.map((page, index) => ({
      ...page, title, revisionLabel,
      pageLabel: `${index + 1} / ${pages.length}`,
      informationLabel: `${outputTime} 時点の情報です。最新版はキオスクで確認してください。`,
      outputLabel: `出力 ${outputTime} 社員番号 ${employee.employeeCode} ${client.name} ${employee.displayName}`,
    })));

    const pdfSha256 = createHash('sha256').update(pdf).digest('hex');
    const subject = `要領書の控え ${title} 第${revisionNumber}版`;
    const { id: gmailMessageId } = await this.sender.send({
      to: recipient,
      subject,
      filename: `${subject}.pdf`,
      pdf,
    }, async () => {
      // Check after rendering and any wait for the shared Gmail send slot.
      const current = await this.requireCurrentPublished(input);
      if (current.updatedAt.getTime() !== document.updatedAt.getTime()) {
        throw new ApiError(409, '要領書が更新されました。要領書を開き直してください', undefined, 'PROCEDURE_MAIL_REVISION_NOT_CURRENT');
      }
    });

    try {
      const delivery = await this.db.procedureManualMailDelivery.create({
        data: {
          documentId: input.documentId,
          revisionId: input.revisionId,
          revisionNumber,
          employeeId: employee.employeeId,
          employeeCode: employee.employeeCode,
          employeeName: employee.displayName,
          clientDeviceId: client.id,
          clientDeviceName: client.name,
          sentAt: this.now(),
          recipient, gmailMessageId, pdfSha256,
          pageCount: pages.length,
          pdfByteSize: pdf.length,
        },
        select: { id: true, sentAt: true, gmailMessageId: true, pageCount: true, pdfByteSize: true },
      });
      return {
        deliveryId: delivery.id,
        sentAt: `${tokyoDateTime.format(delivery.sentAt).replace(' ', 'T').replace(',', '.')}+09:00`,
        gmailMessageId,
        pageCount: delivery.pageCount,
        pdfByteSize: delivery.pdfByteSize,
      };
    } catch (error) {
      logger?.error({ err: error, gmailMessageId }, 'Failed to record procedure manual Gmail delivery');
      throw new ApiError(500, 'メールは送信済みですが記録できませんでした。再送信せず管理者に連絡してください', undefined, 'PROCEDURE_MAIL_RECORD_FAILED');
    }
  }

  private async renderPdf(pages: ProcedureManualPrintPayload[]): Promise<Buffer> {
    const timeoutError = new ApiError(504, 'PDF の作成が時間切れになりました', undefined, 'PROCEDURE_MAIL_RENDER_TIMEOUT');
    const deadline = performance.now() + renderTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutError);
      }, renderTimeoutMs);
    });

    let acceptable: Buffer | undefined;
    let profileIndex = 0;
    try {
      while (profileIndex < pdfProfiles.length) {
        const profile = pdfProfiles[profileIndex]!;
        // Keep the render slot occupied if the deadline elapses during a capture.
        activeRender = this.renderer.render(pages, profile).finally(() => { activeRender = undefined; });
        const pdf = await Promise.race([activeRender, timeout]);
        if (performance.now() >= deadline) throw timeoutError;
        if (pdf.length <= targetPdfBytes) return pdf;
        if (pdf.length <= maxPdfBytes) acceptable ??= pdf;

        // Use pixel area and JPEG quality as a rough guide, then check the actual PDF size.
        const estimatedIndex = pdfProfiles.findIndex((next, index) =>
          index > profileIndex && pdf.length * (next.scale / profile.scale) ** 2 * next.quality / profile.quality <= targetPdfBytes
        );
        if (profileIndex === pdfProfiles.length - 1) break;
        profileIndex = estimatedIndex === -1 ? pdfProfiles.length - 1 : estimatedIndex;
      }
    } catch (error) {
      if (error === timeoutError || performance.now() >= deadline) throw timeoutError;
      logger?.error({ err: error }, 'Failed to render a procedure manual PDF');
      if (!acceptable) {
        throw new ApiError(503, '要領書の PDF を作成できませんでした', undefined, 'PROCEDURE_MAIL_RENDER_FAILED');
      }
    } finally {
      clearTimeout(timer);
    }
    if (acceptable) return acceptable;
    throw new ApiError(413, '要領書の PDF が添付上限の 14 MB を超えています', undefined, 'PROCEDURE_MAIL_PDF_TOO_LARGE');
  }
}
