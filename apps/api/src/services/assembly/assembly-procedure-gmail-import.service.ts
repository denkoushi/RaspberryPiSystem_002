import path from 'node:path';

import { ApiError } from '../../lib/errors.js';
import {
  ASSEMBLY_PROCEDURE_JPEG_INPUT_MAX_BYTES,
  normalizeAssemblyProcedureJpeg
} from '../../lib/assembly-procedure-jpeg-normalizer.js';
import { PART_MEASUREMENT_PDF_INPUT_MAX_BYTES } from '../../lib/part-measurement-drawing-import.constants.js';
import {
  collectGmailAttachments,
  type GmailAttachmentDescriptor,
  type GmailMessage
} from '../backup/gmail-api-client.js';
import { GmailRateLimitedDeferredError } from '../backup/gmail-request-gate.service.js';
import { buildGmailAttachmentDedupeKey } from '../gmail/gmail-attachment-dedupe-key.js';
import type { AssemblyProcedureDocumentRecord } from './assembly-procedure-document.service.js';

export const ASSEMBLY_PROCEDURE_GMAIL_SUBJECT = 'DocumentASM';
export const ASSEMBLY_PROCEDURE_GMAIL_QUERY = 'in:inbox is:unread subject:"DocumentASM"';
export const ASSEMBLY_PROCEDURE_GMAIL_MAX_MESSAGES_PER_REQUEST = 10;

export interface AssemblyProcedureMailGateway {
  searchMessagesAll(query: string): Promise<string[]>;
  getMessage(messageId: string): Promise<GmailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  trashMessage(messageId: string): Promise<void>;
}

export interface AssemblyProcedureDraftWriter {
  writeGmailDraft(params: {
    name: string;
    buffer: Buffer;
    mimetype: 'application/pdf' | 'image/jpeg';
    filename: string;
    gmailMessageId: string;
    gmailInternalDateMs: number;
    gmailDedupeKey: string;
  }): Promise<
    | { status: 'created'; document: AssemblyProcedureDocumentRecord }
    | { status: 'duplicate'; document: AssemblyProcedureDocumentRecord }
  >;
}

export interface AssemblyProcedureJpegNormalizer {
  normalize(buffer: Buffer): Promise<Buffer>;
}

export type AssemblyProcedureGmailImportItemStatus =
  | 'imported'
  | 'duplicate'
  | 'import_failed'
  | 'cleanup_failed';

export type AssemblyProcedureGmailImportItem = {
  messageId: string;
  filename: string | null;
  status: AssemblyProcedureGmailImportItemStatus;
  document: AssemblyProcedureDocumentRecord | null;
  error: string | null;
};

export type AssemblyProcedureGmailImportSummary = {
  query: string;
  scanned: number;
  exactMatched: number;
  subjectMismatchSkipped: number;
  attempted: number;
  imported: number;
  duplicates: number;
  trashed: number;
  failed: number;
  remainingInInbox: number;
  items: AssemblyProcedureGmailImportItem[];
};

export type AssemblyProcedureAttachmentKind = 'pdf' | 'jpeg';

function getMessageSubject(message: GmailMessage): string {
  return message.payload?.headers
    ?.find((header) => header.name.toLowerCase() === 'subject')
    ?.value.trim() ?? '';
}

export function hasExactAssemblyProcedureGmailSubject(message: GmailMessage): boolean {
  return getMessageSubject(message) === ASSEMBLY_PROCEDURE_GMAIL_SUBJECT;
}

export function selectSingleAssemblyProcedureAttachment(message: GmailMessage): GmailAttachmentDescriptor {
  const attachments = collectGmailAttachments(message).filter((attachment) => !attachment.isInline);
  if (attachments.length === 0) {
    throw new ApiError(
      400,
      'PDFまたはJPEGの添付ファイルが1つ必要です',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_MISSING'
    );
  }
  if (attachments.length !== 1) {
    throw new ApiError(
      400,
      '添付ファイルは1つだけにしてください',
      { attachmentCount: attachments.length },
      'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_COUNT'
    );
  }
  if (!attachments[0]!.filename.trim()) {
    throw new ApiError(
      400,
      '添付ファイル名が必要です',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_FILENAME_MISSING'
    );
  }
  return attachments[0]!;
}

