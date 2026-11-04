import { describe, expect, it, vi } from 'vitest';

import { resolveBorrowTagDestination } from './resolveBorrowTagDestination';

const notFound = () => Promise.reject({ response: { status: 404 } });

describe('resolveBorrowTagDestination', () => {
  it('計測機器が見つかれば吊具の結果に関わらず計測機器を優先する', async () => {
    await expect(
      resolveBorrowTagDestination('t1', {
        lookupInstrument: async () => ({ id: 'mi' }),
        lookupRigging: async () => ({ id: 'rg' })
      })
    ).resolves.toBe('MEASURING_INSTRUMENT');
    await expect(
      resolveBorrowTagDestination('t1', { lookupInstrument: async () => ({ id: 'mi' }), lookupRigging: notFound })
    ).resolves.toBe('MEASURING_INSTRUMENT');
  });

  it('計測機器が見つからない/失敗した場合は吊具を判定する', async () => {
    await expect(
      resolveBorrowTagDestination('t1', { lookupInstrument: notFound, lookupRigging: async () => ({ id: 'rg' }) })
    ).resolves.toBe('RIGGING_GEAR');
    await expect(
      resolveBorrowTagDestination('t1', {
        lookupInstrument: () => Promise.reject(new Error('Network Error')),
        lookupRigging: async () => ({ id: 'rg' })
      })
    ).resolves.toBe('RIGGING_GEAR');
    await expect(
      resolveBorrowTagDestination('t1', { lookupInstrument: async () => undefined, lookupRigging: async () => ({ id: 'rg' }) })
    ).resolves.toBe('RIGGING_GEAR');
  });

  it('どちらも該当しない/失敗した場合は null（工具・従業員フローを継続）', async () => {
    await expect(resolveBorrowTagDestination('t1', { lookupInstrument: notFound, lookupRigging: notFound })).resolves.toBeNull();
    await expect(
      resolveBorrowTagDestination('t1', { lookupInstrument: async () => null, lookupRigging: async () => undefined })
    ).resolves.toBeNull();
  });

  it('2つの照会を並列に開始する', async () => {
    let releaseInstrument: (value: unknown) => void = () => {};
    const lookupInstrument = vi.fn(() => new Promise((resolve) => { releaseInstrument = resolve; }));
    const lookupRigging = vi.fn(async () => null);
    const pending = resolveBorrowTagDestination('t1', { lookupInstrument, lookupRigging });
    expect(lookupInstrument).toHaveBeenCalledWith('t1');
    expect(lookupRigging).toHaveBeenCalledWith('t1');
    releaseInstrument(null);
    await expect(pending).resolves.toBeNull();
  });
});
