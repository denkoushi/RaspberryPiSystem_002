import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { importAssemblyProcedureDocumentPagesAndSave } from '../../lib/assembly-procedure-document-import.js';
import {
  AssemblyProcedureDocumentService,
  type AssemblyProcedureDocumentRecord
} from './assembly-procedure-document.service.js';

export type AssemblyProcedureDraftSource =
  | {
      sourceType: 'GMAIL';
      gmailMessageId: string;
      sourceAttachmentName: string;
      gmailInternalDateMs: number;
      gmailDedupeKey: string;
    }
  | undefined;

export class AssemblyProcedureDraftImportService {
  constructor(
    private readonly procedureService = new AssemblyProcedureDocumentService()
  ) {}

  async importDraft(params: {
    name: string;
    buffer: Buffer;
    mimetype: string;
    filename: string;
    source?: AssemblyProcedureDraftSource;
  }): Promise<AssemblyProcedureDocumentRecord> {
    const imported = await importAssemblyProcedureDocumentPagesAndSave({
      buffer: params.buffer,
      mimetype: params.mimetype,
      filename: params.filename
    });
    try {
      return await this.procedureService.create({
        name: params.name,
        pages: imported.pages.map((page) => ({ imageRelativePath: page.imageRelativePath })),
        source: params.source
      });
    } catch (error) {
      await Promise.all(
        imported.pages.map((page) =>
          AssemblyProcedureImageStorage.deleteImage(page.imageRelativePath).catch(() => undefined)
        )
      );
      throw error;
    }
  }
}
