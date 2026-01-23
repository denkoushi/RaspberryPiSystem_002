import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';

type GmailDownloadWithMetadata = {
  downloadWithMetadata: (path: string) => Promise<{
    buffer: Buffer;
    messageId: string;
    messageSubject: string;
  }>;
};

type GmailDownloadAllWithMetadata = {
  downloadAllWithMetadata: (path: string) => Promise<Array<{
    buffer: Buffer;
    messageId: string;
    messageSubject: string;
  }>>;
  markAsRead?: (messageId: string) => Promise<void>;
  trashMessage?: (messageId: string) => Promise<void>;
};

function hasDownloadWithMetadata(
  storageProvider: StorageProvider
): storageProvider is StorageProvider & GmailDownloadWithMetadata {
  return typeof (storageProvider as unknown as Partial<GmailDownloadWithMetadata>).downloadWithMetadata === 'function';
}

function hasDownloadAllWithMetadata(
  storageProvider: StorageProvider
): storageProvider is StorageProvider & GmailDownloadAllWithMetadata {
  return (
    typeof (storageProvider as unknown as Partial<GmailDownloadAllWithMetadata>).downloadAllWithMetadata === 'function'
  );
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
  }): Promise<CsvDashboardDownloadResult[]> {
    const { provider, storageProvider, gmailSubjectPattern } = params;

    if (provider === 'gmail' && hasDownloadAllWithMetadata(storageProvider)) {
      const results = await storageProvider.downloadAllWithMetadata(gmailSubjectPattern);
      return results.map((result) => ({
        buffer: result.buffer,
        messageId: result.messageId,
        messageSubject: result.messageSubject,
      }));
    }

    if (provider === 'gmail' && hasDownloadWithMetadata(storageProvider)) {
      const result = await storageProvider.downloadWithMetadata(gmailSubjectPattern);
      return [
        {
        buffer: result.buffer,
        messageId: result.messageId,
        messageSubject: result.messageSubject,
        },
      ];
    }

    return [{ buffer: await storageProvider.download(gmailSubjectPattern) }];
  }
}

