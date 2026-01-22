/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { z, ZodError } from 'zod';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import { DropboxStorageProvider } from '../services/backup/storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from '../services/backup/dropbox-oauth.service.js';
import { StorageProviderFactory } from '../services/backup/storage-provider-factory.js';
import { CsvImporterFactory } from '../services/imports/csv-importer-factory.js';
import type { CsvImportTarget, CsvImportType, ImportSummary } from '../services/imports/csv-importer.types.js';
import { writeDebugLog } from '../lib/debug-log.js';

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

// Gmail用: 件名パターン（Gmail検索クエリ）として扱うため、Dropboxのパス制約はかけない
const gmailPathSchema = z.string()
  .trim()
  .min(1, 'パスは必須です')
  .max(1000, 'パスは1000文字以内である必要があります');

const providerImportSchema = z.object({
  provider: z.enum(['dropbox', 'gmail']).optional(),
  // provider固有のバリデーション（Dropboxは.csv/1000文字/危険パスチェック等）を後段で行うため、
  // ここでは長さ上限などを付けず、最低限の存在チェックのみにする
  employeesPath: z.string().trim().min(1).optional(),
  itemsPath: z.string().trim().min(1).optional(),
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

/**
 * CSVインポート処理（新形式: targets配列ベース）
 */
export async function processCsvImportFromTargets(
  targets: CsvImportTarget[],
  files: Map<string, Buffer>,
  replaceExisting: boolean,
  log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
): Promise<{ summary: Record<string, ImportSummary> }> {
  if (targets.length === 0) {
    throw new ApiError(400, 'インポート対象が指定されていません');
  }

  // すべてのタイプのタグUIDを収集して重複チェック
  const tagUidMap = new Map<string, { type: string; identifier: string }[]>();
  
  // 各ターゲットをパース
  const parsedData = new Map<string, unknown[]>();
  for (const target of targets) {
    const buffer = files.get(target.type);
    if (!buffer) {
      continue; // ファイルが存在しない場合はスキップ
    }

    const importer = CsvImporterFactory.create(target.type);
    const rows = await importer.parse(buffer);
    parsedData.set(target.type, rows);

    // タグUIDを収集
    for (const row of rows) {
      const tagUid = (row as any).nfcTagUid || (row as any).rfidTagUid;
      if (tagUid && tagUid.trim()) {
        const uid = tagUid.trim();
        if (!tagUidMap.has(uid)) {
          tagUidMap.set(uid, []);
        }
        const identifier = (row as any).employeeCode || (row as any).itemCode || (row as any).managementNumber || '不明';
        tagUidMap.get(uid)!.push({ type: target.type, identifier });
      }
    }
  }

  // タイプ間のタグUID重複チェック
  const crossDuplicateTagUids = Array.from(tagUidMap.entries())
    .filter(([_, entries]) => entries.length > 1 && new Set(entries.map(e => e.type)).size > 1)
    .map(([uid, entries]) => ({ uid, entries }));
  
  if (crossDuplicateTagUids.length > 0) {
    const errorMessage = `異なるタイプ間でタグUIDが重複しています: ${crossDuplicateTagUids.map(({ uid, entries }) => `"${uid}" (${entries.map(e => `${e.type}:${e.identifier}`).join(', ')})`).join('; ')}。異なるタイプ間で同じタグUIDは使用できません。`;
    log.error({ crossDuplicateTagUids }, 'タイプ間でタグUIDが重複');
    throw new ApiError(400, errorMessage);
  }

  const summary: Record<string, ImportSummary> = {};

  try {
    // 各タイプを順次インポート（トランザクションは各インポータ内で処理）
    for (const target of targets) {
      const rows = parsedData.get(target.type);
      if (!rows || rows.length === 0) {
        continue;
      }

      const importer = CsvImporterFactory.create(target.type);
      const result = await importer.import(rows, replaceExisting, log);
      summary[target.type] = result;
    }
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
          `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。既存の貸出記録や点検記録があるデータは削除できません。`,
          { code: error.code, ...error.meta }
        );
      }
      throw new ApiError(400, `データベースエラー: ${error.code} - ${error.message}`, { code: error.code, ...error.meta });
    }
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(400, `インポート処理エラー: ${error instanceof Error ? error.message : '不明なエラー'}`);
  }

  return { summary };
}

