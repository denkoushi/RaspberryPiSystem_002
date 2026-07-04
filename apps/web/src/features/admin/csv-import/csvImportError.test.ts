import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { formatCsvImportError } from './csvImportError';

describe('formatCsvImportError', () => {
  it('returns API message from axios error response', () => {
    const error = new axios.AxiosError('Request failed');
    error.response = {
      status: 400,
      data: { message: 'Invalid schedule' },
      statusText: 'Bad Request',
      headers: {},
      config: {} as never
    };

    expect(formatCsvImportError(error)).toBe('Invalid schedule');
  });

  it('returns Gmail re-auth message for 401 axios errors without message', () => {
    const error = new axios.AxiosError('Unauthorized');
    error.response = {
      status: 401,
      data: {},
      statusText: 'Unauthorized',
      headers: {},
      config: {} as never
    };

    expect(formatCsvImportError(error)).toBe(
      'Gmailの再認可が必要です。管理コンソールの「Gmail設定」からOAuth認証を実行してください。'
    );
  });

  it('returns Error message for generic errors', () => {
    expect(formatCsvImportError(new Error('boom'))).toBe('boom');
  });

  it('returns fallback message for unknown errors', () => {
    expect(formatCsvImportError('nope')).toBe('操作に失敗しました');
  });
});
