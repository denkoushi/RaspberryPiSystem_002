import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ devices: new Map<string, string | null>(), tail: Promise.resolve(), lock: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $transaction: vi.fn(async (callback) => {
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({
        $executeRaw: state.lock,
        clientDevice: {
          findFirst: async ({ where }: { where: { statusClientId: string; id: { not: string } } }) => {
            const row = [...state.devices].find(([id, value]) => id !== where.id.not && value === where.statusClientId);
            return row ? { id: row[0] } : null;
          },
          updateMany: async ({ where, data }: { where: { id: string; statusClientId: null }; data: { statusClientId: string } }) => {
            if (state.devices.get(where.id) !== where.statusClientId) return { count: 0 };
            state.devices.set(where.id, data.statusClientId); return { count: 1 };
          },
          findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ statusClientId: state.devices.get(where.id) })
        }
      });
    } finally { release(); }
  })
} }));
import { claimStatusClientId } from '../status-client-id-claim.js';
beforeEach(() => { state.devices.clear(); state.devices.set('d1', null); state.devices.set('d2', null); state.tail = Promise.resolve(); state.lock.mockClear(); });
describe('status client ID claims', () => {
  it('registers the first report and uses a transaction-scoped ID lock', async () => {
    expect(await claimStatusClientId('d1', 'monitor')).toBe('monitor');
    expect(state.devices.get('d1')).toBe('monitor');
    expect((state.lock.mock.calls[0][0] as TemplateStringsArray).join('')).toContain('pg_advisory_xact_lock');
    expect(state.lock.mock.calls[0][1]).toBe('monitor');
  });
  it.each([['d1', 'same', 'd2', 'same'], ['d1', 'first', 'd1', 'second']])('accepts only one conflicting concurrent claim', async (d1, id1, d2, id2) => {
    const results = await Promise.allSettled([claimStatusClientId(d1, id1), claimStatusClientId(d2, id2)]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((row) => row.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(state.devices.get(d1)).toBe(id1);
  });
  it('allows retrying the same claim without overwriting it', async () => {
    await claimStatusClientId('d1', 'same');
    expect(await claimStatusClientId('d1', 'same')).toBe('same');
  });
});
