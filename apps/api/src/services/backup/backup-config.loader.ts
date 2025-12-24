import { promises as fs } from 'fs';
import path from 'path';
import { BackupConfigSchema, type BackupConfig, defaultBackupConfig } from './backup-config.js';
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
      
      // 環境変数の参照を解決（${VAR_NAME}形式）
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

      // accessToken, refreshToken, appKey, appSecret, clientId, clientSecretの環境変数を解決
      if (configJson.storage?.options) {
        if (configJson.storage.options.accessToken) {
          configJson.storage.options.accessToken = resolveEnvVar(
            configJson.storage.options.accessToken,
            'accessToken'
          ) as string | undefined;
        }
        if (configJson.storage.options.refreshToken) {
          configJson.storage.options.refreshToken = resolveEnvVar(
            configJson.storage.options.refreshToken,
            'refreshToken'
          ) as string | undefined;
        }
        if (configJson.storage.options.appKey) {
          configJson.storage.options.appKey = resolveEnvVar(
            configJson.storage.options.appKey,
            'appKey'
          ) as string | undefined;
        }
        if (configJson.storage.options.appSecret) {
          configJson.storage.options.appSecret = resolveEnvVar(
            configJson.storage.options.appSecret,
            'appSecret'
          ) as string | undefined;
        }
        if (configJson.storage.options.clientId) {
          configJson.storage.options.clientId = resolveEnvVar(
            configJson.storage.options.clientId,
            'clientId'
          ) as string | undefined;
        }
        if (configJson.storage.options.clientSecret) {
          configJson.storage.options.clientSecret = resolveEnvVar(
            configJson.storage.options.clientSecret,
            'clientSecret'
          ) as string | undefined;
        }
      }
      
      const config = BackupConfigSchema.parse(configJson);
      
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
