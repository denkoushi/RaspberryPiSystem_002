import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  assertKioskApiClientKeyValid,
  parseKioskApiClientKeyHeader,
  requireKioskClientDevice,
  resolveStatusClientIdFromRawKey,
} from '../client-device-auth.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { clientDevice: { findUnique: vi.fn() } } }));

const findUnique = vi.mocked(prisma.clientDevice.findUnique);
const device = { id: 'dev-1', apiKey: 'client-key-1', name: 'kiosk', statusClientId: 'status-1' };

beforeEach(() => {
  vi.resetAllMocks();
  findUnique.mockImplementation((async ({ where }: { where: { apiKey: string } }) =>
    where.apiKey === 'client-key-1' ? device : null) as never);
});

describe('parseKioskApiClientKeyHeader', () => {
  it.each([
    ['client-key-1', 'client-key-1'],
    ['"client-key-1"', 'client-key-1'],
    ['123', '123'],
    ['{"a":1}', '{"a":1}'],
    ['', ''],
  ])('parses header string %j as %j', (raw, expected) => {
    expect(parseKioskApiClientKeyHeader(raw)).toBe(expected);
  });

  it('takes the first value of a repeated header and returns undefined for other shapes', () => {
    expect(parseKioskApiClientKeyHeader(['first', 'second'])).toBe('first');
    expect(parseKioskApiClientKeyHeader([])).toBeUndefined();
    expect(parseKioskApiClientKeyHeader(undefined)).toBeUndefined();
    expect(parseKioskApiClientKeyHeader(42)).toBeUndefined();
  });

  it('passes a non-string first array element through unchanged (unlike normalizeClientKey)', () => {
    // Documented divergence: the parser does not type-check array elements.
    expect(parseKioskApiClientKeyHeader([7])).toBe(7);
  });
});

describe('assertKioskApiClientKeyValid', () => {
  it('rejects a missing or empty key with 401 CLIENT_KEY_REQUIRED without querying', async () => {
    await expect(assertKioskApiClientKeyValid(undefined)).rejects.toMatchObject({ statusCode: 401, code: 'CLIENT_KEY_REQUIRED' });
    await expect(assertKioskApiClientKeyValid('')).rejects.toMatchObject({ statusCode: 401, code: 'CLIENT_KEY_REQUIRED' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown key with 403 CLIENT_KEY_INVALID', async () => {
    await expect(assertKioskApiClientKeyValid('unknown')).rejects.toMatchObject({ statusCode: 403, code: 'CLIENT_KEY_INVALID' });
  });

  it('accepts a JSON-quoted registered key', async () => {
    await expect(assertKioskApiClientKeyValid('"client-key-1"')).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith({ where: { apiKey: 'client-key-1' } });
  });
});

describe('requireKioskClientDevice', () => {
  it('returns the normalized key and device for a registered terminal', async () => {
    await expect(requireKioskClientDevice('"client-key-1"')).resolves.toEqual({ clientKey: 'client-key-1', clientDevice: device });
    await expect(requireKioskClientDevice(['client-key-1', 'ignored'])).resolves.toEqual({ clientKey: 'client-key-1', clientDevice: device });
  });

  it('does not JSON-unquote the first element of a repeated header', async () => {
    await expect(requireKioskClientDevice(['"client-key-1"'])).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CLIENT_KEY' });
    expect(findUnique).toHaveBeenCalledWith({ where: { apiKey: '"client-key-1"' } });
  });

  it('rejects a missing key with 401 CLIENT_KEY_REQUIRED', async () => {
    await expect(requireKioskClientDevice(undefined)).rejects.toMatchObject({ statusCode: 401, code: 'CLIENT_KEY_REQUIRED' });
    await expect(requireKioskClientDevice([1])).rejects.toMatchObject({ statusCode: 401, code: 'CLIENT_KEY_REQUIRED' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unregistered key with 401 INVALID_CLIENT_KEY (not 403)', async () => {
    await expect(requireKioskClientDevice('stolen-or-revoked')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CLIENT_KEY',
      message: '無効なクライアントキーです',
    });
  });
});

describe('resolveStatusClientIdFromRawKey', () => {
  it('maps a registered key to its status client id', async () => {
    findUnique.mockResolvedValue({ statusClientId: 'status-1' } as never);
    await expect(resolveStatusClientIdFromRawKey('client-key-1')).resolves.toBe('status-1');
    expect(findUnique).toHaveBeenCalledWith({ where: { apiKey: 'client-key-1' }, select: { statusClientId: true } });
  });

  it('returns null for missing keys, unknown devices and devices without a status id', async () => {
    await expect(resolveStatusClientIdFromRawKey(undefined)).resolves.toBeNull();
    findUnique.mockResolvedValue(null);
    await expect(resolveStatusClientIdFromRawKey('unknown')).resolves.toBeNull();
    findUnique.mockResolvedValue({ statusClientId: null } as never);
    await expect(resolveStatusClientIdFromRawKey('client-key-1')).resolves.toBeNull();
  });
});
