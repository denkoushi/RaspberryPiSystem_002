import { describe, expect, it, vi } from 'vitest';
import { buildOutsourcedRoutingArrivalByItemId, findOutsourcedRoutingArrivalByItemId } from '../outsourced-routing-arrival.service.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../constants.js';

const target = { itemId: 'a', productNo: '123', processOrder: '20' };
const mail = (status = 'C', overrides: Record<string, unknown> = {}, occurredAt = '2026-11-01T00:00:00Z', createdAt = occurredAt) => ({
  rowData: { FSEZONO: '123', FKOJUN: '10', FKOTEICD: '1234567890', FKOJUNST: status,
    FUPDTEDT: '2026-11-01T00:00:00Z', ...overrides }, occurredAt: new Date(occurredAt), createdAt: new Date(createdAt)
});
const result = (rows: ReturnType<typeof mail>[], item = target) => buildOutsourcedRoutingArrivalByItemId([item], rows).get(item.itemId);

describe('outsourced routing arrival', () => {
  it.each([['C', 'done'], ['R', 'pending']] as const)('uses latest supplier status %s instead of old O', (status, expected) => {
    const old = mail('O');
    const latest = mail(status, { FKOTEICD: '9876543210', FUPDTEDT: '2026-11-02T00:00:00Z' });
    expect(result([latest, old])).toBe(expected);
    expect(result([old, latest])).toBe(expected);
  });
  it('requires every preceding outsourced process to be C or X', () => {
    expect(result([mail('C'), mail('X', { FKOJUN: '15' })])).toBe('done');
    expect(result([mail('C'), mail('S', { FKOJUN: '15' })])).toBe('pending');
  });
  it('does not count the same or later process order', () => {
    expect(result([mail('R', { FKOJUN: '20' }), mail('O', { FKOJUN: '30' })])).toBe('none');
  });
  it.each(['', 'abc', '10a'])('ignores nonnumeric process order %s', (order) => {
    expect(result([mail('R', { FKOJUN: order })])).toBe('none');
    expect(result([mail()], { ...target, processOrder: order })).toBe('none');
  });
  it.each(['123456789', '12345678901', '123456789A'])('does not treat code %s as outsourced', (code) => {
    expect(result([mail('R', { FKOTEICD: code })])).toBe('none');
  });
  it('returns none without outsourced rows or for a different product', () => {
    expect(result([])).toBe('none');
    expect(result([mail('R', { FSEZONO: 'other' })])).toBe('none');
  });
  it('compares orders numerically and trims keys', () => {
    expect(result([mail('C', { FKOJUN: ' 2 ', FSEZONO: ' 123 ' })], { ...target, processOrder: '10' })).toBe('done');
  });
  it.each(['occurredAt', 'createdAt'] as const)('breaks equal FUPDTEDT ties by %s', (field) => {
    const old = mail('O');
    const latest = mail('C', { FKOTEICD: '9876543210' }, field === 'occurredAt' ? '2026-11-02T00:00:00Z' : undefined, '2026-11-02T00:00:00Z');
    expect(result([latest, old])).toBe('done');
    expect(result([old, latest])).toBe('done');
  });
  it('reads raw rows scoped to dashboard and page product numbers', async () => {
    const $queryRaw = vi.fn().mockResolvedValue([mail()]);
    expect(await findOutsourcedRoutingArrivalByItemId([target, { ...target, itemId: 'b' }], { $queryRaw })).toEqual(new Map([['a', 'done'], ['b', 'done']]));
    const query = $queryRaw.mock.calls[0]![0];
    expect(query.join(' ')).toContain('BTRIM("rowData"->>\'FSEZONO\') = ANY(');
    const predicate = $queryRaw.mock.calls[0]![1] as { sql: string };
    expect(predicate.sql).toBe(`"csvDashboardId" = '${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}' AND BTRIM("rowData"->>'FKOTEICD') ~ '^[0-9]{10}$'`);
    expect($queryRaw.mock.calls[0]![2]).toEqual(['123']);
  });
  it('skips DB reads for an empty page', async () => {
    const $queryRaw = vi.fn();
    expect(await findOutsourcedRoutingArrivalByItemId([], { $queryRaw })).toEqual(new Map());
    expect($queryRaw).not.toHaveBeenCalled();
  });
});
