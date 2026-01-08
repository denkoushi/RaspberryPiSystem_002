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

  // load() がフォールバック（ENOENT/パース失敗等）で返したconfigかどうかを、保存時に検知するためのマーカー
  // NOTE: enumerable=false のためJSON.stringifyやZod parseには影響しない
  private static readonly FALLBACK_MARKER = Symbol('BackupConfigLoader.FALLBACK_CONFIG');

  /**
   * 設定ファイルを読み込む
   */
  static async load(): Promise<BackupConfig> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      // #region agent log
      // NOTE: 機密情報は出さない（サイズ・経路・概況のみ）
      logger?.info(
        { configPath: this.configPath, bytes: Buffer.byteLength(configContent, 'utf-8') },
        '[BackupConfigLoader] Raw config file read'
      );
      // #endregion
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
      
      // #region agent log
      logger?.info(
        { configPath: this.configPath, summary: this.summarizeConfig(config) },
        '[BackupConfigLoader] Config loaded'
      );
      // #endregion
      return config;
    } catch (error) {
      // ファイルが存在しない場合はデフォルト設定を使用
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger?.warn(
          { configPath: this.configPath },
          '[BackupConfigLoader] Config file not found, using default config'
        );
        const fallback = { ...defaultBackupConfig } as BackupConfig;
        try {
          Object.defineProperty(fallback, this.FALLBACK_MARKER, { value: { reason: 'ENOENT', at: Date.now() }, enumerable: false });
        } catch {
          // noop
        }
        // #region agent log
        logger?.warn(
          { configPath: this.configPath, reason: 'ENOENT', summary: this.summarizeConfig(fallback) },
          '[BackupConfigLoader] Returning fallback config'
        );
        // #endregion
        return fallback;
      }
      
      // パースエラーの場合もデフォルト設定を使用
      logger?.error(
        { err: error, configPath: this.configPath },
        '[BackupConfigLoader] Failed to load config, using default config'
      );
      const fallback = { ...defaultBackupConfig } as BackupConfig;
      try {
        const message = error instanceof Error ? error.message : String(error);
        Object.defineProperty(fallback, this.FALLBACK_MARKER, { value: { reason: 'PARSE_OR_VALIDATE_ERROR', message, at: Date.now() }, enumerable: false });
      } catch {
        // noop
      }
      // #region agent log
      logger?.error(
        {
          configPath: this.configPath,
          reason: 'PARSE_OR_VALIDATE_ERROR',
          message: error instanceof Error ? error.message : String(error),
          summary: this.summarizeConfig(fallback),
        },
        '[BackupConfigLoader] Returning fallback config'
      );
      // #endregion
      return fallback;
    }
  }

  /**
   * 設定ファイルを保存する
   */
  static async save(config: BackupConfig): Promise<void> {
    try {
      const incomingSummary = this.summarizeConfig(config);
      const caller = (() => {
        try {
          const stack = new Error().stack;
          if (!stack) return undefined;
          // 先頭2-4行だけ（巨大化防止）
          return stack.split('\n').slice(2, 5).map((l) => l.trim());
        } catch {
          return undefined;
        }
      })();

      // 本番の保護: 現在のファイルと比較して「急激な縮小/欠落」がある保存は拒否
      const isProductionConfigPath =
        this.configPath === '/app/config/backup.json' || this.configPath.startsWith('/app/config/');
      if (isProductionConfigPath) {
        try {
          const currentRaw = await fs.readFile(this.configPath, 'utf-8');
          const currentJson = JSON.parse(currentRaw);
          const currentParsed = BackupConfigSchema.safeParse(currentJson);
          if (currentParsed.success) {
            const currentSummary = this.summarizeConfig(currentParsed.data);

            const currentTargets = currentSummary.targetsLen ?? 0;
            const nextTargets = incomingSummary.targetsLen ?? 0;
            const currentHasGmail = !!currentSummary.gmail?.hasClientId;
            const nextHasGmail = !!incomingSummary.gmail?.hasClientId;

            const looksLikeDestructiveShrink =
              currentTargets >= 10 && nextTargets <= 5 && nextTargets < currentTargets;
            const looksLikeGmailWipe = currentHasGmail && !nextHasGmail;

            if (looksLikeDestructiveShrink || looksLikeGmailWipe) {
              logger?.error(
                {
                  configPath: this.configPath,
                  currentSummary,
                  incomingSummary,
                  caller,
                },
                '[BackupConfigLoader] Refusing suspicious config save (would likely wipe settings)'
              );
              throw new Error('Refusing suspicious backup config save (would likely wipe settings)');
            }
          }
        } catch (e) {
          // 現在ファイルが読めない/壊れている場合は「上書きで復旧」を狙う可能性もあるが、
          // ここで無条件に許すと“フォールバック保存”で全消しになり得るため、
          // マーカー検知で防ぐ（下で判定）。ここではログのみ。
          logger?.warn(
            { configPath: this.configPath, err: e instanceof Error ? e.message : String(e), incomingSummary, caller },
            '[BackupConfigLoader] Could not compare current config before save'
          );
        }
      }

      // load()がフォールバック（=危険なデフォルト返却）だった場合、そのまま保存すると設定が消える。
      // ここで保存を拒否して「消失」を防ぐ（復旧は別手順で行う）。
      if (isProductionConfigPath) {
        const marker = (config as unknown as Record<string | symbol, unknown>)[this.FALLBACK_MARKER];
        if (marker) {
          logger?.error(
            { configPath: this.configPath, marker, incomingSummary, caller },
            '[BackupConfigLoader] Refusing to save fallback config to avoid destructive overwrite',
          );
          throw new Error('Refusing to save fallback backup config (would overwrite real config)');
        }
      }

      // ディレクトリが存在しない場合は作成
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // 設定を検証
      const validatedConfig = BackupConfigSchema.parse(config);
      
      // JSONファイルとして保存（atomic write）
      // NOTE: 直接writeFileすると、同時readでJSONが壊れた状態を読んでしまい、load()がフォールバック→保存で上書き、が起き得る。
      // tmpへ書いてrenameすることで、読み取り側は常に「完全なJSON」を読む。
      const tmpPath = `${this.configPath}.tmp.${process.pid}.${Date.now()}`;
      const payload = JSON.stringify(validatedConfig, null, 2);
      await fs.writeFile(tmpPath, payload, 'utf-8');
      await fs.rename(tmpPath, this.configPath);
      
      logger?.info(
        { configPath: this.configPath, bytes: Buffer.byteLength(payload, 'utf-8'), incomingSummary },
        '[BackupConfigLoader] Config saved'
      );
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

  /**
   * 設定の健全性をチェック（衝突・ドリフト検出）
   */
  static async checkHealth(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    issues: Array<{
      type: 'collision' | 'drift' | 'missing';
      severity: 'warning' | 'error';
      message: string;
      details?: Record<string, unknown>;
    }>;
  }> {
    const issues: Array<{
      type: 'collision' | 'drift' | 'missing';
      severity: 'warning' | 'error';
      message: string;
      details?: Record<string, unknown>;
    }> = [];

    try {
      // 設定ファイルを読み込む（環境変数解決前の生データも必要）
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      const configJson = JSON.parse(configContent);
      const config = await this.load();

      const opts = config.storage.options;
      if (!opts) {
        return { status: 'healthy', issues: [] };
      }

      // 1. 衝突検出: 旧キーと新構造の両方に値がある場合
      // Dropbox
      if (opts.dropbox) {
        const dropbox = opts.dropbox;
        if (dropbox.accessToken && opts.accessToken && dropbox.accessToken !== opts.accessToken) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Dropbox accessToken: 旧キーと新構造（options.dropbox.accessToken）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.accessToken',
              newKey: 'storage.options.dropbox.accessToken',
              legacyValue: opts.accessToken.substring(0, 20) + '...',
              newValue: dropbox.accessToken.substring(0, 20) + '...'
            }
          });
        }
        if (dropbox.refreshToken && opts.refreshToken && dropbox.refreshToken !== opts.refreshToken) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Dropbox refreshToken: 旧キーと新構造（options.dropbox.refreshToken）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.refreshToken',
              newKey: 'storage.options.dropbox.refreshToken'
            }
          });
        }
        if (dropbox.appKey && opts.appKey && dropbox.appKey !== opts.appKey) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Dropbox appKey: 旧キーと新構造（options.dropbox.appKey）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.appKey',
              newKey: 'storage.options.dropbox.appKey'
            }
          });
        }
        if (dropbox.appSecret && opts.appSecret && dropbox.appSecret !== opts.appSecret) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Dropbox appSecret: 旧キーと新構造（options.dropbox.appSecret）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.appSecret',
              newKey: 'storage.options.dropbox.appSecret'
            }
          });
        }
      }

      // Gmail
      if (opts.gmail) {
        const gmail = opts.gmail;
        if (gmail.accessToken && opts.gmailAccessToken && gmail.accessToken !== opts.gmailAccessToken) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Gmail accessToken: 旧キー（gmailAccessToken）と新構造（options.gmail.accessToken）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.gmailAccessToken',
              newKey: 'storage.options.gmail.accessToken'
            }
          });
        }
        if (gmail.refreshToken && opts.gmailRefreshToken && gmail.refreshToken !== opts.gmailRefreshToken) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Gmail refreshToken: 旧キー（gmailRefreshToken）と新構造（options.gmail.refreshToken）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.gmailRefreshToken',
              newKey: 'storage.options.gmail.refreshToken'
            }
          });
        }
        if (gmail.clientId && opts.clientId && gmail.clientId !== opts.clientId) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Gmail clientId: 旧キーと新構造（options.gmail.clientId）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.clientId',
              newKey: 'storage.options.gmail.clientId'
            }
          });
        }
        if (gmail.clientSecret && opts.clientSecret && gmail.clientSecret !== opts.clientSecret) {
          issues.push({
            type: 'collision',
            severity: 'warning',
            message: 'Gmail clientSecret: 旧キーと新構造（options.gmail.clientSecret）の両方に異なる値が設定されています',
            details: {
              legacyKey: 'storage.options.clientSecret',
              newKey: 'storage.options.gmail.clientSecret'
            }
          });
        }
      }

      // 2. ドリフト検出: 環境変数と設定ファイルの値の不一致
      const checkEnvVarDrift = (configValue: unknown, envVarName: string, key: string): void => {
        if (typeof configValue === 'string' && configValue.startsWith('${') && configValue.endsWith('}')) {
          const resolvedEnvVarName = configValue.slice(2, -1);
          const envValue = process.env[resolvedEnvVarName];
          if (envValue) {
            // 環境変数が設定されているが、設定ファイルに直接値も設定されている場合
            const directValue = this.getNestedValue(configJson, key);
            if (directValue && typeof directValue === 'string' && !directValue.startsWith('${')) {
              issues.push({
                type: 'drift',
                severity: 'warning',
                message: `${key}: 環境変数参照（${resolvedEnvVarName}）と直接値の両方が設定されています`,
                details: {
                  envVarName: resolvedEnvVarName,
                  envValue: envValue.substring(0, 20) + '...',
                  directValue: directValue.substring(0, 20) + '...'
                }
              });
            }
          }
        }
      };

      // Dropbox環境変数のドリフトチェック
      if (opts.dropbox) {
        if (opts.dropbox.appKey) {
          checkEnvVarDrift(opts.dropbox.appKey, 'DROPBOX_APP_KEY', 'storage.options.dropbox.appKey');
        }
        if (opts.dropbox.appSecret) {
          checkEnvVarDrift(opts.dropbox.appSecret, 'DROPBOX_APP_SECRET', 'storage.options.dropbox.appSecret');
        }
        if (opts.dropbox.accessToken) {
          checkEnvVarDrift(opts.dropbox.accessToken, 'DROPBOX_ACCESS_TOKEN', 'storage.options.dropbox.accessToken');
        }
        if (opts.dropbox.refreshToken) {
          checkEnvVarDrift(opts.dropbox.refreshToken, 'DROPBOX_REFRESH_TOKEN', 'storage.options.dropbox.refreshToken');
        }
      }

      // Gmail環境変数のドリフトチェック
      if (opts.gmail) {
        if (opts.gmail.clientId) {
          checkEnvVarDrift(opts.gmail.clientId, 'GMAIL_CLIENT_ID', 'storage.options.gmail.clientId');
        }
        if (opts.gmail.clientSecret) {
          checkEnvVarDrift(opts.gmail.clientSecret, 'GMAIL_CLIENT_SECRET', 'storage.options.gmail.clientSecret');
        }
      }

      // 3. 必須設定の欠落チェック
      if (config.storage.provider === 'dropbox' && opts.dropbox) {
        if (!opts.dropbox.appKey && !process.env.DROPBOX_APP_KEY) {
          issues.push({
            type: 'missing',
            severity: 'error',
            message: 'Dropbox appKeyが設定されていません（storage.options.dropbox.appKey または DROPBOX_APP_KEY環境変数）',
            details: { provider: 'dropbox', requiredField: 'appKey' }
          });
        }
        if (!opts.dropbox.appSecret && !process.env.DROPBOX_APP_SECRET) {
          issues.push({
            type: 'missing',
            severity: 'error',
            message: 'Dropbox appSecretが設定されていません（storage.options.dropbox.appSecret または DROPBOX_APP_SECRET環境変数）',
            details: { provider: 'dropbox', requiredField: 'appSecret' }
          });
        }
      }

      if (config.storage.provider === 'gmail' && opts.gmail) {
        if (!opts.gmail.clientId && !process.env.GMAIL_CLIENT_ID) {
          issues.push({
            type: 'missing',
            severity: 'error',
            message: 'Gmail clientIdが設定されていません（storage.options.gmail.clientId または GMAIL_CLIENT_ID環境変数）',
            details: { provider: 'gmail', requiredField: 'clientId' }
          });
        }
        if (!opts.gmail.clientSecret && !process.env.GMAIL_CLIENT_SECRET) {
          issues.push({
            type: 'missing',
            severity: 'error',
            message: 'Gmail clientSecretが設定されていません（storage.options.gmail.clientSecret または GMAIL_CLIENT_SECRET環境変数）',
            details: { provider: 'gmail', requiredField: 'clientSecret' }
          });
        }
      }

      // ステータス判定
      const hasError = issues.some(issue => issue.severity === 'error');
      const hasWarning = issues.some(issue => issue.severity === 'warning');
      const status = hasError ? 'error' : hasWarning ? 'warning' : 'healthy';

      return { status, issues };
    } catch (error) {
      // ファイルが存在しない場合はエラー
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          status: 'error',
          issues: [{
            type: 'missing',
            severity: 'error',
            message: `設定ファイルが見つかりません: ${this.configPath}`,
            details: { configPath: this.configPath }
          }]
        };
      }

      // パースエラーの場合
      return {
        status: 'error',
        issues: [{
          type: 'missing',
          severity: 'error',
          message: `設定ファイルの読み込みに失敗しました: ${(error as Error).message}`,
          details: { configPath: this.configPath, error: (error as Error).message }
        }]
      };
    }
  }

  /**
   * ネストされたオブジェクトから値を取得（ヘルパー）
   */
  private static getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /**
   * 設定の概況を安全に要約（機密情報は含めない）
   */
  private static summarizeConfig(config: BackupConfig): {
    storageProvider: BackupConfig['storage']['provider'];
    targetsLen: number;
    gmail: { hasClientId: boolean; hasAccessToken: boolean; hasRefreshToken: boolean };
    dropbox: { hasAccessToken: boolean; hasRefreshToken: boolean };
  } {
    const opts = config.storage.options;
    const gmail = opts?.gmail;
    const dropbox = opts?.dropbox;
    return {
      storageProvider: config.storage.provider,
      targetsLen: Array.isArray(config.targets) ? config.targets.length : 0,
      gmail: {
        hasClientId: !!gmail?.clientId || !!(opts?.clientId as string | undefined),
        hasAccessToken: !!gmail?.accessToken || !!(opts?.gmailAccessToken as string | undefined),
        hasRefreshToken: !!gmail?.refreshToken || !!(opts?.gmailRefreshToken as string | undefined),
      },
      dropbox: {
        hasAccessToken: !!dropbox?.accessToken || !!(opts?.accessToken as string | undefined),
        hasRefreshToken: !!dropbox?.refreshToken || !!(opts?.refreshToken as string | undefined),
      },
    };
  }
}
