import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { authorizeRoles } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';

const { EmployeeStatus, ItemStatus } = pkg;

const fieldSchema = z.object({
  replaceExisting: z.preprocess(
    (val) => {
      // デバッグ: 値を確認
      console.log('[fieldSchema] replaceExisting raw value:', val, 'type:', typeof val);
      if (val === 'true' || val === true || val === '1' || val === 1) {
        return true;
      }
      if (val === 'false' || val === false || val === '0' || val === 0 || val === '' || val === null || val === undefined) {
        return false;
      }
      return val;
    },
    z.coerce.boolean().optional().default(false)
  )
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
  replaceExisting: boolean,
  logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
): Promise<ImportResult> {
  // エラーレベルでログを出して、確実に実行されていることを確認
  logger?.error({ replaceExisting, rowsCount: rows.length, __filename: import.meta.url }, '[importEmployees] ENTER');
  
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  // デバッグログ: replaceExistingの値を確認
  logger?.error({ replaceExisting, rowsCount: rows.length }, '[importEmployees] Starting import');

  if (replaceExisting) {
    // Loanレコードが存在する従業員は削除できないため、Loanレコードが存在しない従業員のみを削除
    // 外部キー制約違反を避けるため、Loanレコードが存在する従業員は削除しない
    try {
      logger?.info({}, '[importEmployees] Starting deleteMany with replaceExisting=true');
      // employeeIdは必須フィールドなので、nullになることはないが、念のためフィルタリング
      const loans = await tx.loan.findMany({
        select: { employeeId: true }
      });
      const employeeIdsWithLoans = new Set(loans.map(l => l.employeeId).filter((id): id is string => id !== null));
      
      logger?.info({ employeesWithLoans: employeeIdsWithLoans.size }, '[importEmployees] Found employees with loans');
      
      if (employeeIdsWithLoans.size > 0) {
        // Loanレコードが存在する従業員は削除しない
        await tx.employee.deleteMany({
          where: {
            id: {
              notIn: Array.from(employeeIdsWithLoans)
            }
          }
        });
      } else {
        // Loanレコードが存在しない場合は全て削除可能
        await tx.employee.deleteMany();
      }
      logger?.info({}, '[importEmployees] deleteMany completed successfully');
    } catch (error) {
      // 削除処理でエラーが発生した場合は、エラーを再スロー
      logger?.error({ err: error }, '[importEmployees] Error in deleteMany');
      throw error;
    }
  } else {
    logger?.error({ replaceExisting }, '[importEmployees] Skipping deleteMany (replaceExisting=false)');
  }
  // CSV内でnfcTagUidの重複をチェック
  const nfcTagUidMap = new Map<string, string[]>(); // nfcTagUid -> employeeCode[]
  for (const row of rows) {
    if (row.nfcTagUid && row.nfcTagUid.trim()) {
      const uid = row.nfcTagUid.trim();
      if (!nfcTagUidMap.has(uid)) {
        nfcTagUidMap.set(uid, []);
      }
      nfcTagUidMap.get(uid)!.push(row.employeeCode);
    }
  }
  // CSV内で重複しているnfcTagUidを検出
  const duplicateNfcTagUids = Array.from(nfcTagUidMap.entries())
    .filter(([_, codes]) => codes.length > 1)
    .map(([uid, codes]) => ({ uid, employeeCodes: codes }));
  if (duplicateNfcTagUids.length > 0) {
    const errorMessage = `CSV内でnfcTagUidが重複しています: ${duplicateNfcTagUids.map(({ uid, employeeCodes }) => `nfcTagUid="${uid}" (employeeCode: ${employeeCodes.join(', ')})`).join('; ')}`;
    logger?.error({ duplicateNfcTagUids }, '[importEmployees] CSV内でnfcTagUidが重複');
    throw new ApiError(400, errorMessage);
  }

  for (const row of rows) {
    // rowからidを明示的に除外（CSVにidカラムが含まれている場合に備える）
    const { id: _ignoredId, ...rowWithoutId } = row as any;
    
    // idは絶対に更新しない（外部キー制約違反を防ぐため）
    const updateData = {
      displayName: row.displayName,
      department: row.department || null,
      contact: row.contact || null,
      nfcTagUid: row.nfcTagUid || null,
      status: normalizeEmployeeStatus(row.status)
    };
    const createData = {
      employeeCode: row.employeeCode,
      ...updateData
    };
    try {
      const existing = await tx.employee.findUnique({ where: { employeeCode: row.employeeCode } });
      if (existing) {
        logger?.error({ 
          employeeCode: row.employeeCode,
          existingId: existing.id,
          updateDataKeys: Object.keys(updateData)
        }, '[importEmployees] Updating employee');
        
        // nfcTagUidが設定されている場合、他の従業員が同じnfcTagUidを持っていないかチェック
        const nfcTagUidToCheck = row.nfcTagUid ? row.nfcTagUid.trim() : null;
        if (nfcTagUidToCheck) {
          const otherEmployee = await tx.employee.findFirst({
            where: {
              nfcTagUid: nfcTagUidToCheck,
              employeeCode: { not: row.employeeCode }
            }
          });
          if (otherEmployee) {
            const errorMessage = `nfcTagUid="${nfcTagUidToCheck}"は既にemployeeCode="${otherEmployee.employeeCode}"で使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
            logger?.error({ 
              nfcTagUid: nfcTagUidToCheck,
              currentEmployeeCode: row.employeeCode,
              existingEmployeeCode: otherEmployee.employeeCode
            }, '[importEmployees] nfcTagUidの重複エラー');
            throw new ApiError(400, errorMessage);
          }
        }
        
        // update時はidを明示的に除外（念のため二重で防御）
        const { id: _ignoredId, createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, employeeCode: _ignoredEmployeeCode, ...finalUpdateData } = updateData as any;
        logger?.error({ 
          finalUpdateDataKeys: Object.keys(finalUpdateData),
          hasId: 'id' in finalUpdateData
        }, '[importEmployees] finalUpdateData確認');
        await tx.employee.update({
          where: { employeeCode: row.employeeCode },
          data: finalUpdateData
        });
        result.updated += 1;
      } else {
        // 新規作成時も、同じnfcTagUidを持つ既存の従業員が存在するかチェック
        const nfcTagUidToCheck = row.nfcTagUid ? row.nfcTagUid.trim() : null;
        if (nfcTagUidToCheck) {
          const existingWithSameNfcTag = await tx.employee.findFirst({
            where: {
              nfcTagUid: nfcTagUidToCheck
            }
          });
          if (existingWithSameNfcTag) {
            const errorMessage = `nfcTagUid="${nfcTagUidToCheck}"は既にemployeeCode="${existingWithSameNfcTag.employeeCode}"で使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
            logger?.error({ 
              nfcTagUid: nfcTagUidToCheck,
              newEmployeeCode: row.employeeCode,
              existingEmployeeCode: existingWithSameNfcTag.employeeCode
            }, '[importEmployees] nfcTagUidの重複エラー（新規作成時）');
            throw new ApiError(400, errorMessage);
          }
        }
        
        logger?.error({ 
          employeeCode: row.employeeCode,
          nfcTagUid: nfcTagUidToCheck
        }, '[importEmployees] Creating employee');
        try {
          await tx.employee.create({
            data: createData
          });
          result.created += 1;
        } catch (createError) {
          // P2002エラー（ユニーク制約違反）の場合、より詳細なエラーメッセージを返す
          if (createError instanceof PrismaClientKnownRequestError && createError.code === 'P2002') {
            const target = (createError.meta as any)?.target || [];
            if (target.includes('nfcTagUid')) {
              const errorMessage = `nfcTagUid="${nfcTagUidToCheck || '(空)'}"は既に使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
              logger?.error({ 
                nfcTagUid: nfcTagUidToCheck,
                employeeCode: row.employeeCode,
                errorCode: createError.code,
                errorMeta: createError.meta
              }, '[importEmployees] P2002エラー: nfcTagUidの重複');
              throw new ApiError(400, errorMessage);
            }
          }
          throw createError;
        }
      }
    } catch (error) {
      logger?.error({ 
        err: error,
        employeeCode: row.employeeCode,
        errorCode: (error as any)?.code,
        errorMeta: (error as any)?.meta
      }, '[importEmployees] Error processing row');
      throw error;
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
    // Loanレコードが存在するアイテムは削除できないため、Loanレコードが存在しないアイテムのみを削除
    // 外部キー制約違反を避けるため、Loanレコードが存在するアイテムは削除しない
    const loans = await tx.loan.findMany({
      select: { itemId: true }
    });
    const itemIdsWithLoans = new Set(loans.map(l => l.itemId));
    
    if (itemIdsWithLoans.size > 0) {
      // Loanレコードが存在するアイテムは削除しない
      await tx.item.deleteMany({
        where: {
          id: {
            notIn: Array.from(itemIdsWithLoans)
          }
        }
      });
    } else {
      // Loanレコードが存在しない場合は全て削除可能
      await tx.item.deleteMany();
    }
  }
  // CSV内でnfcTagUidの重複をチェック
  const itemNfcTagUidMap = new Map<string, string[]>(); // nfcTagUid -> itemCode[]
  for (const row of rows) {
    if (row.nfcTagUid && row.nfcTagUid.trim()) {
      const uid = row.nfcTagUid.trim();
      if (!itemNfcTagUidMap.has(uid)) {
        itemNfcTagUidMap.set(uid, []);
      }
      itemNfcTagUidMap.get(uid)!.push(row.itemCode);
    }
  }
  // CSV内で重複しているnfcTagUidを検出
  const duplicateItemNfcTagUids = Array.from(itemNfcTagUidMap.entries())
    .filter(([_, codes]) => codes.length > 1)
    .map(([uid, codes]) => ({ uid, itemCodes: codes }));
  if (duplicateItemNfcTagUids.length > 0) {
    const errorMessage = `CSV内でnfcTagUidが重複しています: ${duplicateItemNfcTagUids.map(({ uid, itemCodes }) => `nfcTagUid="${uid}" (itemCode: ${itemCodes.join(', ')})`).join('; ')}`;
    throw new ApiError(400, errorMessage);
  }

  for (const row of rows) {
    // idは絶対に更新しない（外部キー制約違反を防ぐため）
    const updateData = {
      name: row.name,
      description: row.notes || null,
      category: row.category || null,
      storageLocation: row.storageLocation || null,
      nfcTagUid: row.nfcTagUid || null,
      status: normalizeItemStatus(row.status),
      notes: row.notes || null
    };
    const createData = {
      itemCode: row.itemCode,
      ...updateData
    };
    const existing = await tx.item.findUnique({ where: { itemCode: row.itemCode } });
    if (existing) {
      // nfcTagUidが設定されている場合、他のアイテムが同じnfcTagUidを持っていないかチェック
      if (row.nfcTagUid && row.nfcTagUid.trim()) {
        const otherItem = await tx.item.findFirst({
          where: {
            nfcTagUid: row.nfcTagUid.trim(),
            itemCode: { not: row.itemCode }
          }
        });
        if (otherItem) {
          const errorMessage = `nfcTagUid="${row.nfcTagUid}"は既にitemCode="${otherItem.itemCode}"で使用されています。itemCode="${row.itemCode}"では使用できません。`;
          throw new ApiError(400, errorMessage);
        }
      }
      
      // update時はidを明示的に除外（念のため二重で防御）
      const { id: _ignoredId, createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, itemCode: _ignoredItemCode, ...finalUpdateData } = updateData as any;
      await tx.item.update({
        where: { itemCode: row.itemCode },
        data: finalUpdateData
      });
      result.updated += 1;
    } else {
      // 新規作成時も、同じnfcTagUidを持つ既存のアイテムが存在するかチェック
      if (row.nfcTagUid && row.nfcTagUid.trim()) {
        const existingWithSameNfcTag = await tx.item.findFirst({
          where: {
            nfcTagUid: row.nfcTagUid.trim()
          }
        });
        if (existingWithSameNfcTag) {
          const errorMessage = `nfcTagUid="${row.nfcTagUid}"は既にitemCode="${existingWithSameNfcTag.itemCode}"で使用されています。itemCode="${row.itemCode}"では使用できません。`;
          throw new ApiError(400, errorMessage);
        }
      }
      
      await tx.item.create({
        data: createData
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

    // replaceExistingの値を確実に取得（文字列も含めて明示的に判定）
    const parsedFields = fieldSchema.parse(fieldValues);
    const rawReplaceExisting = parsedFields.replaceExisting;
    // Boolean()は使わない（'false'文字列がtrueになるため）
    const replaceExisting = rawReplaceExisting === true || 
                           (typeof rawReplaceExisting === 'string' && rawReplaceExisting === 'true') || 
                           (typeof rawReplaceExisting === 'number' && rawReplaceExisting === 1) || 
                           (typeof rawReplaceExisting === 'string' && rawReplaceExisting === '1') ||
                           false;
    
    // デバッグログ: フォームから取得した値を確認
    request.log.info({ 
      fieldValues,
      parsedFields,
      replaceExisting,
      replaceExistingType: typeof replaceExisting
    }, 'replaceExisting値の確認');

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

    // デバッグログ: replaceExistingの値を確認
    request.log.info({ 
      replaceExisting,
      replaceExistingType: typeof replaceExisting,
      employeeRowsCount: employeeRows.length,
      itemRowsCount: itemRows.length,
      fieldValues
    }, 'インポート処理開始前');

    try {
      request.log.error({ replaceExisting, replaceExistingType: typeof replaceExisting }, '[imports] handler start - トランザクション開始前');
      // awaitを確実につける
      await prisma.$transaction(async (tx) => {
        // トランザクション内でもreplaceExistingの値を確認
        request.log.error({ 
          replaceExisting,
          replaceExistingType: typeof replaceExisting,
          employeeRowsCount: employeeRows.length
        }, '[imports] トランザクション内: importEmployees呼び出し前');
        if (employeeRows.length > 0) {
          // replaceExistingの値を確実に渡す（Boolean()は使わない）
          request.log.error({ replaceExisting }, '[imports] importEmployeesに渡すreplaceExisting値');
          summary.employees = await importEmployees(tx, employeeRows, replaceExisting, request.log);
        }
        request.log.error({ replaceExisting }, '[imports] トランザクション内: importItems呼び出し前');
        if (itemRows.length > 0) {
          summary.items = await importItems(tx, itemRows, replaceExisting);
        }
        request.log.error({}, '[imports] トランザクション内: すべての処理完了');
      }, {
        timeout: 30000, // 30秒のタイムアウト
        isolationLevel: 'ReadCommitted' // 読み取りコミット分離レベル
      });
      request.log.error({}, '[imports] トランザクション完了');
    } catch (error) {
      // トランザクション内で発生したエラーをキャッチ
      request.log.error({ 
        err: error,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        errorMeta: (error as any)?.meta
      }, 'インポート処理エラー');
      
      if (error instanceof PrismaClientKnownRequestError) {
        // PrismaエラーをApiErrorとしてラップ
        if (error.code === 'P2003') {
          const fieldName = (error.meta as any)?.field_name || '不明なフィールド';
          const modelName = (error.meta as any)?.model_name || '不明なモデル';
          throw new ApiError(
            400,
            `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。既存の貸出記録がある従業員やアイテムは削除できません。`,
            { code: error.code, ...error.meta }
          );
        }
        throw new ApiError(400, `データベースエラー: ${error.code} - ${error.message}`, { code: error.code, ...error.meta });
      }
      
      // PrismaClientKnownRequestErrorのインスタンスチェックが失敗する場合のフォールバック
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2003') {
        const fieldName = ((error as any).meta as any)?.field_name || '不明なフィールド';
        const modelName = ((error as any).meta as any)?.model_name || '不明なモデル';
        throw new ApiError(400, `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。既存の貸出記録がある従業員やアイテムは削除できません。`);
      }
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      // その他のエラー
      throw new ApiError(400, `インポート処理エラー: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }

    return { summary };
  });
}
