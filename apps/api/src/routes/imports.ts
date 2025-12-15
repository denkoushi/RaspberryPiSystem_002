/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
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
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import { DropboxStorageProvider } from '../services/backup/storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from '../services/backup/dropbox-oauth.service.js';

const { EmployeeStatus, ItemStatus } = pkg;

const fieldSchema = z.object({
  replaceExisting: z.preprocess(
    (val) => {
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

const dropboxImportSchema = z.object({
  employeesPath: z.string().trim().min(1).regex(/\.csv$/i, 'employeesPathは.csvで終わる必要があります').optional(),
  itemsPath: z.string().trim().min(1).regex(/\.csv$/i, 'itemsPathは.csvで終わる必要があります').optional(),
  replaceExisting: z.boolean().optional().default(false)
}).refine((data) => data.employeesPath || data.itemsPath, {
  message: 'employeesPath または itemsPath のいずれかを指定してください'
});

const employeeCsvSchema = z.object({
  employeeCode: z.string().regex(/^\d{4}$/, '社員コードは数字4桁である必要があります（例: 0001）'),
  displayName: z.string().min(1, '氏名は必須です'),
  nfcTagUid: z.string().optional(),
  department: z.string().optional(),
  contact: z.string().optional(),
  status: z.string().optional()
});

const itemCsvSchema = z.object({
  itemCode: z.string().regex(/^TO\d{4}$/, '管理番号はTO + 数字4桁である必要があります（例: TO0001）'),
  name: z.string().min(1, '工具名は必須です'),
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
  if (!value || !value.trim()) return ItemStatus.AVAILABLE;
  const upper = value.trim().toUpperCase();
  if (upper in ItemStatus) {
    return ItemStatus[upper as keyof typeof ItemStatus];
  }
  // 無効な値の場合はデフォルト値（AVAILABLE）を使用（エラーにしない）
  return ItemStatus.AVAILABLE;
}

async function createDropboxStorageProviderFromConfig(
  protocol: string,
  host: string,
  onTokenUpdate?: (token: string) => Promise<void>
) {
  const config = await BackupConfigLoader.load();
  if (config.storage.provider !== 'dropbox') {
    throw new ApiError(400, '設定ファイルでDropboxがストレージとして設定されていません');
  }

  const accessToken = config.storage.options?.accessToken as string | undefined;
  const refreshToken = config.storage.options?.refreshToken as string | undefined;
  const appKey = config.storage.options?.appKey as string | undefined;
  const appSecret = config.storage.options?.appSecret as string | undefined;
  const basePath = config.storage.options?.basePath as string | undefined;

  if (!accessToken) {
    throw new ApiError(400, 'Dropbox access token is required in config file');
  }

  let oauthService: DropboxOAuthService | undefined;
  if (refreshToken && appKey && appSecret) {
    const redirectUri = `${protocol}://${host}/api/backup/oauth/callback`;
    oauthService = new DropboxOAuthService({
      appKey,
      appSecret,
      redirectUri
    });
  }

  return new DropboxStorageProvider({
    accessToken,
    basePath,
    refreshToken,
    oauthService,
    onTokenUpdate
  });
}

async function processCsvImport(
  files: { employees?: Buffer; items?: Buffer },
  replaceExisting: boolean,
  log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
) {
  if (!files.employees && !files.items) {
    throw new ApiError(400, 'employees.csv もしくは items.csv を指定してください');
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

  const employeeNfcTagUids = new Set(
    employeeRows
      .map(row => row.nfcTagUid?.trim())
      .filter((uid): uid is string => Boolean(uid))
  );
  const itemNfcTagUids = new Set(
    itemRows
      .map(row => row.nfcTagUid?.trim())
      .filter((uid): uid is string => Boolean(uid))
  );
  const crossDuplicateNfcTagUids = Array.from(employeeNfcTagUids).filter(uid => itemNfcTagUids.has(uid));
  if (crossDuplicateNfcTagUids.length > 0) {
    const errorMessage = `従業員とアイテムで同じnfcTagUidが使用されています: ${crossDuplicateNfcTagUids.map(uid => `"${uid}"`).join(', ')}。従業員とアイテムで同じnfcTagUidは使用できません。`;
    log.error({ crossDuplicateNfcTagUids }, '従業員とアイテム間でnfcTagUidが重複');
    throw new ApiError(400, errorMessage);
  }

  const summary: Record<string, ImportResult> = {};

  try {
    await prisma.$transaction(async (tx) => {
      if (employeeRows.length > 0) {
        summary.employees = await importEmployees(tx, employeeRows, replaceExisting, log);
      }
      if (itemRows.length > 0) {
        summary.items = await importItems(tx, itemRows, replaceExisting);
      }
    }, {
      timeout: 30000,
      isolationLevel: 'ReadCommitted'
    });
  } catch (error) {
    log.error({ 
      err: error,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: (error as any)?.code,
      errorMeta: (error as any)?.meta
    }, 'インポート処理エラー');
    
    if (error instanceof PrismaClientKnownRequestError) {
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
    
    if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2003') {
      const fieldName = ((error as any).meta as any)?.field_name || '不明なフィールド';
      const modelName = ((error as any).meta as any)?.model_name || '不明なモデル';
      throw new ApiError(400, `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。既存の貸出記録がある従業員やアイテムは削除できません。`);
    }
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(400, `インポート処理エラー: ${error instanceof Error ? error.message : '不明なエラー'}`);
  }

  return { summary };
}


async function importEmployees(
  tx: Prisma.TransactionClient,
  rows: EmployeeCsvRow[],
  replaceExisting: boolean,
  logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
): Promise<ImportResult> {
  // === 処理シーケンス ===
  // 1. 入力検証（rows.length === 0 の場合は早期リターン）
  // 2. replaceExisting=trueの場合: Loanレコードが存在しない従業員を削除
  // 3. CSV内のnfcTagUid重複チェック（CSV内での重複を検出）
  // 4. 各行をループ処理:
  //    4-1. 既存従業員の存在確認
  //    4-2. 既存の場合: 更新処理（DB内のnfcTagUid重複チェック含む）
  //    4-3. 新規の場合: 作成処理（DB内のnfcTagUid重複チェック含む）
  //    4-4. エラーハンドリング（P2002エラーの詳細化）
  // 5. 結果を返す

  // === 1. 入力検証 ===
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  // === 2. replaceExisting=trueの場合: Loanレコードが存在しない従業員を削除 ===
  if (replaceExisting) {
    // Loanレコードが存在する従業員は削除できないため、Loanレコードが存在しない従業員のみを削除
    // 外部キー制約違反を避けるため、Loanレコードが存在する従業員は削除しない
    try {
      const loans = await tx.loan.findMany({
        select: { employeeId: true }
      });
      const employeeIdsWithLoans = new Set(loans.map(l => l.employeeId).filter((id): id is string => id !== null));
      
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
    } catch (error) {
      logger?.error({ err: error }, '[importEmployees] Error in deleteMany');
      throw error;
    }
  }

  // === 3. CSV内のnfcTagUid重複チェック ===
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

  // === 4. 各行をループ処理 ===
  for (const row of rows) {
    // 4-1. 既存従業員の存在確認
    // 4-2. 既存の場合: 更新処理（DB内のnfcTagUid重複チェック含む）
    // 4-3. 新規の場合: 作成処理（DB内のnfcTagUid重複チェック含む）
    // 4-4. エラーハンドリング（P2002エラーの詳細化）

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
        // === 4-2. 既存の場合: 更新処理 ===
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
        await tx.employee.update({
          where: { employeeCode: row.employeeCode },
          data: finalUpdateData
        });
        result.updated += 1;
      } else {
        // === 4-3. 新規の場合: 作成処理 ===
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
        
        try {
          await tx.employee.create({
            data: createData
          });
          result.created += 1;
        } catch (createError) {
          // === 4-4. エラーハンドリング（P2002エラーの詳細化） ===
          if (createError instanceof PrismaClientKnownRequestError && createError.code === 'P2002') {
            const target = (createError.meta as any)?.target || [];
            if (target.includes('nfcTagUid')) {
              // 既存の従業員を再度検索して、どのemployeeCodeが使用しているかを特定
              const conflictingEmployee = nfcTagUidToCheck ? await tx.employee.findFirst({
                where: { nfcTagUid: nfcTagUidToCheck }
              }) : null;
              const errorMessage = conflictingEmployee
                ? `nfcTagUid="${nfcTagUidToCheck}"は既にemployeeCode="${conflictingEmployee.employeeCode}"で使用されています。employeeCode="${row.employeeCode}"では使用できません。`
                : `nfcTagUid="${nfcTagUidToCheck || '(空)'}"は既に使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
              logger?.error({ 
                nfcTagUid: nfcTagUidToCheck,
                employeeCode: row.employeeCode,
                errorCode: createError.code,
                errorMeta: createError.meta,
                conflictingEmployee: conflictingEmployee ? {
                  id: conflictingEmployee.id,
                  employeeCode: conflictingEmployee.employeeCode,
                  nfcTagUid: conflictingEmployee.nfcTagUid
                } : null
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

  // === 5. 結果を返す ===
  return result;
}

async function importItems(
  tx: Prisma.TransactionClient,
  rows: ItemCsvRow[],
  replaceExisting: boolean
): Promise<ImportResult> {
  // === 処理シーケンス ===
  // 1. 入力検証（rows.length === 0 の場合は早期リターン）
  // 2. replaceExisting=trueの場合: Loanレコードが存在しないアイテムを削除
  // 3. CSV内のnfcTagUid重複チェック（CSV内での重複を検出）
  // 4. 各行をループ処理:
  //    4-1. 既存アイテムの存在確認
  //    4-2. 既存の場合: 更新処理（DB内のnfcTagUid重複チェック含む）
  //    4-3. 新規の場合: 作成処理（DB内のnfcTagUid重複チェック含む）
  //    4-4. エラーハンドリング（P2002エラーの詳細化）
  // 5. 結果を返す

  // === 1. 入力検証 ===
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  // === 2. replaceExisting=trueの場合: Loanレコードが存在しないアイテムを削除 ===
  if (replaceExisting) {
    // Loanレコードが存在するアイテムは削除できないため、Loanレコードが存在しないアイテムのみを削除
    // 外部キー制約違反を避けるため、Loanレコードが存在するアイテムは削除しない
    const loans = await tx.loan.findMany({
      select: { itemId: true }
    });
    // itemIdがnullの場合は除外（nullableになったため）
    const itemIdsWithLoans = new Set(
      loans
        .map(l => l.itemId)
        .filter((id): id is string => id !== null)
    );
    
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

  // === 3. CSV内のnfcTagUid重複チェック ===
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

  // === 4. 各行をループ処理 ===
  for (const row of rows) {
    // 4-1. 既存アイテムの存在確認
    // 4-2. 既存の場合: 更新処理（DB内のnfcTagUid重複チェック含む）
    // 4-3. 新規の場合: 作成処理（DB内のnfcTagUid重複チェック含む）
    // 4-4. エラーハンドリング（P2002エラーの詳細化）

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
      // === 4-2. 既存の場合: 更新処理 ===
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
      // === 4-3. 新規の場合: 作成処理 ===
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

  // === 5. 結果を返す ===
  return result;
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // シンプルな同期処理: ジョブテーブルを使わず、結果を直接返す
  app.post('/imports/master', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request, reply) => {
    // === 処理シーケンス ===
    // 1. マルチパートリクエストの検証とファイル取得
    // 2. replaceExistingフラグの解析
    // 3. CSVファイルのパースとバリデーション
    // 4. 従業員とアイテム間のnfcTagUid重複チェック
    // 5. トランザクション内でインポート処理実行
    // 6. 結果を返す

    const files: { employees?: Buffer; items?: Buffer } = {};
    const fieldValues: Record<string, string> = {};

    // === 1. マルチパートリクエストの検証とファイル取得 ===
    try {
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
      request.log.error({ err: error }, 'マルチパート処理エラー');
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('multipart') || errorMessage.includes('content-type')) {
          throw new ApiError(400, `ファイルアップロードエラー: ${error.message}`);
        }
        throw new ApiError(400, `リクエスト処理エラー: ${error.message}`);
      }
      
      throw new ApiError(400, 'リクエストの処理に失敗しました');
    }

    // === 2. replaceExistingフラグの解析 ===
    const parsedFields = fieldSchema.parse(fieldValues);
    const rawReplaceExisting = parsedFields.replaceExisting;
    // Boolean()は使わない（'false'文字列がtrueになるため）
    const replaceExisting = rawReplaceExisting === true || 
                           (typeof rawReplaceExisting === 'string' && rawReplaceExisting === 'true') || 
                           (typeof rawReplaceExisting === 'number' && rawReplaceExisting === 1) || 
                           (typeof rawReplaceExisting === 'string' && rawReplaceExisting === '1') ||
                           false;

    const { summary } = await processCsvImport(files, replaceExisting, request.log);
    return { summary };
  });

  // DropboxからCSVを取得してインポート
  app.post('/imports/master/from-dropbox', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request) => {
    const body = dropboxImportSchema.parse(request.body ?? {});

    const protocol = (request.headers['x-forwarded-proto'] as string | undefined) || request.protocol || 'http';
    const host = request.headers.host || 'localhost:8080';

    const onTokenUpdate = async (token: string) => {
      const latestConfig = await BackupConfigLoader.load();
      if (latestConfig.storage.provider === 'dropbox') {
        latestConfig.storage.options = {
          ...(latestConfig.storage.options || {}),
          accessToken: token
        };
        await BackupConfigLoader.save(latestConfig);
      }
    };

    const dropboxProvider = await createDropboxStorageProviderFromConfig(protocol, host, onTokenUpdate);

    const files: { employees?: Buffer; items?: Buffer } = {};
    if (body.employeesPath) {
      files.employees = await dropboxProvider.download(body.employeesPath);
    }
    if (body.itemsPath) {
      files.items = await dropboxProvider.download(body.itemsPath);
    }

    const { summary } = await processCsvImport(files, body.replaceExisting ?? false, request.log);
    return { summary, source: 'dropbox' };
  });
}
