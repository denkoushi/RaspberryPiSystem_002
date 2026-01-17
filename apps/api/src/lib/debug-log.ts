import { promises as fs } from 'fs';

/**
 * デバッグログをファイルに書き込む（NDJSON形式）
 * ネットワーク経路が確立できない場合の代替手段
 */
const DEBUG_LOG_PATH = process.env.DEBUG_LOG_PATH || '/app/config/debug.log';

export async function writeDebugLog(payload: {
  sessionId: string;
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}): Promise<void> {
  try {
    const logLine = JSON.stringify(payload) + '\n';
    await fs.appendFile(DEBUG_LOG_PATH, logLine, 'utf-8');
  } catch (error) {
    // ファイル書き込みエラーは無視（デバッグログの失敗で本処理を止めない）
    // console.error('[writeDebugLog] Failed to write debug log:', error);
  }
}
