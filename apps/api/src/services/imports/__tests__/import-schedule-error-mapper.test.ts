import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { GmailReauthRequiredError } from '../../backup/gmail-oauth.service.js';
import { mapManualImportRunError } from '../import-schedule-error-mapper.js';

describe('mapManualImportRunError', () => {
  it('maps GmailReauthRequiredError to 401 with re-auth guidance', () => {
    const mapped = mapManualImportRunError(new GmailReauthRequiredError('token expired'), 'sched-1');
    expect(mapped.statusCode).toBe(401);
    expect(mapped.message).toBe('Gmailの再認可が必要です。管理コンソールの「OAuth認証」を実行してください。');
  });

  it('maps any error whose message mentions invalid_grant (case-insensitive) to 401', () => {
    expect(mapManualImportRunError(new Error('OAuth: INVALID_GRANT returned'), 's').statusCode).toBe(401);
  });

  it('checks invalid_grant before passing ApiError through', () => {
    const mapped = mapManualImportRunError(new ApiError(500, 'upstream invalid_grant'), 's');
    expect(mapped.statusCode).toBe(401);
  });

  it('returns the same ApiError instance otherwise', () => {
    const original = new ApiError(422, 'CSVが不正です');
    expect(mapManualImportRunError(original, 's')).toBe(original);
  });

  it.each(['CSV import is already running for schedule x', 'job already running'])('maps "%s" to 409', message => {
    const mapped = mapManualImportRunError(new Error(message), 'sched-9');
    expect(mapped.statusCode).toBe(409);
    expect(mapped.message).toBe('インポートは既に実行中です: sched-9');
  });

  it.each(['スケジュールが見つかりません: abc', 'Schedule Not Found'])('maps "%s" to 404', message => {
    const mapped = mapManualImportRunError(new Error(message), 'sched-9');
    expect(mapped.statusCode).toBe(404);
    expect(mapped.message).toBe('スケジュールが見つかりません: sched-9');
  });

  it('treats "Already Running" with different case as a generic 500 (match is case-sensitive)', () => {
    const mapped = mapManualImportRunError(new Error('Already Running'), 's');
    expect(mapped.statusCode).toBe(500);
    expect(mapped.message).toBe('インポート実行に失敗しました: Already Running');
  });

  it('wraps other Error instances as 500 including the original message', () => {
    const mapped = mapManualImportRunError(new Error('Dropbox timeout'), 's');
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.statusCode).toBe(500);
    expect(mapped.message).toBe('インポート実行に失敗しました: Dropbox timeout');
  });

  it.each([['string'], [null], [{ message: 'already running' }]])('maps non-Error throwables (%j) to a generic 500', thrown => {
    const mapped = mapManualImportRunError(thrown, 's');
    expect(mapped.statusCode).toBe(500);
    expect(mapped.message).toBe('インポート実行に失敗しました');
  });
});
