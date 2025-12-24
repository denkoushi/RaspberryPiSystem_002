/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { z, ZodError } from 'zod';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { authorizeRoles } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import { DropboxStorageProvider } from '../services/backup/storage/dropbox-storage.provider.js';
import { GmailStorageProvider } from '../services/backup/storage/gmail-storage.provider.js';
import { DropboxOAuthService } from '../services/backup/dropbox-oauth.service.js';
import { GmailOAuthService } from '../services/backup/gmail-oauth.service.js';

const { EmployeeStatus, ItemStatus, ImportStatus } = pkg;

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

// パストラバーサル防止: .. や絶対パスを拒否
function validateDropboxPath(path: string): boolean {
  // 空文字列は既にmin(1)で除外される
  const normalized = path.trim();
  
  // .. を含むパスを拒否
  if (normalized.includes('..')) {
    return false;
  }
  
  // 先頭が / で始まる絶対パスは許可（Dropboxのパス形式）
  // ただし、/ のみや /../ のような危険なパスは拒否
  if (normalized.startsWith('/')) {
    // /../ や // を含むパスを拒否
    if (normalized.includes('/../') || normalized.includes('//')) {
      return false;
    }
    // / のみは拒否
    if (normalized === '/') {
      return false;
    }
    // /. で始まるパス（例: /.csv, /..csv）を拒否
    if (normalized.startsWith('/.')) {
      return false;
    }
  }
  
  // パス長の上限（1000文字）
  if (normalized.length > 1000) {
    return false;
  }
  
  return true;
}

const dropboxPathSchema = z.string()
  .trim()
  .min(1, 'パスは必須です')
  .max(1000, 'パスは1000文字以内である必要があります')
  .regex(/\.csv$/i, 'パスは.csvで終わる必要があります')
  .refine(validateDropboxPath, {
    message: '無効なパス形式です。パストラバーサル（..）や危険なパスは許可されません'
  });