export function resolveAssemblyProcedureAttachmentKind(
  attachment: Pick<GmailAttachmentDescriptor, 'filename' | 'mimeType'>
): AssemblyProcedureAttachmentKind {
  const normalizedFilename = attachment.filename.normalize('NFC').trim();
  const extension = path.extname(normalizedFilename).toLowerCase();
  const mimeType = attachment.mimeType.trim().toLowerCase();
  const genericMime = mimeType === '' || mimeType === 'application/octet-stream';

  const extensionKind: AssemblyProcedureAttachmentKind | null =
    extension === '.pdf'
      ? 'pdf'
      : extension === '.jpg' || extension === '.jpeg'
        ? 'jpeg'
        : null;
  const mimeKind: AssemblyProcedureAttachmentKind | null =
    mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType === 'image/jpeg' || mimeType === 'image/jpg'
        ? 'jpeg'
        : null;

  if (extension && !extensionKind) {
    throw new ApiError(
      400,
      '添付ファイルはPDFまたはJPEGにしてください',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_TYPE'
    );
  }
  if (!genericMime && !mimeKind) {
    throw new ApiError(
      400,
      '添付ファイルのMIMEタイプはPDFまたはJPEGにしてください',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_MIME'
    );
  }
  if (extensionKind && mimeKind && extensionKind !== mimeKind) {
    throw new ApiError(
      400,
      '添付ファイルの拡張子とMIMEタイプが一致しません',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_MISMATCH'
    );
  }
  const kind = extensionKind ?? mimeKind;
  if (!kind) {
    throw new ApiError(
      400,
      '添付ファイルはPDFまたはJPEGにしてください',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_TYPE'
    );
  }
  return kind;
}

export function deriveAssemblyProcedureNameFromAttachment(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').normalize('NFC').trim();
  const basename = path.posix.basename(normalized).replace(/\0/g, '').trim();
  const withoutExtension = basename.replace(/\.(?:pdf|jpe?g)$/i, '').trim();
  if (!withoutExtension) {
    throw new ApiError(
      400,
      '添付ファイル名から手順書名を作成できません',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_DOCUMENT_NAME'
    );
  }
  return withoutExtension.slice(0, 200);
}

