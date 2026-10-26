import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z, ZodError } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { StorageProviderFactory } from '../../services/backup/storage-provider-factory.js';
import type { StorageProvider } from '../../services/backup/storage/storage-provider.interface.js';
import type { CsvImportTarget, CsvImportType } from '../../services/imports/csv-importer.types.js';
import { CsvImportConfigService } from '../../services/imports/csv-import-config.service.js';
import { processCsvImport, processCsvImportFromTargets } from '../../services/imports/csv-import-process.service.js';

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
  ),
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
    message: '無効なパス形式です。パストラバーサル（..）や危険なパスは許可されません',
  });

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
  replaceExisting: z.boolean().optional().default(false),
}).refine((data) => data.employeesPath || data.itemsPath, {
  message: 'employeesPath または itemsPath のいずれかを指定してください',
});

async function readFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function assertManualImportAllowed(types: Array<Exclude<CsvImportType, 'csvDashboards'>>) {
  const configService = new CsvImportConfigService();
  for (const type of types) {
    const config = await configService.getEffectiveConfig(type);
    if (config && !config.allowedManualImport) {
      throw new ApiError(400, `手動取り込みが無効なデータ種別です: ${type}`);
    }
  }
}

export async function registerImportMasterRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // シンプルな同期処理: ジョブテーブルを使わず、結果を直接返す
  app.post('/imports/master', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request) => {
    const files: { employees?: Buffer; items?: Buffer } = {};
    const fieldValues: Record<string, string> = {};

    // マルチパートリクエストの検証とファイル取得
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

    const parsedFields = fieldSchema.parse(fieldValues);
    const rawReplaceExisting = parsedFields.replaceExisting;
    const replaceExisting = rawReplaceExisting === true ||
      (typeof rawReplaceExisting === 'string' && rawReplaceExisting === 'true') ||
      (typeof rawReplaceExisting === 'number' && rawReplaceExisting === 1) ||
      (typeof rawReplaceExisting === 'string' && rawReplaceExisting === '1') ||
      false;

    const manualTypes: Array<Exclude<CsvImportType, 'csvDashboards'>> = [];
    if (files.employees) manualTypes.push('employees');
    if (files.items) manualTypes.push('items');
    if (manualTypes.length > 0) {
      await assertManualImportAllowed(manualTypes);
    }

    const { summary } = await processCsvImport(files, replaceExisting, request.log);
    return { summary };
  });

  // 単一データタイプのCSVインポート（計測機器・吊具対応）
  app.post('/imports/master/:type', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request) => {
    const typeParam = (request.params as { type?: string }).type;

    // URLパス（ケバブケース）をキャメルケースに変換
    const typeMap: Record<string, Exclude<CsvImportType, 'csvDashboards'>> = {
      employees: 'employees',
      items: 'items',
      'measuring-instruments': 'measuringInstruments',
      'rigging-gears': 'riggingGears',
      machines: 'machines',
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

    await assertManualImportAllowed([type]);

    // 新形式のtargets配列で処理
    const targets: CsvImportTarget[] = [{ type, source: `${type}.csv` }];
    const fileMap = new Map<string, Buffer>();
    fileMap.set(type, fileBuffer);

    const { summary } = await processCsvImportFromTargets(targets, fileMap, replaceExisting, request.log);

    return { summary };
  });

  // Dropbox/GmailからCSVを取得してインポート
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

      const manualTypes: Array<Exclude<CsvImportType, 'csvDashboards'>> = [];
      if (rawBody.employeesPath) manualTypes.push('employees');
      if (rawBody.itemsPath) manualTypes.push('items');
      if (manualTypes.length > 0) {
        await assertManualImportAllowed(manualTypes);
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
          replaceExisting: rawBody.replaceExisting,
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
              accessToken: token,
            },
          };
        } else if (provider === 'dropbox') {
          latestConfig.storage.options = {
            ...(latestConfig.storage.options || {}),
            dropbox: {
              ...latestConfig.storage.options?.dropbox,
              accessToken: token,
            },
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
          provider,
        },
      };
      const created = await StorageProviderFactory.createFromConfig(providerConfig, protocol, host, onTokenUpdate, {
        returnProvider: true,
        allowFallbackToLocal: provider !== 'gmail',
      }) as unknown as { provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider };
      const storageProvider = created.storageProvider;

      const files: { employees?: Buffer; items?: Buffer } = {};

      // 従業員CSVのダウンロード
      if (employeesPath) {
        try {
          request.log.info({ provider, path: employeesPath }, '[Master Import] 従業員CSVダウンロード開始');
          const downloadStart = Date.now();
          files.employees = await storageProvider.download(employeesPath);
          const downloadTime = Date.now() - downloadStart;
          const fileSize = files.employees!.length;
          request.log.info({
            provider,
            path: employeesPath,
            size: fileSize,
            downloadTimeMs: downloadTime,
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
          throw new ApiError(500, '従業員CSVのダウンロードに失敗しました');
        }
      }

      // アイテムCSVのダウンロード
      if (itemsPath) {
        try {
          request.log.info({ provider, path: itemsPath }, '[Master Import] アイテムCSVダウンロード開始');
          const downloadStart = Date.now();
          files.items = await storageProvider.download(itemsPath);
          const downloadTime = Date.now() - downloadStart;
          const fileSize = files.items!.length;
          request.log.info({
            provider,
            path: itemsPath,
            size: fileSize,
            downloadTimeMs: downloadTime,
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
          throw new ApiError(500, 'アイテムCSVのダウンロードに失敗しました');
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
        rss: finalMemory.rss - initialMemory.rss,
      };
      const totalTime = Date.now() - startTime;

      request.log.info({
        summary,
        importTimeMs: importTime,
        totalTimeMs: totalTime,
        memoryDelta,
        replaceExisting: rawBody.replaceExisting,
        provider,
      }, '[Master Import] インポート完了');

      return { summary, source: provider };
    } catch (error: unknown) {
      const totalTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage();
      const memoryDelta = {
        heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
        external: finalMemory.external - initialMemory.external,
        rss: finalMemory.rss - initialMemory.rss,
      };

      request.log.error({
        err: error,
        totalTimeMs: totalTime,
        memoryDelta,
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
}
