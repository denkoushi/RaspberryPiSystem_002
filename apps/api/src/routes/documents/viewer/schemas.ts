import { z } from 'zod';

/**
 * ドキュメントビューワー用スキーマ
 * 将来のPDF/Excelビューワーモジュールで使用
 */
export const documentViewSchema = z.object({
  documentId: z.string().uuid(),
  page: z.coerce.number().int().min(1).optional()
});

