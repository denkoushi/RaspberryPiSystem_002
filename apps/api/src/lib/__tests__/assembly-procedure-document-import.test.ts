import { describe, expect, it, vi } from 'vitest';

import { importAssemblyProcedureDocumentPagesAndSave } from '../assembly-procedure-document-import.js';

describe('importAssemblyProcedureDocumentPagesAndSave', () => {
  it('rejects a PDF upload whose bytes are not a PDF before storing anything', async () => {
    const storage = { save: vi.fn(), delete: vi.fn() };

    await expect(importAssemblyProcedureDocumentPagesAndSave(
      { buffer: Buffer.from('not a pdf'), mimetype: 'application/pdf', filename: 'procedure.pdf' },
      { storage: storage as never }
    )).rejects.toMatchObject({ statusCode: 400, message: 'PDF ファイルの形式が不正です' });
    expect(storage.save).not.toHaveBeenCalled();
  });
});