function assertPdfBuffer(buffer: Buffer): void {
  if (!buffer.length || buffer.length > PART_MEASUREMENT_PDF_INPUT_MAX_BYTES) {
    throw new ApiError(
      400,
      buffer.length ? 'PDF ファイルが大きすぎます（最大 30 MiB）' : 'PDF ファイルが空です',
      undefined,
      buffer.length ? 'ASSEMBLY_PROCEDURE_GMAIL_PDF_TOO_LARGE' : 'ASSEMBLY_PROCEDURE_GMAIL_PDF_EMPTY'
    );
  }
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ApiError(
      400,
      'PDF ファイルの形式が不正です',
      undefined,
      'ASSEMBLY_PROCEDURE_GMAIL_PDF_INVALID'
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AssemblyProcedureGmailImportService {
  private isRunning = false;

  constructor(
    private readonly deps: {
      createMailGateway: () => Promise<AssemblyProcedureMailGateway>;
      draftWriter: AssemblyProcedureDraftWriter;
      jpegNormalizer?: AssemblyProcedureJpegNormalizer;
    }
  ) {}

  async ingest(): Promise<AssemblyProcedureGmailImportSummary> {
    if (this.isRunning) {
      throw new ApiError(
        409,
        '手順書のGmail取込は既に実行中です',
        undefined,
        'ASSEMBLY_PROCEDURE_GMAIL_IMPORT_RUNNING'
      );
    }
    this.isRunning = true;
    try {
      return await this.ingestUnlocked();
    } finally {
      this.isRunning = false;
    }
  }

  private async ingestUnlocked(): Promise<AssemblyProcedureGmailImportSummary> {
    let gateway: AssemblyProcedureMailGateway;
    try {
      gateway = await this.deps.createMailGateway();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        'Gmail取込の初期化に失敗しました',
        { detail: errorMessage(error) },
        'ASSEMBLY_PROCEDURE_GMAIL_INIT_FAILED'
      );
    }

    let messageIds: string[];
    try {
      messageIds = await gateway.searchMessagesAll(ASSEMBLY_PROCEDURE_GMAIL_QUERY);
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw new ApiError(
          503,
          'Gmail APIが混雑しています。しばらく待ってから再実行してください',
          undefined,
          'ASSEMBLY_PROCEDURE_GMAIL_RATE_LIMITED'
        );
      }
      const detail = errorMessage(error);
      const lower = detail.toLowerCase();
      if (
        lower.includes('insufficient authentication scopes') ||
        lower.includes('invalid credentials') ||
        lower.includes('unauthorized') ||
        lower.includes('status: 401') ||
        lower.includes('status: 403')
      ) {
        throw new ApiError(
          400,
          'Gmailの認証または権限が不足しています。Gmailを再認証してください',
          { detail },
          'ASSEMBLY_PROCEDURE_GMAIL_AUTH_FAILED'
        );
      }
      throw new ApiError(
        502,
        'Gmail受信箱の検索に失敗しました',
        { detail },
        'ASSEMBLY_PROCEDURE_GMAIL_SEARCH_FAILED'
      );
    }
    const exactMessages: GmailMessage[] = [];
    const scanFailures: AssemblyProcedureGmailImportItem[] = [];

    for (const messageId of messageIds) {
      try {
        const message = await gateway.getMessage(messageId);
        if (hasExactAssemblyProcedureGmailSubject(message)) {
          exactMessages.push(message);
        }
      } catch (error) {
        scanFailures.push({
          messageId,
          filename: null,
          status: 'import_failed',
          document: null,
          error: `メール情報を取得できませんでした: ${errorMessage(error)}`
        });
      }
    }

    exactMessages.sort((a, b) => {
      if (a.internalDateMs !== b.internalDateMs) return a.internalDateMs - b.internalDateMs;
      return a.id.localeCompare(b.id);
    });
    const selectedMessages = exactMessages.slice(0, ASSEMBLY_PROCEDURE_GMAIL_MAX_MESSAGES_PER_REQUEST);
    const items = [...scanFailures];
    let imported = 0;
    let duplicates = 0;
    let trashed = 0;

    for (const message of selectedMessages) {
      let filename: string | null = null;
      let document: AssemblyProcedureDocumentRecord | null = null;
      let importedStatus: 'created' | 'duplicate' | null = null;
      try {
        const attachment = selectSingleAssemblyProcedureAttachment(message);
        filename = attachment.filename;
        const kind = resolveAssemblyProcedureAttachmentKind(attachment);
        const inputMaxBytes =
          kind === 'pdf' ? PART_MEASUREMENT_PDF_INPUT_MAX_BYTES : ASSEMBLY_PROCEDURE_JPEG_INPUT_MAX_BYTES;
        if (attachment.size != null && attachment.size > inputMaxBytes) {
          throw new ApiError(
            400,
            `${kind === 'pdf' ? 'PDF' : 'JPEG'} ファイルが大きすぎます（最大 30 MiB）`,
            undefined,
            'ASSEMBLY_PROCEDURE_GMAIL_ATTACHMENT_TOO_LARGE'
          );
        }

        const downloaded = await gateway.getAttachment(message.id, attachment.attachmentId);
        let buffer: Buffer;
        let mimetype: 'application/pdf' | 'image/jpeg';
        if (kind === 'pdf') {
          assertPdfBuffer(downloaded);
          buffer = downloaded;
          mimetype = 'application/pdf';
        } else {
          buffer = await (this.deps.jpegNormalizer?.normalize(downloaded) ??
            normalizeAssemblyProcedureJpeg(downloaded));
          mimetype = 'image/jpeg';
        }

        const sourceAttachmentName = filename;
        const gmailDedupeKey = buildGmailAttachmentDedupeKey(message.id, sourceAttachmentName);
        const writeResult = await this.deps.draftWriter.writeGmailDraft({
          name: deriveAssemblyProcedureNameFromAttachment(sourceAttachmentName),
          buffer,
          mimetype,
          filename: sourceAttachmentName,
          gmailMessageId: message.id,
          gmailInternalDateMs: message.internalDateMs,
          gmailDedupeKey
        });
        document = writeResult.document;
        importedStatus = writeResult.status;
        if (writeResult.status === 'created') imported += 1;
        else duplicates += 1;
      } catch (error) {
        items.push({
          messageId: message.id,
          filename,
          status: 'import_failed',
          document: null,
          error: errorMessage(error)
        });
        continue;
      }

      try {
        await gateway.trashMessage(message.id);
        trashed += 1;
        items.push({
          messageId: message.id,
          filename,
          status: importedStatus === 'created' ? 'imported' : 'duplicate',
          document,
          error: null
        });
      } catch (error) {
        items.push({
          messageId: message.id,
          filename,
          status: 'cleanup_failed',
          document,
          error: `手順書は登録済みですが、メールをゴミ箱へ移動できませんでした: ${errorMessage(error)}`
        });
      }
    }

    const failed = items.filter(
      (item) => item.status === 'import_failed' || item.status === 'cleanup_failed'
    ).length;
    return {
      query: ASSEMBLY_PROCEDURE_GMAIL_QUERY,
      scanned: messageIds.length,
      exactMatched: exactMessages.length,
      subjectMismatchSkipped: Math.max(0, messageIds.length - exactMessages.length - scanFailures.length),
      attempted: selectedMessages.length + scanFailures.length,
      imported,
      duplicates,
      trashed,
      failed,
      remainingInInbox: Math.max(0, exactMessages.length - trashed) + scanFailures.length,
      items
    };
  }
}
