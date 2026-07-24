import { normalizeAssemblyProcedureJpeg } from '../../lib/assembly-procedure-jpeg-normalizer.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { PrismaAssemblyProcedureDraftWriter } from './adapters/assembly-procedure-draft-writer.adapter.js';
import { AssemblyProcedureGmailImportService } from './assembly-procedure-gmail-import.service.js';

export function createAssemblyProcedureGmailImportService(): AssemblyProcedureGmailImportService {
  return new AssemblyProcedureGmailImportService({
    createMailGateway: async () => {
      const config = await BackupConfigLoader.load();
      return resolveGmailApiClientFromBackupConfig(config);
    },
    draftWriter: new PrismaAssemblyProcedureDraftWriter(),
    jpegNormalizer: {
      normalize: normalizeAssemblyProcedureJpeg
    }
  });
}
