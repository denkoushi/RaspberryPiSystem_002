import { promises as fs } from 'fs';
import path from 'path';
import { BackupConfigSchema, type BackupConfig, defaultBackupConfig, type CsvImportTarget } from './backup-config.js';
import { logger } from '../../lib/logger.js';

/**
 * バックアップ設定の読み込み
 */
export class BackupConfigLoader {
  private static configPath = process.env.BACKUP_CONFIG_PATH || 
    '/app/config/backup.json';

  /**
   * 設定ファイルを読み込む
   */
  static async load(): Promise<BackupConfig> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      const configJson = JSON.parse(configContent);
      
      // 環境変数の参照を解決（${VAR_NAME}形式、再帰的に深いオブジェクトを走査）
      const resolveEnvVar = (value: unknown, key: string): unknown => {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          const envVarName = value.slice(2, -1);
          const envValue = process.env[envVarName];
          if (envValue) {
            logger?.info({ envVarName, key }, '[BackupConfigLoader] Resolved environment variable');
            return envValue;
          } else {
            logger?.warn(
              { envVarName, key },
              '[BackupConfigLoader] Environment variable not found, using as-is'
            );
          }
        }
        return value;
      };

      // 再帰的にオブジェクトを走査して${VAR}を解決（ネスト対応）
      const resolveEnvVarsRecursive = (obj: unknown, path: string = ''): unknown => {
        if (obj === null || obj === undefined) {
          return obj;
        }
        if (typeof obj === 'string') {
          return resolveEnvVar(obj, path);
        }
        if (Array.isArray(obj)) {
          return obj.map((item, index) => resolveEnvVarsRecursive(item, `${path}[${index}]`));
        }
        if (typeof obj === 'object') {
          const resolved: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            resolved[key] = resolveEnvVarsRecursive(value, currentPath);
          }
          return resolved;
        }
        return obj;
      };

      // storage.options全体を再帰的に解決（ネスト対応）
      if (configJson.storage?.options) {
        configJson.storage.options = resolveEnvVarsRecursive(configJson.storage.options, 'storage.options') as typeof configJson.storage.options;
      }
      
      const config = BackupConfigSchema.parse(configJson);
      
      // 旧キー → 新構造への正規化（メモリ上のみ、自動保存はしない）
      if (config.storage.options) {
        const opts = config.storage.options;
        
        // Dropbox: 旧キー → options.dropbox へ正規化
        if (!opts.dropbox && (opts.accessToken || opts.refreshToken || opts.appKey || opts.appSecret)) {
          opts.dropbox = {
            appKey: opts.appKey as string | undefined,
            appSecret: opts.appSecret as string | undefined,
            accessToken: opts.accessToken as string | undefined,
            refreshToken: opts.refreshToken as string | undefined
          };
          logger?.info('[BackupConfigLoader] Normalized Dropbox config from legacy keys to options.dropbox');
        }
        
        // Gmail: 旧キー → options.gmail へ正規化
        if (!opts.gmail && (
          opts.gmailAccessToken || opts.gmailRefreshToken || 
          opts.clientId || opts.clientSecret || opts.redirectUri || 
          opts.subjectPattern || opts.fromEmail
        )) {
          opts.gmail = {
            clientId: opts.clientId as string | undefined,
            clientSecret: opts.clientSecret as string | undefined,
            redirectUri: opts.redirectUri as string | undefined,
            accessToken: (opts.gmailAccessToken ?? opts.accessToken) as string | undefined,
            refreshToken: (opts.gmailRefreshToken ?? opts.refreshToken) as string | undefined,
            subjectPattern: opts.subjectPattern as string | undefined,
            fromEmail: opts.fromEmail as string | undefined
          };
          logger?.info('[BackupConfigLoader] Normalized Gmail config from legacy keys to options.gmail');
        }
      }
      
      // 旧形式（employeesPath/itemsPath）を新形式（targets）に変換
      if (config.csvImports) {
        for (const schedule of config.csvImports) {
          // targetsが既に存在する場合はスキップ
          if (schedule.targets && schedule.targets.length > 0) {
            continue;
          }
          
          // 旧形式から新形式へ変換
          const targets: CsvImportTarget[] = [];
          if (schedule.employeesPath) {
            targets.push({ type: 'employees', source: schedule.employeesPath });
          }
          if (schedule.itemsPath) {
            targets.push({ type: 'items', source: schedule.itemsPath });
          }
          
          if (targets.length > 0) {
            schedule.targets = targets;
            logger?.info(
              { scheduleId: schedule.id },
              '[BackupConfigLoader] Converted legacy csvImports format to targets format'
            );
          }
        }
      }
      
      logger?.info({ configPath: this.configPath }, '[BackupConfigLoader] Config loaded');
      return config;
    } catch (error) {
      // ファイルが存在しない場合はデフォルト設定を使用
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger?.warn(
          { configPath: this.configPath },
          '[BackupConfigLoader] Config file not found, using default config'
        );
        return defaultBackupConfig;
      }
      
      // パースエラーの場合もデフォルト設定を使用
      logger?.error(
        { err: error, configPath: this.configPath },
        '[BackupConfigLoader] Failed to load config, using default config'
      );
      return defaultBackupConfig;
    }
  }

  /**
   * 設定ファイルを保存する
   */
  static async save(config: BackupConfig): Promise<void> {
    try {
      // ディレクトリが存在しない場合は作成
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // 設定を検証
      const validatedConfig = BackupConfigSchema.parse(config);
      
      // JSONファイルとして保存
      await fs.writeFile(
        this.configPath,
        JSON.stringify(validatedConfig, null, 2),
        'utf-8'
      );
      
      logger?.info({ configPath: this.configPath }, '[BackupConfigLoader] Config saved');
    } catch (error) {
      logger?.error(
        { err: error, configPath: this.configPath },
        '[BackupConfigLoader] Failed to save config'
      );
      throw error;
    }
  }

  /**
   * 設定ファイルのパスを設定（テスト用）
   */
  static setConfigPath(path: string): void {
    this.configPath = path;
  }
}
