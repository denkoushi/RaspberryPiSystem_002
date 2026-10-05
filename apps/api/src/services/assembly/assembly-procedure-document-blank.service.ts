import sharp from 'sharp';
import { ProcedureManualService } from './procedure-manual.service.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';

import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { AssemblyProcedureDocumentService } from './assembly-procedure-document.service.js';

export async function saveBlankProcedurePage() {
  const bytes = await sharp({ create: { width: 1240, height: 1754, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return AssemblyProcedureImageStorage.saveImage(bytes, 'image/png');
}

export class AssemblyProcedureDocumentBlankService {
  constructor(private readonly documents = new AssemblyProcedureDocumentService()) {}

  async createWithAssignment(name: string, assignment?: { modelCode: string; processId: string }) {
    const document = await this.create(name);
    let assignmentError: string | null = null;
    if (assignment) {
      try {
        await new ProcedureManualService().appendDraftAssignment(
          normalizeMachineNameForCompare(assignment.modelCode).trim(), assignment.processId, document.id
        );
      } catch {
        assignmentError = '文書は作成しましたが、工程への割り当てに失敗しました';
      }
    }
    return { document, assignmentError };
  }

  async create(name: string) {
    const page = await saveBlankProcedurePage();
    try {
      return await this.documents.create({ name, avoidDuplicateName: true, pages: [{ imageRelativePath: page.relativeUrl }] });
    } catch (error) {
      await AssemblyProcedureImageStorage.deleteImage(page.relativeUrl);
      throw error;
    }
  }
}
