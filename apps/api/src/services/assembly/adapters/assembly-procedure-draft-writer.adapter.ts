import { Prisma } from '@prisma/client';

import type {
  AssemblyProcedureDraftWriter
} from '../assembly-procedure-gmail-import.service.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { AssemblyProcedureDraftImportService } from '../assembly-procedure-draft-import.service.js';

export class PrismaAssemblyProcedureDraftWriter implements AssemblyProcedureDraftWriter {
  constructor(
    private readonly procedureService = new AssemblyProcedureDocumentService(),
    private readonly draftImportService = new AssemblyProcedureDraftImportService(procedureService)
  ) {}

  async writeGmailDraft(
    params: Parameters<AssemblyProcedureDraftWriter['writeGmailDraft']>[0]
  ): ReturnType<AssemblyProcedureDraftWriter['writeGmailDraft']> {
    const existing = await this.procedureService.findByGmailDedupeKey(params.gmailDedupeKey);
    if (existing) return { status: 'duplicate', document: existing };

    try {
      const document = await this.draftImportService.importDraft({
        name: params.name,
        buffer: params.buffer,
        mimetype: params.mimetype,
        filename: params.filename,
        source: {
          sourceType: 'GMAIL',
          gmailMessageId: params.gmailMessageId,
          sourceAttachmentName: params.filename,
          gmailInternalDateMs: params.gmailInternalDateMs,
          gmailDedupeKey: params.gmailDedupeKey
        }
      });
      return { status: 'created', document };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.procedureService.findByGmailDedupeKey(params.gmailDedupeKey);
        if (duplicate) return { status: 'duplicate', document: duplicate };
      }
      throw error;
    }
  }
}
