import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { NoMatchingMessageError } from '../backup/storage/gmail-storage.provider.js';
import type { CsvImportTarget, CsvImportType } from './csv-importer.types.js';
import {
  PrismaCsvImportSubjectPatternProvider,
  type CsvImportSubjectPatternProvider,
} from './csv-import-subject-pattern.provider.js';

type LoggerLike = {
  info?: (obj: unknown, msg: string) => void;
  warn?: (obj: unknown, msg: string) => void;
};

export type MasterCsvDownloadResult = {
  buffer: Buffer;
  resolvedSource: string;
};

export class CsvImportSourceService {
  constructor(
    private readonly subjectPatternProvider: CsvImportSubjectPatternProvider = new PrismaCsvImportSubjectPatternProvider()
  ) {}

  private async getCandidateGmailSubjectPatterns(params: {
    importType: Exclude<CsvImportType, 'csvDashboards'>;
    legacyPattern?: string;
    cache?: Map<string, string[]>;
  }): Promise<string[]> {
    const { importType, legacyPattern, cache } = params;

    if (cache?.has(importType)) {
      const cached = cache.get(importType);
      return cached ? [...cached] : [];
    }

    const patterns = await this.subjectPatternProvider.listEnabledPatterns(importType);
    const candidatePatterns = patterns.filter((p) => p.trim().length > 0);

    const legacy = legacyPattern?.trim();
    if (legacy && !candidatePatterns.includes(legacy)) {
      candidatePatterns.push(legacy);
    }

    cache?.set(importType, [...candidatePatterns]);
    return candidatePatterns;
  }

  async downloadMasterCsv(params: {
    target: CsvImportTarget;
    provider: string;
    storageProvider: StorageProvider;
    patternCache?: Map<string, string[]>;
    logger?: LoggerLike;
  }): Promise<MasterCsvDownloadResult> {
    const { target, provider, storageProvider, patternCache, logger } = params;

    // NOTE: csvDashboards は別ルートで処理する（ここでは扱わない）
    if (target.type === 'csvDashboards') {
      throw new Error('CsvImportSourceService.downloadMasterCsv does not support csvDashboards target');
    }

    if (provider !== 'gmail') {
      return {
        buffer: await storageProvider.download(target.source),
        resolvedSource: target.source,
      };
    }

    const candidatePatterns = await this.getCandidateGmailSubjectPatterns({
      importType: target.type,
      legacyPattern: target.source,
      cache: patternCache,
    });

    logger?.info?.(
      { type: target.type, candidateCount: candidatePatterns.length, provider },
      '[CsvImportSourceService] Resolving Gmail subject patterns for master import'
    );

    for (const pattern of candidatePatterns) {
      try {
        logger?.info?.(
          { type: target.type, source: pattern, provider },
          `[CsvImportSourceService] Downloading ${target.type} CSV`
        );
        const buffer = await storageProvider.download(pattern);
        return { buffer, resolvedSource: pattern };
      } catch (error) {
        if (error instanceof NoMatchingMessageError) {
          logger?.warn?.(
            { type: target.type, source: pattern },
            '[CsvImportSourceService] No matching Gmail message, trying next pattern'
          );
          continue;
        }
        throw error;
      }
    }

    throw new Error(`No matching Gmail messages found for ${target.type}`);
  }
}

