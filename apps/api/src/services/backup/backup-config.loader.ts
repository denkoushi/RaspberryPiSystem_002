import { promises as fs } from 'fs';
import path from 'path';
import { BackupConfigSchema, type BackupConfig, defaultBackupConfig } from './backup-config.js';
import { logger } from '../../lib/logger.js';

/**
 * バックアップ設定の読み込み
 */
export class BackupConfigLoader {
  private static configPath = process.env.BACKUP_CONFIG_PATH || 
    '/opt/RaspberryPiSystem_002/config/backup.json';

  /**
   * 設定ファイルを読み込む
   */
  static async load(): Promise<BackupConfig> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      const configJson = JSON.parse(configContent);
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
