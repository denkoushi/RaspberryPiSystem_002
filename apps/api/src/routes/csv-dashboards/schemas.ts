import { z } from 'zod';

// 列定義のスキーマ
const columnDefinitionSchema = z.object({
  internalName: z.string().min(1),
  displayName: z.string().min(1),
  csvHeaderCandidates: z.array(z.string().min(1)),
  dataType: z.enum(['string', 'number', 'date', 'boolean']),
  order: z.number().int().min(0),
  required: z.boolean().optional(),
});

// テーブル形式テンプレート設定のスキーマ
const tableTemplateConfigSchema = z.object({
  rowsPerPage: z.number().int().positive(),
  fontSize: z.number().int().positive(),
  displayColumns: z.array(z.string().min(1)),
  columnWidths: z.record(z.string(), z.number().int().positive()).optional(),
  headerFixed: z.boolean().optional(),
});

// カードグリッド形式テンプレート設定のスキーマ
const cardGridTemplateConfigSchema = z.object({
  cardsPerPage: z.number().int().positive(),
  fontSize: z.number().int().positive(),
  displayFields: z.array(z.string().min(1)),
  gridColumns: z.number().int().positive().optional(),
  gridRows: z.number().int().positive().optional(),
});

// テンプレート設定のユニオン
const templateConfigSchema = z.union([tableTemplateConfigSchema, cardGridTemplateConfigSchema]);

// CSVダッシュボード作成スキーマ
export const csvDashboardCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  columnDefinitions: z.array(columnDefinitionSchema).min(1),
  dateColumnName: z.string().optional().nullable(),
  displayPeriodDays: z.number().int().positive().default(1),
  emptyMessage: z.string().optional().nullable(),
  ingestMode: z.enum(['APPEND', 'DEDUP']).default('APPEND'),
  dedupKeyColumns: z.array(z.string().min(1)).default([]),
  gmailScheduleId: z.string().uuid().optional().nullable(),
  templateType: z.enum(['TABLE', 'CARD_GRID']).default('TABLE'),
  templateConfig: templateConfigSchema,
});

// CSVダッシュボード更新スキーマ
export const csvDashboardUpdateSchema = csvDashboardCreateSchema.partial();

// パラメータスキーマ
export const csvDashboardParamsSchema = z.object({
  id: z.string().uuid(),
});

// CSVアップロードスキーマ（multipart form data用）
export const csvUploadSchema = z.object({
  file: z.any(), // Fastifyのmultipart file
});
