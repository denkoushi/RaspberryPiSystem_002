import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));

import { acquirePalletCommandLock, mapPalletOrderConflict } from '../pallet-command-lock.js';
import { DEFAULT_MACHINE_PALLET_COUNT, MAX_MACHINE_PALLET_COUNT } from '../pallet-count-bounds.js';

describe('acquirePalletCommandLock', () => {
  it('locks on a normalized RESOURCE:pallet key in the pallet namespace', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
    await acquirePalletCommandLock(tx as never, '  hnc01 ', 3);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const [strings, namespace, key] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, number, string];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(namespace).toBe(70422001);
    expect(key).toBe('HNC01:3');
  });

  it('gives different pallets of one machine different keys and one key to case variants', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
    await acquirePalletCommandLock(tx as never, 'HNC01', 3);
    await acquirePalletCommandLock(tx as never, 'hnc01', 3);
    await acquirePalletCommandLock(tx as never, 'HNC01', 4);
    const keys = tx.$executeRaw.mock.calls.map((call) => call[2]);
    expect(keys).toEqual(['HNC01:3', 'HNC01:3', 'HNC01:4']);
  });
});

describe('mapPalletOrderConflict', () => {
  it('maps a unique-constraint violation to 409 PALLET_ORDER_CONFLICT', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: '5.22.0' });
    expect(() => mapPalletOrderConflict(unique)).toThrow(expect.objectContaining({
      statusCode: 409,
      code: 'PALLET_ORDER_CONFLICT',
      message: '同じパレットの表示順が競合しました',
    }));
  });

  it('rethrows other errors unchanged', () => {
    const notFound = new Prisma.PrismaClientKnownRequestError('Missing', { code: 'P2025', clientVersion: '5.22.0' });
    const plain = new Error('boom');
    expect(() => mapPalletOrderConflict(notFound)).toThrow(notFound);
    expect(() => mapPalletOrderConflict(plain)).toThrow(plain);
  });
});

describe('pallet count bounds', () => {
  it('keeps the default within the allowed maximum', () => {
    expect(DEFAULT_MACHINE_PALLET_COUNT).toBe(10);
    expect(MAX_MACHINE_PALLET_COUNT).toBe(60);
  });
});
