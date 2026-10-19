import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { getApiErrorMessageWithCode } from './errors';

describe('getApiErrorMessageWithCode', () => {
  it.each([
    [{ message: 'Unavailable', errorCode: 'DGX_BUSY' }, 503, 'Unavailable (DGX_BUSY)'],
    [{ message: 'Unavailable' }, 503, 'Unavailable'],
    [{}, 403, 'この操作を行う権限がありません'],
    [{ message: '', errorCode: 'EMPTY' }, 403, ' (EMPTY)'],
    [{ message: 'Denied', errorCode: '' }, 403, 'Denied'],
    [{}, 500, 'Request failed']
  ])('formats response %j with status %s', (data, status, expected) => {
    const error = new axios.AxiosError('Request failed');
    error.response = {
      status,
      data,
      statusText: 'Request failed',
      headers: {},
      config: {} as never
    };

    expect(getApiErrorMessageWithCode(error)).toBe(expected);
  });

  it('returns the message of a plain Error', () => {
    expect(getApiErrorMessageWithCode(new Error('boom'))).toBe('boom');
    expect(getApiErrorMessageWithCode(new Error(''))).toBe('');
  });

  it('returns the fallback for a non-error value', () => {
    expect(getApiErrorMessageWithCode(null)).toBe('予期しないエラーが発生しました');
  });
});
