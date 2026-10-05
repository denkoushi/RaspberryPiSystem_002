import sharp from 'sharp';

import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { AssemblyProcedureDocumentService } from './assembly-procedure-document.service.js';

export async function saveBlankProcedurePage() {
  const bytes = await sharp({ create: { width: 1240, height: 1754, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return AssemblyProcedureImageStorage.saveImage(bytes, 'image/png');
}

export class AssemblyProcedureDocumentBlankService {
  constructor(private readonly documents = new AssemblyProcedureDocumentService()) {}

  async create(name: string) {
    const page = await saveBlankProcedurePage();
    try {
      return await this.documents.create({ name, pages: [{ imageRelativePath: page.relativeUrl }] });
    } catch (error) {
      await AssemblyProcedureImageStorage.deleteImage(page.relativeUrl);
      throw error;
    }
  }
}
