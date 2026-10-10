import { describe, expect, it } from 'vitest';

import { redactHeadersForLog } from '../log-headers.js';

describe('redactHeadersForLog', () => {
  it('replaces credential headers and keeps the rest', () => {
    const result = redactHeadersForLog({
      authorization: 'Bearer abc',
      cookie: 'a=b',
      'x-client-key': 'key',
      'x-due-management-token': 'token',
      'x-kiosk-access-password': '1234',
      'user-agent': 'kiosk',
    });

    expect(result).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'x-client-key': '[REDACTED]',
      'x-due-management-token': '[REDACTED]',
      'x-kiosk-access-password': '[REDACTED]',
      'user-agent': 'kiosk',
    });
  });

  it('does not change the original headers', () => {
    const headers = { authorization: 'Bearer abc' };
    redactHeadersForLog(headers);
    expect(headers.authorization).toBe('Bearer abc');
  });
});
