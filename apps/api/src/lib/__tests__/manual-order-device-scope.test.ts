import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { clientDevice: { findFirst: mocks.findFirst, findMany: mocks.findMany } } }));

import { ApiError } from '../errors.js';
import {
  assertRegisteredDeviceScopeKey,
  listRegisteredDeviceScopeKeysForSite,
  MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY
} from '../manual-order-device-scope.js';

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected ApiError');
}

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.findMany.mockReset();
});

describe('assertRegisteredDeviceScopeKey', () => {
  it('passes when a client device with the trimmed location exists', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'device-1' });
    await expect(assertRegisteredDeviceScopeKey('  第2工場 - kensakuMain  ')).resolves.toBeUndefined();
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { location: '第2工場 - kensakuMain' }, select: { id: true } });
  });

  it.each(['', '   ', '\t\n'])('rejects a blank key (%j) with 400 without hitting the DB', async (key) => {
    const error = await captureError(assertRegisteredDeviceScopeKey(key));
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('TARGET_DEVICE_SCOPE_KEY_INVALID');
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unregistered key with 403 UNKNOWN_DEVICE_SCOPE_KEY', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const error = await captureError(assertRegisteredDeviceScopeKey('unknown-terminal'));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('UNKNOWN_DEVICE_SCOPE_KEY');
  });

  it('treats the legacy site bucket pseudo-key as an ordinary (normally unregistered) location', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const error = await captureError(assertRegisteredDeviceScopeKey(MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY));
    expect(error.code).toBe('UNKNOWN_DEVICE_SCOPE_KEY');
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { location: '__legacy_site__' }, select: { id: true } });
  });
});

describe('listRegisteredDeviceScopeKeysForSite', () => {
  it('returns [] for a blank site without querying', async () => {
    await expect(listRegisteredDeviceScopeKeysForSite('  ')).resolves.toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('queries only devices explicitly assigned to the trimmed site with a location', async () => {
    mocks.findMany.mockResolvedValue([]);
    await listRegisteredDeviceScopeKeysForSite(' 第2工場 ');
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { siteKey: '第2工場', location: { not: null } },
      select: { location: true }
    });
  });

  it('trims, drops blanks, de-duplicates and sorts locations', async () => {
    mocks.findMany.mockResolvedValue([
      { location: 'b-terminal' },
      { location: '  a-terminal ' },
      { location: 'a-terminal' },
      { location: '   ' },
      { location: null },
      { location: 'c-terminal' }
    ]);
    await expect(listRegisteredDeviceScopeKeysForSite('site')).resolves.toEqual(['a-terminal', 'b-terminal', 'c-terminal']);
  });
});