/**
 * CSVインポート処理（旧形式: employees/itemsファイルベース、後方互換性のため残す）
 */
export async function processCsvImport(
  files: { employees?: Buffer; items?: Buffer },
  replaceExisting: boolean,
  log: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
) {
  // 旧形式を新形式に変換
  const targets: CsvImportTarget[] = [];
  const fileMap = new Map<string, Buffer>();
  
  if (files.employees) {
    targets.push({ type: 'employees', source: 'employees.csv' });
    fileMap.set('employees', files.employees);
  }
  if (files.items) {
    targets.push({ type: 'items', source: 'items.csv' });
    fileMap.set('items', files.items);
  }

  if (targets.length === 0) {
    throw new ApiError(400, 'employees.csv もしくは items.csv をアップロードしてください');
  }

  return processCsvImportFromTargets(targets, fileMap, replaceExisting, log);
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

  // 単一データタイプのCSVインポート（計測機器・吊具対応）
  app.post('/imports/master/:type', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request, reply) => {
    const typeParam = (request.params as { type?: string }).type;
    
    // URLパス（ケバブケース）をキャメルケースに変換
    const typeMap: Record<string, CsvImportType> = {
      'employees': 'employees',
      'items': 'items',
      'measuring-instruments': 'measuringInstruments',
      'rigging-gears': 'riggingGears'
    };
    
    if (!typeParam || !typeMap[typeParam]) {
      const validTypes = Object.keys(typeMap).join(', ');
      throw new ApiError(400, `無効なデータタイプです。許可されているタイプ: ${validTypes}`);
    }
    
    const type = typeMap[typeParam];
    
    // マルチパートリクエストの検証とファイル取得
    let fileBuffer: Buffer | undefined;
    const fieldValues: Record<string, string> = {};
    
    try {
      if (!request.isMultipart()) {
        throw new ApiError(400, 'マルチパートフォームデータが必要です。Content-Type: multipart/form-dataを指定してください。');
      }

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') {
            fileBuffer = await readFile(part);
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

    if (!fileBuffer) {
      throw new ApiError(400, 'CSVファイルがアップロードされていません。fieldname="file"でファイルをアップロードしてください。');
    }

    // replaceExistingフラグの解析
    const parsedFields = fieldSchema.parse(fieldValues);
    const rawReplaceExisting = parsedFields.replaceExisting;
    const replaceExisting = rawReplaceExisting === true || 
                           (typeof rawReplaceExisting === 'string' && rawReplaceExisting === 'true') || 
                           (typeof rawReplaceExisting === 'number' && rawReplaceExisting === 1) || 
                           (typeof rawReplaceExisting === 'string' && rawReplaceExisting === '1') ||
                           false;

    // 新形式のtargets配列で処理
    const targets: CsvImportTarget[] = [{ type, source: `${type}.csv` }];
    const fileMap = new Map<string, Buffer>();
    fileMap.set(type, fileBuffer);

    const { summary } = await processCsvImportFromTargets(targets, fileMap, replaceExisting, request.log);
    
    return { summary };
  });

  // DropboxからCSVを取得してインポート
  app.post('/imports/master/from-dropbox', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request) => {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    
    try {
      const rawBody = providerImportSchema.parse(request.body ?? {});
      const protocol = (request.headers['x-forwarded-proto'] as string | undefined) || request.protocol || 'http';
      const host = request.headers.host || 'localhost:8080';

      const config = await BackupConfigLoader.load();
      const provider = rawBody.provider ?? config.storage.provider;
      if (provider !== 'dropbox' && provider !== 'gmail') {
        throw new ApiError(400, `このエンドポイントはdropbox/gmailのみ対応です（現在: ${provider}）`);
      }

      // providerに応じてパスをバリデーション
      const employeesPath = rawBody.employeesPath
        ? (provider === 'dropbox' ? dropboxPathSchema.parse(rawBody.employeesPath) : gmailPathSchema.parse(rawBody.employeesPath))
        : undefined;
      const itemsPath = rawBody.itemsPath
        ? (provider === 'dropbox' ? dropboxPathSchema.parse(rawBody.itemsPath) : gmailPathSchema.parse(rawBody.itemsPath))
        : undefined;

      request.log.info(
        {
          provider,
          employeesPath,
          itemsPath,
          replaceExisting: rawBody.replaceExisting
        },
        '[Master Import] インポート開始'
      );

      const onTokenUpdate = async (token: string) => {
        const latestConfig = await BackupConfigLoader.load();
        // NOTE: global provider(dropbox)運用でも、import provider(gmail)のトークン更新を保存できるようにする
        if (provider === 'gmail') {
          latestConfig.storage.options = {
            ...(latestConfig.storage.options || {}),
            gmail: {
              ...latestConfig.storage.options?.gmail,
              accessToken: token
            }
          };
        } else if (provider === 'dropbox') {
          latestConfig.storage.options = {
            ...(latestConfig.storage.options || {}),
            dropbox: {
              ...latestConfig.storage.options?.dropbox,
              accessToken: token
            }
          };
        }
        await BackupConfigLoader.save(latestConfig);
        request.log.info({ provider }, '[Master Import] アクセストークンを更新しました');
      };

      // StorageProviderFactoryでプロバイダーを作成（dropbox/gmail両対応）
      const providerConfig = {
        ...config,
        storage: {
          ...config.storage,
          provider
        }
      };
      const created = await StorageProviderFactory.createFromConfig(providerConfig, protocol, host, onTokenUpdate, true);
      const storageProvider = created.storageProvider;

      const files: { employees?: Buffer; items?: Buffer } = {};
      
      // 従業員CSVのダウンロード
      if (employeesPath) {
        try {
          request.log.info({ provider, path: employeesPath }, '[Master Import] 従業員CSVダウンロード開始');
          const downloadStart = Date.now();
          files.employees = await storageProvider.download(employeesPath);
          const downloadTime = Date.now() - downloadStart;
          const fileSize = files.employees.length;
          request.log.info({
            provider,
            path: employeesPath,
            size: fileSize,
            downloadTimeMs: downloadTime
          }, '[Master Import] 従業員CSVダウンロード完了');
        } catch (error: unknown) {
          request.log.error({ err: error, provider, path: employeesPath }, '[Master Import] 従業員CSVダウンロード失敗');
          if (error instanceof Error) {
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('not_found') || errorMessage.includes('not found')) {
              throw new ApiError(404, `従業員CSVファイルが見つかりません: ${employeesPath}`);
            }
            if (errorMessage.includes('unauthorized') || errorMessage.includes('expired')) {
              throw new ApiError(401, `${provider}認証エラー: ${error.message}`);
            }
            throw new ApiError(500, `従業員CSVのダウンロードに失敗しました: ${error.message}`);
          }
          throw new ApiError(500, `従業員CSVのダウンロードに失敗しました`);
        }
      }
      
      // アイテムCSVのダウンロード
      if (itemsPath) {
        try {
          request.log.info({ provider, path: itemsPath }, '[Master Import] アイテムCSVダウンロード開始');
          const downloadStart = Date.now();
          files.items = await storageProvider.download(itemsPath);
          const downloadTime = Date.now() - downloadStart;
          const fileSize = files.items.length;
          request.log.info({
            provider,
            path: itemsPath,
            size: fileSize,
            downloadTimeMs: downloadTime
          }, '[Master Import] アイテムCSVダウンロード完了');
        } catch (error: unknown) {
          request.log.error({ err: error, provider, path: itemsPath }, '[Master Import] アイテムCSVダウンロード失敗');
          if (error instanceof Error) {
            const errorMessage = error.message.toLowerCase();
            if (errorMessage.includes('not_found') || errorMessage.includes('not found')) {
              throw new ApiError(404, `アイテムCSVファイルが見つかりません: ${itemsPath}`);
            }
            if (errorMessage.includes('unauthorized') || errorMessage.includes('expired')) {
              throw new ApiError(401, `${provider}認証エラー: ${error.message}`);
            }
            throw new ApiError(500, `アイテムCSVのダウンロードに失敗しました: ${error.message}`);
          }
          throw new ApiError(500, `アイテムCSVのダウンロードに失敗しました`);
        }
      }

      // CSVインポート処理
      const importStart = Date.now();
      const { summary } = await processCsvImport(files, rawBody.replaceExisting ?? false, request.log);
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
        replaceExisting: rawBody.replaceExisting,
        provider
      }, '[Master Import] インポート完了');
      
      return { summary, source: provider };
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

  // === CSVインポートスケジュール管理API ===
  
  // スケジュール一覧取得
  app.get('/imports/schedule', { preHandler: mustBeAdmin }, async () => {
    const config = await BackupConfigLoader.load();
    return {
      schedules: config.csvImports || []
    };
  });

  // スケジュール追加
  const csvImportTargetSchema = z.object({
    type: z.enum(['employees', 'items', 'measuringInstruments', 'riggingGears', 'csvDashboards']),
    source: z.string().min(1, 'sourceは必須です')
  });

  const csvImportScheduleSchema = z.object({
    id: z.string().min(1, 'IDは必須です'),
    name: z.string().optional(),
    provider: z.enum(['dropbox', 'gmail']).optional(), // プロバイダーを選択可能に（オプション、デフォルト: storage.provider）
    // 新形式: targets配列
    targets: z.array(csvImportTargetSchema).optional(),
    // 旧形式: 後方互換のため残す
    employeesPath: z.string().optional(), // Gmailの場合は件名パターン、Dropboxの場合はパス
    itemsPath: z.string().optional(), // Gmailの場合は件名パターン、Dropboxの場合はパス
    schedule: z.string().min(1, 'スケジュール（cron形式）は必須です'),
    enabled: z.boolean().optional().default(true),
    replaceExisting: z.boolean().optional().default(false),
    autoBackupAfterImport: z.object({
      enabled: z.boolean().default(false),
      targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv'])
    }).optional().default({ enabled: false, targets: ['csv'] }),
    retryConfig: z.object({
      maxRetries: z.number().min(0).default(3),
      retryInterval: z.number().min(1).default(60), // 秒
      exponentialBackoff: z.boolean().default(true)
    }).optional()
  }).refine((data) => {
    // 新形式または旧形式のいずれかが必須
    if (data.targets && data.targets.length > 0) {
      return true;
    }
    return data.employeesPath || data.itemsPath;
  }, {
    message: 'targets または employeesPath/itemsPath のいずれかを指定してください'
  }).refine((data) => {
    // 新形式の場合はバリデーション不要（各インポータで処理）
    if (data.targets && data.targets.length > 0) {
      return true;
    }
    // 旧形式のバリデーション
    // Gmailの場合は.csvで終わる必要がない、Dropboxの場合は.csvで終わる必要がある
    if (data.provider === 'gmail') {
      return true;
    }
    const isDropbox = data.provider === 'dropbox' || !data.provider;
    if (isDropbox) {
      if (data.employeesPath && !data.employeesPath.match(/\.csv$/i)) {
        return false;
      }
      if (data.itemsPath && !data.itemsPath.match(/\.csv$/i)) {
        return false;
      }
    }
    return true;
  }, {
    message: 'Dropboxの場合、employeesPathとitemsPathは.csvで終わる必要があります'
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
      provider: body.provider,
      targets: body.targets, // 新形式
      employeesPath: body.employeesPath, // 旧形式（後方互換）
      itemsPath: body.itemsPath, // 旧形式（後方互換）
      schedule: body.schedule,
      enabled: body.enabled ?? true,
      replaceExisting: body.replaceExisting ?? false,
      autoBackupAfterImport: body.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] },
      retryConfig: body.retryConfig
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
    provider: z.enum(['dropbox', 'gmail']).optional(),
    // 新形式: targets配列
    targets: z.array(csvImportTargetSchema).optional(),
    // 旧形式: 後方互換のため残す
    employeesPath: z.string().optional(),
    itemsPath: z.string().optional(),
    schedule: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    replaceExisting: z.boolean().optional(),
    autoBackupAfterImport: z.object({
      enabled: z.boolean().default(false),
      targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv'])
    }).optional(),
    retryConfig: z.object({
      maxRetries: z.number().min(0).default(3),
      retryInterval: z.number().min(1).default(60),
      exponentialBackoff: z.boolean().default(true)
    }).optional()
  }).refine((data) => {
    // 更新時は既存の値が保持されるため、新形式または旧形式のいずれかが存在すればOK
    if (data.targets && data.targets.length > 0) {
      return true;
    }
    if (data.employeesPath || data.itemsPath) {
      return true;
    }
    // どちらも指定されていない場合は、既存の値が保持されるためOK
    return true;
  }, {
    message: 'targets または employeesPath/itemsPath のいずれかを指定してください'
  }).refine((data) => {
    // 新形式の場合はバリデーション不要
    if (data.targets && data.targets.length > 0) {
      return true;
    }
    // 旧形式のバリデーション
    if (data.provider === 'gmail') {
      return true;
    }
    const isDropbox = data.provider === 'dropbox' || !data.provider;
    if (isDropbox) {
      if (data.employeesPath && !data.employeesPath.match(/\.csv$/i)) {
        return false;
      }
      if (data.itemsPath && !data.itemsPath.match(/\.csv$/i)) {
        return false;
      }
    }
    return true;
  }, {
    message: 'Dropboxの場合、employeesPathとitemsPathは.csvで終わる必要があります'
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'imports.ts:1248',message:'manual run request received',data:{scheduleId:id,reqId:(request as any).id ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    // #region agent log
    await writeDebugLog({sessionId:'debug-session',runId:'run2',hypothesisId:'H1',location:'imports.ts:1249',message:'manual run request received (file log)',data:{scheduleId:id,reqId:(request as any).id ?? null},timestamp:Date.now()});
    // #endregion
    
    // スケジュールが存在するか確認
    const config = await BackupConfigLoader.load();
    const schedule = config.csvImports?.find(s => s.id === id);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'imports.ts:1252',message:'loaded csv import schedules',data:{scheduleId:id,hasCsvImports:Array.isArray(config.csvImports),csvImportCount:config.csvImports?.length ?? 0,scheduleIds:(config.csvImports ?? []).map((s) => s.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    // #region agent log
    await writeDebugLog({sessionId:'debug-session',runId:'run2',hypothesisId:'H2',location:'imports.ts:1253',message:'loaded csv import schedules (file log)',data:{scheduleId:id,hasCsvImports:Array.isArray(config.csvImports),csvImportCount:config.csvImports?.length ?? 0,scheduleIds:(config.csvImports ?? []).map((s) => s.id),backupConfigPath:process.env.BACKUP_CONFIG_PATH ?? null},timestamp:Date.now()});
    // #endregion
    
    if (!schedule) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'imports.ts:1255',message:'schedule not found',data:{scheduleId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      // #region agent log
      await writeDebugLog({sessionId:'debug-session',runId:'run2',hypothesisId:'H1',location:'imports.ts:1256',message:'schedule not found (file log)',data:{scheduleId:id},timestamp:Date.now()});
      // #endregion
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }
    
    const { getCsvImportScheduler } = await import('../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'imports.ts:1260',message:'about to run scheduler import',data:{scheduleId:id,hasScheduler:!!scheduler},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    // #region agent log
    await writeDebugLog({sessionId:'debug-session',runId:'run2',hypothesisId:'H4',location:'imports.ts:1261',message:'about to run scheduler import (file log)',data:{scheduleId:id,hasScheduler:!!scheduler},timestamp:Date.now()});
    // #endregion
    
    try {
      const summary = await scheduler.runImport(id);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'imports.ts:1262',message:'scheduler.runImport succeeded',data:{scheduleId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      // #region agent log
      await writeDebugLog({sessionId:'debug-session',runId:'run2',hypothesisId:'H4',location:'imports.ts:1263',message:'scheduler.runImport succeeded (file log)',data:{scheduleId:id},timestamp:Date.now()});
      // #endregion
      request.log.info({ scheduleId: id }, '[CSV Import Schedule] Manual import completed');
      return { message: 'インポートを実行しました', summary };
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'imports.ts:1266',message:'scheduler.runImport failed',data:{scheduleId:id,errorName:error instanceof Error ? error.name : 'unknown',errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      // #region agent log
      await writeDebugLog({sessionId:'debug-session',runId:'run2',hypothesisId:'H4',location:'imports.ts:1267',message:'scheduler.runImport failed (file log)',data:{scheduleId:id,errorName:error instanceof Error ? error.name : 'unknown',errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now()});
      // #endregion
      request.log.error({ err: error, scheduleId: id }, '[CSV Import Schedule] Manual import failed');
      
      // ApiErrorの場合はstatusCodeを尊重して再スロー
      if (error instanceof ApiError) {
        throw error;
      }
      
      if (error instanceof Error) {
        // スケジュールが見つからないエラーの場合のみ404
        // NOTE: 取り込み側（CSVダッシュボード列不足など）も「見つかりません」を含むため、誤判定しない
        if (
          error.message.includes('スケジュールが見つかりません') ||
          error.message.toLowerCase().includes('schedule not found')
        ) {
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
