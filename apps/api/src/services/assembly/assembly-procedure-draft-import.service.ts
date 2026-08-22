import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { importAssemblyProcedureDocumentPagesAndSave } from '../../lib/assembly-procedure-document-import.js';
import {
  AssemblyProcedureDocumentService,
  type AssemblyProcedureDocumentRecord
} from './assembly-procedure-document.service.js';
import type {
  AssemblyProcedureAssetStoragePort
} from '../assembly-procedure-assets/assembly-procedure-asset-storage.port.js';
import { getAssemblyProcedureAssetStorage } from '../assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.js';

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
    private readonly procedureService = new AssemblyProcedureDocumentService(),
    private readonly assetStorage: AssemblyProcedureAssetStoragePort = getAssemblyProcedureAssetStorage()
  ) {}

  async importDraft(params: {
    name: string;
    buffer: Buffer;
    mimetype: string;
    filename: string;
    source?: AssemblyProcedureDraftSource;
  }): Promise<AssemblyProcedureDocumentRecord> {
    const imported = await importAssemblyProcedureDocumentPagesAndSave(
      {
        buffer: params.buffer,
        mimetype: params.mimetype,
        filename: params.filename
      },
      { storage: this.assetStorage }
    );
    try {
      return await this.procedureService.create({
        name: params.name,
        pages: imported.pages.map((page) => ({ imageRelativePath: page.imageRelativePath })),
        source: params.source,
        sourceAsset: {
          ...imported.sourceAsset,
          kind: 'SOURCE',
          originalFileName: params.filename
        }
      });
    } catch (error) {
      await Promise.all(
        imported.pages.map((page) =>
          AssemblyProcedureImageStorage.deleteImage(page.imageRelativePath).catch(() => undefined)
        )
      );
      await this.assetStorage.delete(imported.sourceAsset).catch(() => undefined);
      throw error;
    }
  }
}