const dropboxImportSchema = z.object({
  employeesPath: dropboxPathSchema.optional(),
  itemsPath: dropboxPathSchema.optional(),
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
    const redirectUri = `${protocol}://${host}/api/backup/oauth/dropbox/callback`;
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

async function createGmailStorageProviderFromConfig(
  protocol: string,
  host: string,
  onTokenUpdate?: (token: string) => Promise<void>
) {
  const config = await BackupConfigLoader.load();
  if (config.storage.provider !== 'gmail') {
    throw new ApiError(400, '設定ファイルでGmailがストレージとして設定されていません');
  }

  const accessToken = config.storage.options?.accessToken as string | undefined;
  const refreshToken = config.storage.options?.refreshToken as string | undefined;
  const clientId = config.storage.options?.clientId as string | undefined;
  const clientSecret = config.storage.options?.clientSecret as string | undefined;
  const subjectPattern = config.storage.options?.subjectPattern as string | undefined;
  const labelName = config.storage.options?.labelName as string | undefined;
  const basePath = config.storage.options?.basePath as string | undefined;

  if (!accessToken) {
    throw new ApiError(400, 'Gmail access token is required in config file');
  }

  if (!subjectPattern) {
    throw new ApiError(400, 'Gmail subject pattern is required in config file');
  }

  let oauthService: GmailOAuthService | undefined;
  if (refreshToken && clientId && clientSecret) {
    const redirectUri = `${protocol}://${host}/api/backup/oauth/gmail/callback`;
    oauthService = new GmailOAuthService({
      clientId,
      clientSecret,
      redirectUri
    });
  }

  return new GmailStorageProvider({
    accessToken,
    refreshToken,
    subjectPattern,
    labelName,
    basePath,
    oauthService,
    onTokenUpdate
  });
}

export async function processCsvImport(
  files: { employees?: Buffer; items?: Buffer },
  replaceExisting: boolean,
  log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
) {
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
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    
    try {
      const body = dropboxImportSchema.parse(request.body ?? {});

      const protocol = (request.headers['x-forwarded-proto'] as string | undefined) || request.protocol || 'http';
      const host = request.headers.host || 'localhost:8080';

      request.log.info({
        employeesPath: body.employeesPath,
        itemsPath: body.itemsPath,
        replaceExisting: body.replaceExisting
      }, '[Dropbox Import] インポート開始');

      const onTokenUpdate = async (token: string) => {
        const latestConfig = await BackupConfigLoader.load();
        if (latestConfig.storage.provider === 'dropbox') {
          latestConfig.storage.options = {
            ...(latestConfig.storage.options || {}),
            accessToken: token
          };
          await BackupConfigLoader.save(latestConfig);
          request.log.info({}, '[Dropbox Import] アクセストークンを更新しました');
        }
      };

      const dropboxProvider = await createDropboxStorageProviderFromConfig(protocol, host, onTokenUpdate);

      const files: { employees?: Buffer; items?: Buffer } = {};
      
      // 従業員CSVのダウンロード
      if (body.employeesPath) {
        try {
          request.log.info({ path: body.employeesPath }, '[Dropbox Import] 従業員CSVダウンロード開始');
          const downloadStart = Date.now();
          files.employees = await dropboxProvider.download(body.employeesPath);
          const downloadTime = Date.now() - downloadStart;
          const fileSize = files.employees.length;
          request.log.info({
            path: body.employeesPath,
            size: fileSize,
            downloadTimeMs: downloadTime
          }, '[Dropbox Import] 従業員CSVダウンロード完了');
        } catch (error: unknown) {
          request.log.error({ err: error, path: body.employeesPath }, '[Dropbox Import] 従業員CSVダウンロード失敗');
          if (error instanceof Error) {
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('not_found') || errorMessage.includes('not found')) {
              throw new ApiError(404, `従業員CSVファイルが見つかりません: ${body.employeesPath}`);
            }
            if (errorMessage.includes('unauthorized') || errorMessage.includes('expired')) {
              throw new ApiError(401, `Dropbox認証エラー: ${error.message}`);
            }
            throw new ApiError(500, `従業員CSVのダウンロードに失敗しました: ${error.message}`);
          }
          throw new ApiError(500, `従業員CSVのダウンロードに失敗しました`);
        }
      }
      
      // アイテムCSVのダウンロード
      if (body.itemsPath) {
        try {
          request.log.info({ path: body.itemsPath }, '[Dropbox Import] アイテムCSVダウンロード開始');
          const downloadStart = Date.now();
          files.items = await dropboxProvider.download(body.itemsPath);
          const downloadTime = Date.now() - downloadStart;
          const fileSize = files.items.length;
          request.log.info({
            path: body.itemsPath,
            size: fileSize,
            downloadTimeMs: downloadTime
          }, '[Dropbox Import] アイテムCSVダウンロード完了');
        } catch (error: unknown) {
          request.log.error({ err: error, path: body.itemsPath }, '[Dropbox Import] アイテムCSVダウンロード失敗');
          if (error instanceof Error) {
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('not_found') || errorMessage.includes('not found')) {
              throw new ApiError(404, `アイテムCSVファイルが見つかりません: ${body.itemsPath}`);
            }
            if (errorMessage.includes('unauthorized') || errorMessage.includes('expired')) {
              throw new ApiError(401, `Dropbox認証エラー: ${error.message}`);
            }
            throw new ApiError(500, `アイテムCSVのダウンロードに失敗しました: ${error.message}`);
          }
          throw new ApiError(500, `アイテムCSVのダウンロードに失敗しました`);
        }
      }

      // CSVインポート処理
      const importStart = Date.now();
      const { summary } = await processCsvImport(files, body.replaceExisting ?? false, request.log);
      const importTime = Date.now() - importStart;
      
      // メモリ使用量の計測
      const finalMemory = process.memoryUsage();
      const memoryDelta = {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss
      };
      const totalTime = Date.now() - startTime;
      
      request.log.info({
        summary,
        importTimeMs: importTime,
        totalTimeMs: totalTime,
        memoryDelta,
        replaceExisting: body.replaceExisting
      }, '[Dropbox Import] インポート完了');
      
      return { summary, source: 'dropbox' };
    } catch (error: unknown) {
      const totalTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage();
      const memoryDelta = {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss
      };
      
      request.log.error({
        err: error,
        totalTimeMs: totalTime,
        memoryDelta
      }, '[Dropbox Import] インポート失敗');
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      // ZodErrorはバリデーションエラーなので400を返す
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        const errorMessage = firstIssue?.message || 'バリデーションエラー';
        throw new ApiError(400, errorMessage);
      }
      
      if (error instanceof Error) {
        throw new ApiError(500, `Dropboxインポート処理に失敗しました: ${error.message}`);
      }
      
      throw new ApiError(500, 'Dropboxインポート処理に失敗しました');
    }
  });

  // GmailからCSVを取得してインポート
  app.post('/imports/master/from-gmail', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request) => {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    
    try {
      const protocol = (request.headers['x-forwarded-proto'] as string | undefined) || request.protocol || 'http';
      const host = request.headers.host || 'localhost:8080';

      request.log.info({}, '[Gmail Import] インポート開始');

      const onTokenUpdate = async (token: string) => {
        const latestConfig = await BackupConfigLoader.load();
        if (latestConfig.storage.provider === 'gmail') {
          latestConfig.storage.options = {
            ...(latestConfig.storage.options || {}),
            accessToken: token
          };
          await BackupConfigLoader.save(latestConfig);
          request.log.info({}, '[Gmail Import] アクセストークンを更新しました');
        }
      };

      const gmailProvider = await createGmailStorageProviderFromConfig(protocol, host, onTokenUpdate);

      // 件名パターンにマッチするメールのリストを取得
      const fileInfos = await gmailProvider.list('');
      
      if (fileInfos.length === 0) {
        request.log.info({}, '[Gmail Import] 該当するメールが見つかりませんでした');
        return { summary: {}, source: 'gmail', message: '該当するメールが見つかりませんでした' };
      }

      const files: { employees?: Buffer; items?: Buffer } = {};
      const processedMessageIds: string[] = [];

      // 各メールから添付ファイルをダウンロード
      // GmailApiClientを直接使用してメールの件名を取得
      const { GmailApiClient } = await import('../services/backup/gmail-api.client.js');
      const config = await BackupConfigLoader.load();
      const gmailClient = new GmailApiClient({
        accessToken: config.storage.options?.accessToken as string,
        refreshToken: config.storage.options?.refreshToken as string | undefined,
        onTokenUpdate
      });

      for (const fileInfo of fileInfos) {
        try {
          const [messageId] = fileInfo.path.split(':');
          if (!messageId) {
            continue;
          }

          request.log.info({ messageId, path: fileInfo.path }, '[Gmail Import] メールから添付ファイルをダウンロード開始');
          
          // メールの件名を取得
          const message = await gmailClient.getMessage(messageId);
          const subjectHeader = message.payload.headers.find(h => h.name.toLowerCase() === 'subject');
          const subject = subjectHeader?.value || '';
          
          request.log.info({ messageId, subject }, '[Gmail Import] メール件名を取得');

          // 件名からファイルタイプを判定（employeesまたはitems）
          let fileType: 'employees' | 'items' | null = null;
          if (subject.includes('employees-') || subject.toLowerCase().includes('employee')) {
            fileType = 'employees';
          } else if (subject.includes('items-') || subject.toLowerCase().includes('item')) {
            fileType = 'items';
          }

          if (!fileType) {
            request.log.warn({ messageId, subject }, '[Gmail Import] ファイルタイプを判定できませんでした');
            continue;
          }

          const attachmentData = await gmailProvider.download(fileInfo.path);
          
          if (fileType === 'employees') {
            files.employees = attachmentData;
            processedMessageIds.push(messageId);
          } else if (fileType === 'items') {
            files.items = attachmentData;
            processedMessageIds.push(messageId);
          }

          request.log.info({ messageId, fileType, size: attachmentData.length }, '[Gmail Import] 添付ファイルダウンロード完了');
        } catch (error: unknown) {
          request.log.error({ err: error, path: fileInfo.path }, '[Gmail Import] 添付ファイルダウンロード失敗');
          // エラーが発生したメールはスキップして続行
          continue;
        }
      }

      if (!files.employees && !files.items) {
        request.log.warn({}, '[Gmail Import] 有効なCSVファイルが見つかりませんでした');
        return { summary: {}, source: 'gmail', message: '有効なCSVファイルが見つかりませんでした' };
      }

      // CSVインポート処理
      const importStart = Date.now();
      const { summary } = await processCsvImport(files, false, request.log);
      const importTime = Date.now() - importStart;
      
      // 処理済みメールをマーク
      for (const messageId of processedMessageIds) {
        try {
          await gmailProvider.markAsProcessed(messageId);
          request.log.info({ messageId }, '[Gmail Import] メールを処理済みとしてマーク');
        } catch (error: unknown) {
          request.log.error({ err: error, messageId }, '[Gmail Import] メールの処理済みマークに失敗');
          // エラーが発生しても続行
        }
      }
      
      // メモリ使用量の計測
      const finalMemory = process.memoryUsage();
      const memoryDelta = {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss
      };
      const totalTime = Date.now() - startTime;
      
      request.log.info({
        summary,
        importTimeMs: importTime,
        totalTimeMs: totalTime,
        memoryDelta,
        processedMessageCount: processedMessageIds.length
      }, '[Gmail Import] インポート完了');
      
      return { summary, source: 'gmail', processedMessageCount: processedMessageIds.length };
    } catch (error: unknown) {
      const totalTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage();
      const memoryDelta = {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss
      };
      
      request.log.error({
        err: error,
        totalTimeMs: totalTime,
        memoryDelta
      }, '[Gmail Import] インポート失敗');
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      // ZodErrorはバリデーションエラーなので400を返す
      if (error instanceof ZodError) {
        const firstIssue = error.issues[0];
        const errorMessage = firstIssue?.message || 'バリデーションエラー';
        throw new ApiError(400, errorMessage);
      }
      
      if (error instanceof Error) {
        throw new ApiError(500, `Gmailインポート処理に失敗しました: ${error.message}`);
      }
      
      throw new ApiError(500, 'Gmailインポート処理に失敗しました');
    }
  });

  // === CSVインポートスケジュール管理API ===
  
  // スケジュール一覧取得
  app.get('/imports/schedule', { preHandler: mustBeAdmin }, async () => {
    const config = await BackupConfigLoader.load();
    return {
      schedules: config.csvImports || []
    };
  });

  // スケジュール追加
  const csvImportScheduleSchema = z.object({
    id: z.string().min(1, 'IDは必須です'),
    name: z.string().optional(),
    employeesPath: z.string().regex(/\.csv$/i, 'employeesPathは.csvで終わる必要があります').optional(),
    itemsPath: z.string().regex(/\.csv$/i, 'itemsPathは.csvで終わる必要があります').optional(),
    schedule: z.string().min(1, 'スケジュール（cron形式）は必須です'),
    enabled: z.boolean().optional().default(true),
    replaceExisting: z.boolean().optional().default(false),
    autoBackupAfterImport: z.object({
      enabled: z.boolean().default(false),
      targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv'])
    }).optional().default({ enabled: false, targets: ['csv'] })
  }).refine((data) => data.employeesPath || data.itemsPath, {
    message: 'employeesPath または itemsPath のいずれかを指定してください'
  });

  app.post('/imports/schedule', { preHandler: mustBeAdmin }, async (request) => {
    const body = csvImportScheduleSchema.parse(request.body ?? {});
    
    const config = await BackupConfigLoader.load();
    
    // IDの重複チェック
    if (config.csvImports?.some(s => s.id === body.id)) {
      throw new ApiError(409, `スケジュールIDが既に存在します: ${body.id}`);
    }

    // スケジュールを追加
    const newSchedule = {
      id: body.id,
      name: body.name,
      employeesPath: body.employeesPath,
      itemsPath: body.itemsPath,
      schedule: body.schedule,
      enabled: body.enabled ?? true,
      replaceExisting: body.replaceExisting ?? false,
      autoBackupAfterImport: body.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] }
    };

    config.csvImports = [...(config.csvImports || []), newSchedule];
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み
    const { getCsvImportScheduler } = await import('../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    await scheduler.reload();

    request.log.info({ scheduleId: body.id }, '[CSV Import Schedule] Schedule added');
    return { schedule: newSchedule };
  });

  // スケジュール更新用スキーマ（すべてのフィールドをオプショナルに）
  const csvImportScheduleUpdateSchema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().optional(),
    employeesPath: z.string().regex(/\.csv$/i, 'employeesPathは.csvで終わる必要があります').optional(),
    itemsPath: z.string().regex(/\.csv$/i, 'itemsPathは.csvで終わる必要があります').optional(),
    schedule: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    replaceExisting: z.boolean().optional(),
    autoBackupAfterImport: z.object({
      enabled: z.boolean().default(false),
      targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv'])
    }).optional()
  }).refine((data) => !data.employeesPath && !data.itemsPath || data.employeesPath || data.itemsPath, {
    message: 'employeesPath または itemsPath のいずれかを指定してください'
  });

  // スケジュール更新
  app.put('/imports/schedule/:id', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = csvImportScheduleUpdateSchema.parse(request.body ?? {});
    
    const config = await BackupConfigLoader.load();
    const scheduleIndex = config.csvImports?.findIndex(s => s.id === id);
    
    if (scheduleIndex === undefined || scheduleIndex === -1) {
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }

    // スケジュールを更新
    const existingSchedule = config.csvImports![scheduleIndex];
    const updatedSchedule = {
      ...existingSchedule,
      ...body,
      id, // IDは変更不可
      // autoBackupAfterImportが指定されていない場合は既存の値を保持
      autoBackupAfterImport: body.autoBackupAfterImport ?? existingSchedule.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] }
    };

    config.csvImports![scheduleIndex] = updatedSchedule;
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み
    const { getCsvImportScheduler } = await import('../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    await scheduler.reload();

    request.log.info({ scheduleId: id }, '[CSV Import Schedule] Schedule updated');
    return { schedule: updatedSchedule };
  });

  // スケジュール削除
  app.delete('/imports/schedule/:id', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    
    const config = await BackupConfigLoader.load();
    const scheduleIndex = config.csvImports?.findIndex(s => s.id === id);
    
    if (scheduleIndex === undefined || scheduleIndex === -1) {
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }

    // スケジュールを削除
    config.csvImports = config.csvImports!.filter(s => s.id !== id);
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み
    const { getCsvImportScheduler } = await import('../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    await scheduler.reload();

    request.log.info({ scheduleId: id }, '[CSV Import Schedule] Schedule deleted');
    return { message: 'スケジュールを削除しました' };
  });

  // 手動実行
  app.post('/imports/schedule/:id/run', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    
    // スケジュールが存在するか確認
    const config = await BackupConfigLoader.load();
    const schedule = config.csvImports?.find(s => s.id === id);
    
    if (!schedule) {
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }
    
    const { getCsvImportScheduler } = await import('../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    
    try {
      await scheduler.runImport(id);
      request.log.info({ scheduleId: id }, '[CSV Import Schedule] Manual import completed');
      return { message: 'インポートを実行しました' };
    } catch (error) {
      request.log.error({ err: error, scheduleId: id }, '[CSV Import Schedule] Manual import failed');
      if (error instanceof Error) {
        // スケジュールが見つからないエラーの場合は404
        if (error.message.includes('not found') || error.message.includes('見つかりません')) {
          throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
        }
        throw new ApiError(500, `インポート実行に失敗しました: ${error.message}`);
      }
      throw new ApiError(500, 'インポート実行に失敗しました');
    }
  });

  // === CSVインポート履歴API ===
  
  // 履歴一覧取得（フィルタ/ページング対応）
  app.get('/imports/history', { preHandler: mustBeAdmin }, async (request) => {
    const { ImportHistoryService } = await import('../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();
    
    const query = request.query as {
      status?: string;
      scheduleId?: string;
      startDate?: string;
      endDate?: string;
      offset?: string;
      limit?: string;
    };
    
    const status = (query.status && Object.values(ImportStatus).includes(query.status as any)) 
      ? (query.status as typeof ImportStatus[keyof typeof ImportStatus])
      : undefined;
    const scheduleId = query.scheduleId;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    
    const result = await historyService.getHistoryWithFilter({
      status,
      scheduleId,
      startDate,
      endDate,
      offset,
      limit
    });
    
    return result;
  });

  // スケジュールIDで履歴取得（フィルタ/ページング対応）
  app.get('/imports/schedule/:id/history', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    
    const { ImportHistoryService } = await import('../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();
    
    const query = request.query as {
      status?: string;
      startDate?: string;
      endDate?: string;
      offset?: string;
      limit?: string;
    };
    
    const status = (query.status && Object.values(ImportStatus).includes(query.status as any)) 
      ? (query.status as typeof ImportStatus[keyof typeof ImportStatus])
      : undefined;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    
    const result = await historyService.getHistoryWithFilter({
      scheduleId: id,
      status,
      startDate,
      endDate,
      offset,
      limit
    });
    
    return result;
  });

  // 失敗した履歴取得（フィルタ/ページング対応）
  app.get('/imports/history/failed', { preHandler: mustBeAdmin }, async (request) => {
    const { ImportHistoryService } = await import('../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();
    
    const query = request.query as {
      scheduleId?: string;
      startDate?: string;
      endDate?: string;
      offset?: string;
      limit?: string;
    };
    
    const scheduleId = query.scheduleId;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    
    const result = await historyService.getHistoryWithFilter({
      status: ImportStatus.FAILED,
      scheduleId,
      startDate,
      endDate,
      offset,
      limit
    });
    
    return result;
  });

  // 履歴詳細取得
  app.get('/imports/history/:historyId', { preHandler: mustBeAdmin }, async (request) => {
    const { historyId } = request.params as { historyId: string };
    
    const { ImportHistoryService } = await import('../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();
    
    const history = await historyService.getHistory(historyId);
    
    if (!history) {
      throw new ApiError(404, `履歴が見つかりません: ${historyId}`);
    }
    
    return { history };
  });
}
