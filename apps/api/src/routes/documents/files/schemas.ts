import { z } from 'zod';

/**
 * ドキュメントアップロード用スキーマ
 * 将来のPDF/Excelビューワーモジュールで使用
 */
export const documentUploadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(['pdf', 'excel', 'csv']),
  description: z.string().optional().nullable()
});

export const documentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  fileType: z.enum(['pdf', 'excel', 'csv']).optional(),
  search: z.string().optional()
});

