/**
 * PostgreSQL 全文検索更新の境界（実装詳細を呼び出し側から分離）
 */
export interface DocumentSearchIndexerPort {
  refreshDocumentIndex(documentId: string): Promise<void>;
}
