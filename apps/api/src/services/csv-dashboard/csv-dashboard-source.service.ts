import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';

type GmailDownloadWithMetadata = {
  downloadWithMetadata: (path: string) => Promise<{
    buffer: Buffer;
    messageId: string;
    messageSubject: string;
  }>;
};

function hasDownloadWithMetadata(
  storageProvider: StorageProvider
): storageProvider is StorageProvider & GmailDownloadWithMetadata {
  return typeof (storageProvider as unknown as Partial<GmailDownloadWithMetadata>).downloadWithMetadata === 'function';
}

export type CsvDashboardDownloadResult = {
  buffer: Buffer;
  messageId?: string;
  messageSubject?: string;
};

export class CsvDashboardSourceService {
  async downloadCsv(params: {
    provider: string;
    storageProvider: StorageProvider;
    gmailSubjectPattern: string;
  }): Promise<CsvDashboardDownloadResult> {
    const { provider, storageProvider, gmailSubjectPattern } = params;

    if (provider === 'gmail' && hasDownloadWithMetadata(storageProvider)) {
      const result = await storageProvider.downloadWithMetadata(gmailSubjectPattern);
      return {
        buffer: result.buffer,
        messageId: result.messageId,
        messageSubject: result.messageSubject,
      };
    }

    return { buffer: await storageProvider.download(gmailSubjectPattern) };
  }
}

