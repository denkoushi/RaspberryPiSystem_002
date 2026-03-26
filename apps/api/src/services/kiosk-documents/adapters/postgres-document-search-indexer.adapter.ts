import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import type { DocumentSearchIndexerPort } from '../ports/document-search-indexer.port.js';

/**
 * 初期版は materialized index テーブルを持たず、更新フックのみ用意する。
 * 将来はこのアダプタで tsvector 専用列/テーブル更新へ差し替える。
 */
export class PostgresDocumentSearchIndexerAdapter implements DocumentSearchIndexerPort {
  async refreshDocumentIndex(documentId: string): Promise<void> {
    try {
      // no-op update to keep extension point and track updatedAt.
      await prisma.kioskDocument.update({
        where: { id: documentId },
        data: { updatedAt: new Date() },
      });
    } catch (error) {
      logger.warn({ err: error, documentId }, '[KioskDocument] search index refresh failed');
    }
  }
}
