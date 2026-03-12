import { ApiError } from '../../lib/errors.js';
import { GmailReauthRequiredError, isInvalidGrantMessage } from '../backup/gmail-oauth.service.js';

export function mapManualImportRunError(error: unknown, scheduleId: string): ApiError {
  if (error instanceof GmailReauthRequiredError || isInvalidGrantMessage(error instanceof Error ? error.message : undefined)) {
    return new ApiError(401, 'Gmailの再認可が必要です。管理コンソールの「OAuth認証」を実行してください。');
  }

  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    if (
      error.message.includes('CSV import is already running') ||
      error.message.includes('already running')
    ) {
      return new ApiError(409, `インポートは既に実行中です: ${scheduleId}`);
    }

    if (
      error.message.includes('スケジュールが見つかりません') ||
      error.message.toLowerCase().includes('schedule not found')
    ) {
      return new ApiError(404, `スケジュールが見つかりません: ${scheduleId}`);
    }

    return new ApiError(500, `インポート実行に失敗しました: ${error.message}`);
  }

  return new ApiError(500, 'インポート実行に失敗しました');
}
