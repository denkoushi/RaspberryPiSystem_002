import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { logger } from '../../lib/logger.js';

const execAsync = promisify(exec);

/**
 * CSVインポートアラートサービス
 */
export class ImportAlertService {
  private projectRoot: string;

  constructor() {
    // プロジェクトルートを取得（通常は /opt/RaspberryPiSystem_002）
    // 環境変数から取得、なければ現在のディレクトリから推測
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    this.projectRoot = process.env.PROJECT_ROOT || 
      resolve(__dirname, '../../../../..');
  }

  /**
   * インポート失敗アラートを生成
   */
  async generateFailureAlert(params: {
    scheduleId: string;
    scheduleName?: string;
    errorMessage: string;
    historyId?: string;
  }): Promise<void> {
    const alertType = 'csv-import-failure';
    const message = `CSVインポートが失敗しました: ${params.scheduleName || params.scheduleId}`;
    const details = JSON.stringify({
      scheduleId: params.scheduleId,
      scheduleName: params.scheduleName,
      errorMessage: params.errorMessage,
      historyId: params.historyId
    }, null, 2);

    try {
      // generate-alert.shスクリプトを実行
      const scriptPath = join(this.projectRoot, 'scripts', 'generate-alert.sh');
      
      // シェルエスケープ
      const escapedType = this.escapeShellArg(alertType);
      const escapedMessage = this.escapeShellArg(message);
      const escapedDetails = this.escapeShellArg(details);

      const command = `bash "${scriptPath}" "${escapedType}" "${escapedMessage}" "${escapedDetails}"`;
      
      logger?.info(
        { scheduleId: params.scheduleId, historyId: params.historyId },
        '[ImportAlertService] Generating failure alert'
      );

      await execAsync(command, {
        cwd: this.projectRoot,
        timeout: 10000 // 10秒のタイムアウト
      });

      logger?.info(
        { scheduleId: params.scheduleId },
        '[ImportAlertService] Failure alert generated'
      );
    } catch (error) {
      // アラート生成の失敗はログに記録するが、例外は投げない（インポート処理を中断しない）
      logger?.error(
        { err: error, scheduleId: params.scheduleId },
        '[ImportAlertService] Failed to generate alert'
      );
    }
  }

  /**
   * 連続失敗アラートを生成（設定された回数連続で失敗した場合）
   */
  async generateConsecutiveFailureAlert(params: {
    scheduleId: string;
    scheduleName?: string;
    failureCount: number;
    lastError: string;
  }): Promise<void> {
    const alertType = 'csv-import-consecutive-failure';
    const message = `CSVインポートが${params.failureCount}回連続で失敗しました: ${params.scheduleName || params.scheduleId}`;
    const details = JSON.stringify({
      scheduleId: params.scheduleId,
      scheduleName: params.scheduleName,
      failureCount: params.failureCount,
      lastError: params.lastError
    }, null, 2);

    try {
      const scriptPath = join(this.projectRoot, 'scripts', 'generate-alert.sh');
      
      const escapedType = this.escapeShellArg(alertType);
      const escapedMessage = this.escapeShellArg(message);
      const escapedDetails = this.escapeShellArg(details);

      const command = `bash "${scriptPath}" "${escapedType}" "${escapedMessage}" "${escapedDetails}"`;
      
      logger?.warn(
        { scheduleId: params.scheduleId, failureCount: params.failureCount },
        '[ImportAlertService] Generating consecutive failure alert'
      );

      await execAsync(command, {
        cwd: this.projectRoot,
        timeout: 10000
      });

      logger?.info(
        { scheduleId: params.scheduleId },
        '[ImportAlertService] Consecutive failure alert generated'
      );
    } catch (error) {
      logger?.error(
        { err: error, scheduleId: params.scheduleId },
        '[ImportAlertService] Failed to generate consecutive failure alert'
      );
    }
  }

  /**
   * シェル引数をエスケープ
   */
  private escapeShellArg(arg: string): string {
    // シングルクォートで囲み、内部のシングルクォートをエスケープ
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
