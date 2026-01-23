import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { logger } from '../../lib/logger.js';

const execFileAsync = promisify(execFile);

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

      logger?.info(
        { scheduleId: params.scheduleId, historyId: params.historyId },
        '[ImportAlertService] Generating failure alert'
      );

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H4',location:'import-alert.service.ts:generateFailureAlert',message:'execFile alert payload',data:{scheduleId:params.scheduleId,messageHasParen:message.includes('('),detailsHasNewline:details.includes('\n'),messageLength:message.length,detailsLength:details.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      // NOTE: exec(string) + シェルエスケープは、改行や括弧などを含む文字列で壊れやすい。
      // ここではexecFileで引数配列として渡して、安全にスクリプトを実行する。
      await execFileAsync('bash', [scriptPath, alertType, message, details], {
        cwd: this.projectRoot,
        timeout: 10000 // 10秒のタイムアウト
      });

      logger?.info(
        { scheduleId: params.scheduleId },
        '[ImportAlertService] Failure alert generated'
      );
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'import-alert.service.ts:generateFailureAlert',message:'execFile alert error',data:{scheduleId:params.scheduleId,errorName:error instanceof Error ? error.name : 'unknown',errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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

      logger?.warn(
        { scheduleId: params.scheduleId, failureCount: params.failureCount },
        '[ImportAlertService] Generating consecutive failure alert'
      );

      await execFileAsync('bash', [scriptPath, alertType, message, details], {
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
}
