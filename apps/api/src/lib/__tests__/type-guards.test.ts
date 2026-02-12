import { describe, expect, it } from 'vitest';

import { getArray, getBoolean, getNumber, getRecord, getString, isRecord, toErrorInfo } from '../type-guards.js';

describe('type-guards', () => {
  it('isRecord should narrow plain objects', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('getString should return only string values', () => {
    const record: Record<string, unknown> = {
      s: 'value',
      n: 1,
      u: undefined,
    };
    expect(getString(record, 's')).toBe('value');
    expect(getString(record, 'n')).toBeUndefined();
    expect(getString(record, 'u')).toBeUndefined();
    expect(getString(record, 'missing')).toBeUndefined();
  });

  it('getNumber/getBoolean/getArray/getRecord should narrow expected values', () => {
    const record: Record<string, unknown> = {
      n: 42,
      b: true,
      a: ['x', 1],
      r: { nested: 'ok' },
      s: 'not-number',
    };

    expect(getNumber(record, 'n')).toBe(42);
    expect(getNumber(record, 's')).toBeUndefined();
    expect(getBoolean(record, 'b')).toBe(true);
    expect(getBoolean(record, 'n')).toBeUndefined();
    expect(getArray(record, 'a')).toEqual(['x', 1]);
    expect(getArray(record, 'r')).toBeUndefined();
    expect(getRecord(record, 'r')).toEqual({ nested: 'ok' });
    expect(getRecord(record, 'a')).toBeUndefined();
  });

  it('toErrorInfo should extract metadata from Error-like values', () => {
    const err = new Error('boom') as Error & {
      code?: string;
      status?: number;
      meta?: unknown;
    };
    err.code = 'E_TEST';
    err.status = 400;
    err.meta = { reason: 'x' };

    const info = toErrorInfo(err);
    expect(info.name).toBe('Error');
    expect(info.message).toBe('boom');
    expect(info.code).toBe('E_TEST');
    expect(info.status).toBe(400);
    expect(info.meta).toEqual({ reason: 'x' });
  });
});
