import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { authorizeRoles } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';

const { EmployeeStatus, ItemStatus } = pkg;

const fieldSchema = z.object({
  replaceExisting: z.coerce.boolean().optional().default(false)
});

const employeeCsvSchema = z.object({
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  nfcTagUid: z.string().optional(),
  department: z.string().optional(),
  contact: z.string().optional(),
  status: z.string().optional()
});

const itemCsvSchema = z.object({
  itemCode: z.string().min(1),
  name: z.string().min(1),
  nfcTagUid: z.string().optional(),
  category: z.string().optional(),
  storageLocation: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional()
});

type EmployeeCsvRow = z.infer<typeof employeeCsvSchema>;
type ItemCsvRow = z.infer<typeof itemCsvSchema>;

interface ImportResult {
  processed: number;
  created: number;
  updated: number;
}

async function readFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  if (!buffer.length) {
    return [];
  }
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];
}

function normalizeEmployeeStatus(value?: string) {
  if (!value) return EmployeeStatus.ACTIVE;
  const upper = value.trim().toUpperCase();
  if (upper in EmployeeStatus) {
    return EmployeeStatus[upper as keyof typeof EmployeeStatus];
  }
  throw new ApiError(400, `無効な従業員ステータス: ${value}`);
}

function normalizeItemStatus(value?: string) {
  if (!value) return ItemStatus.AVAILABLE;
  const upper = value.trim().toUpperCase();
  if (upper in ItemStatus) {
    return ItemStatus[upper as keyof typeof ItemStatus];
  }
  throw new ApiError(400, `無効なアイテムステータス: ${value}`);
}

async function importEmployees(
  tx: Prisma.TransactionClient,
  rows: EmployeeCsvRow[],
  replaceExisting: boolean
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  if (replaceExisting) {
    await tx.employee.deleteMany();
  }
  for (const row of rows) {
    const payload = {
      displayName: row.displayName,
      department: row.department || null,
      contact: row.contact || null,
      nfcTagUid: row.nfcTagUid || null,
      status: normalizeEmployeeStatus(row.status)
    };
    const existing = await tx.employee.findUnique({ where: { employeeCode: row.employeeCode } });
    if (existing) {
      await tx.employee.update({
        where: { employeeCode: row.employeeCode },
        data: payload
      });
      result.updated += 1;
    } else {
      await tx.employee.create({
        data: {
          employeeCode: row.employeeCode,
          ...payload
        }
      });
      result.created += 1;
    }
  }

  return result;
}

async function importItems(
  tx: Prisma.TransactionClient,
  rows: ItemCsvRow[],
  replaceExisting: boolean
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  if (replaceExisting) {
    await tx.item.deleteMany();
  }
  for (const row of rows) {
    const payload = {
      name: row.name,
      description: row.notes || null,
      category: row.category || null,
      storageLocation: row.storageLocation || null,
      nfcTagUid: row.nfcTagUid || null,
      status: normalizeItemStatus(row.status),
      notes: row.notes || null
    };
    const existing = await tx.item.findUnique({ where: { itemCode: row.itemCode } });
    if (existing) {
      await tx.item.update({
        where: { itemCode: row.itemCode },
        data: payload
      });
      result.updated += 1;
    } else {
      await tx.item.create({
        data: {
          itemCode: row.itemCode,
          ...payload
        }
      });
      result.created += 1;
    }
  }

  return result;
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // シンプルな同期処理: ジョブテーブルを使わず、結果を直接返す
  app.post('/imports/master', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request, reply) => {
    const files: { employees?: Buffer; items?: Buffer } = {};
    const fieldValues: Record<string, string> = {};

    try {
      // マルチパートリクエストの処理
      if (!request.isMultipart()) {
        throw new ApiError(400, 'マルチパートフォームデータが必要です。Content-Type: multipart/form-dataを指定してください。');
      }

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await readFile(part);
          if (part.fieldname === 'employees') {
            files.employees = buffer;
          } else if (part.fieldname === 'items') {
            files.items = buffer;
          }
        } else {
          fieldValues[part.fieldname] = String(part.value);
        }
      }
    } catch (error) {
      // エラーログを記録
      request.log.error({ err: error }, 'マルチパート処理エラー');
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      if (error instanceof Error) {
        // マルチパート関連のエラーかどうかを判定
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('multipart') || errorMessage.includes('content-type')) {
          throw new ApiError(400, `ファイルアップロードエラー: ${error.message}`);
        }
        // その他のエラーもApiErrorとしてラップ
        throw new ApiError(400, `リクエスト処理エラー: ${error.message}`);
      }
      
      // 未知のエラー
      throw new ApiError(400, 'リクエストの処理に失敗しました');
    }

    const { replaceExisting } = fieldSchema.parse(fieldValues);

    if (!files.employees && !files.items) {
      throw new ApiError(400, 'employees.csv もしくは items.csv をアップロードしてください');
    }

    let employeeRows: EmployeeCsvRow[] = [];
    let itemRows: ItemCsvRow[] = [];

    if (files.employees) {
      try {
        const parsedRows = parseCsvRows(files.employees);
        employeeRows = parsedRows.map((row, index) => {
          try {
            return employeeCsvSchema.parse(row);
          } catch (error) {
            throw new ApiError(400, `従業員CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      } catch (error) {
        throw new ApiError(400, `従業員CSVの解析エラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (files.items) {
      try {
        const parsedRows = parseCsvRows(files.items);
        itemRows = parsedRows.map((row, index) => {
          try {
            return itemCsvSchema.parse(row);
          } catch (error) {
            throw new ApiError(400, `アイテムCSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      } catch (error) {
        throw new ApiError(400, `アイテムCSVの解析エラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 同期処理: トランザクション内でインポートを実行し、結果を直接返す
    const summary: Record<string, ImportResult> = {};

    await prisma.$transaction(async (tx) => {
      if (employeeRows.length > 0) {
        summary.employees = await importEmployees(tx, employeeRows, replaceExisting);
      }
      if (itemRows.length > 0) {
        summary.items = await importItems(tx, itemRows, replaceExisting);
      }
    });

    return { summary };
  });
}
