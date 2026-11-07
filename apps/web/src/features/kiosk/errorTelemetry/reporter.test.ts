import { describe, expect, it, vi } from 'vitest';

import { KioskErrorReporter, QUEUE_KEY } from './reporter';
function setup(saved?: string) {
  let now = 100000;
  let route = '/kiosk/borrow';
  let online = true;
  const storage = new Map<string, string>(saved ? [[QUEUE_KEY, saved]] : []);
  const env = { now: () => now, route: () => route, online: () => online, storage: () => ({ getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } }) };
  const reporter = new KioskErrorReporter(env);
  const send = vi.fn().mockResolvedValue(undefined);
  reporter.setTransport(send);
  return { reporter, send, storage, env, time: (value: number) => { now = value; }, route: (value: string) => { route = value; }, online: (value: boolean) => { online = value; } };
}
describe('kiosk error reporter', () => {
  it('aggregates repeated polling errors with latest incident and count', async () => {
    const s = setup();
    for (let i = 0; i < 100; i++) s.reporter.record('api_network', { method: 'get', urlPath: '/orders?q=secret' });
    await s.reporter.flush();
    expect(s.send.mock.calls[0][0]).toHaveLength(1);
    expect(s.send.mock.calls[0][0][0].context).toMatchObject({ count: 100, urlPath: '/orders' });
  });
  it('limits attempts to 20 rows per rolling minute and reports drops later', async () => {
    const s = setup();
    for (let i = 0; i < 20; i++) s.reporter.record('api_network', { urlPath: `/orders/${i}` });
    await s.reporter.flush();
    s.reporter.record('api_network', { urlPath: '/excess' });
    await s.reporter.flush();
    expect(s.send).toHaveBeenCalledTimes(1);
    s.time(160001);
    s.reporter.record('api_network', { urlPath: '/next' });
    await s.reporter.flush();
    expect(s.send.mock.calls[1][0][0].context.droppedCount).toBe(1);
  });
  it('keeps piece queue and attempt budgets separate from crashes and existing reports', async () => {
    const s = setup();
    for (let i = 0; i < 100; i++) s.reporter.record('sessaku_piece', { status: 500 });
    expect(JSON.parse(s.storage.get(QUEUE_KEY)!).queue).toHaveLength(5);
    s.reporter.record('render_crash', { message: 'crash after piece failures' });
    expect(s.send.mock.calls[0][0]).toHaveLength(6);
    expect(s.send.mock.calls[0][0]).toContainEqual(expect.objectContaining({ context: expect.objectContaining({ kind: 'render_crash' }) }));
    await s.reporter.flush();
    for (let i = 0; i < 100; i++) s.reporter.record('sessaku_piece', { status: 500 });
    for (let i = 0; i < 19; i++) s.reporter.record('api_network', { urlPath: `/orders/${i}` });
    await s.reporter.flush();
    expect(s.send.mock.calls[1][0]).toHaveLength(19);
    expect(s.send.mock.calls.flatMap(([logs]) => logs).filter((log) => log.context.kind === 'sessaku_piece')).toHaveLength(5);
    const restored = setup(s.storage.get(QUEUE_KEY));
    restored.reporter.record('sessaku_piece', { status: 500 });
    await restored.reporter.flush();
    expect(restored.send).not.toHaveBeenCalled();
    restored.time(160001);
    restored.reporter.record('sessaku_piece', { status: 500 });
    await restored.reporter.flush();
    expect(restored.send.mock.calls[0][0]).toHaveLength(1);
  });
  it('can send a crash immediately after exhausting the piece attempt budget', async () => {
    const s = setup();
    for (let i = 0; i < 20; i++) {
      s.reporter.record('sessaku_piece');
      await s.reporter.flush();
    }
    expect(s.send).toHaveBeenCalledTimes(5);
    s.reporter.record('render_crash', { message: 'crash' });
    expect(s.send.mock.calls[5][0][0].context.kind).toBe('render_crash');
  });
  it('preserves both exhausted budgets across two reloads in the same minute', async () => {
    const s = setup();
    s.send.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < 20; i++) s.reporter.record('api_network', { urlPath: `/orders/${i}` });
    for (let i = 0; i < 5; i++) s.reporter.record('sessaku_piece', { status: 409 });
    await s.reporter.flush();
    expect(s.send.mock.calls[0][0]).toHaveLength(25);
    const restored = setup(s.storage.get(QUEUE_KEY));
    const twiceRestored = setup(restored.storage.get(QUEUE_KEY));
    for (const current of [restored, twiceRestored]) {
      await current.reporter.flush();
      expect(current.send).not.toHaveBeenCalled();
      const saved = JSON.parse(current.storage.get(QUEUE_KEY)!);
      expect(saved.attempts).toHaveLength(20);
      expect(saved.pieceAttempts).toHaveLength(5);
    }
    twiceRestored.time(160001);
    await twiceRestored.reporter.flush();
    expect(twiceRestored.send.mock.calls[0][0]).toHaveLength(25);
  });
  it('adds discarded legacy piece rows to saved drops', async () => {
    const s = setup();
    s.reporter.record('sessaku_piece', { status: 409 });
    const saved = JSON.parse(s.storage.get(QUEUE_KEY)!);
    saved.queue = Array.from({ length: 10 }, (_, i) => ({
      ...saved.queue[0], log: { ...saved.queue[0].log, context: { ...saved.queue[0].log.context, incidentCode: `AAAAA${'ABCDEFGHJK'[i]}` } }
    }));
    saved.dropped = 3;
    delete saved.pieceAttempts;
    const restored = setup(JSON.stringify(saved));
    expect(JSON.parse(restored.storage.get(QUEUE_KEY)!).dropped).toBe(8);
    restored.reporter.record('api_network', { urlPath: '/orders' });
    await restored.reporter.flush();
    const logs = restored.send.mock.calls[0][0];
    expect(logs).toHaveLength(6);
    expect(logs.slice(0, 5).every((log: { context: Record<string, unknown> }) => log.context.droppedCount === undefined)).toBe(true);
    expect(logs[5].context.droppedCount).toBe(8);
  });
  it('carries drops over a piece-only send to the next non-piece row', async () => {
    const s = setup();
    for (let i = 0; i < 7; i++) s.reporter.record('sessaku_piece', { status: 409 });
    await s.reporter.flush();
    expect(s.send.mock.calls[0][0]).toHaveLength(5);
    for (const log of s.send.mock.calls[0][0]) expect(log.context).not.toHaveProperty('droppedCount');
    expect(JSON.parse(s.storage.get(QUEUE_KEY)!).dropped).toBe(2);
    s.reporter.record('api_network', { urlPath: '/orders' });
    await s.reporter.flush();
    expect(s.send.mock.calls[1][0][0].context).toMatchObject({ kind: 'api_network', droppedCount: 2 });
    expect(JSON.parse(s.storage.get(QUEUE_KEY)!).dropped).toBe(0);
  });
  it('warns for PIECE_QUANTITY_CONFLICT with status 400, including after reload', async () => {
    const s = setup();
    s.reporter.record('sessaku_piece', { status: 400, errorCode: 'PIECE_QUANTITY_CONFLICT' });
    const restored = setup(s.storage.get(QUEUE_KEY));
    await s.reporter.flush();
    await restored.reporter.flush();
    for (const current of [s, restored]) expect(current.send.mock.calls[0][0][0]).toMatchObject({
      level: 'WARN', context: { status: 400, errorCode: 'PIECE_QUANTITY_CONFLICT' }
    });
  });
  it.each([[409, 'WARN'], [400, 'ERROR'], [500, 'ERROR'], [undefined, 'ERROR']])('uses %s piece status level %s, including after reload', async (status, level) => {
    const s = setup();
    s.reporter.record('sessaku_piece', { status });
    const restored = setup(s.storage.get(QUEUE_KEY));
    await restored.reporter.flush();
    expect(restored.send.mock.calls[0][0][0].level).toBe(level);
  });
  it('restores persistent queue after failed sending and offline reload', async () => {
    const s = setup();
    s.send.mockRejectedValue(new Error('offline'));
    s.reporter.record('api_timeout', { urlPath: '/orders' });
    await s.reporter.flush();
    const restored = setup(s.storage.get(QUEUE_KEY));
    await restored.reporter.flush();
    expect(restored.send.mock.calls[0][0][0].context).toMatchObject({ kind: 'api_timeout', count: 1 });
  });
  it('keeps failed rows when rate budget is exhausted', async () => {
    const s = setup();
    s.send.mockRejectedValue(new Error('offline'));
    s.reporter.record('api_network', { urlPath: '/orders' });
    for (let i = 0; i < 21; i++) await s.reporter.flush();
    expect(s.send).toHaveBeenCalledTimes(20);
    s.time(160001);
    s.send.mockResolvedValue(undefined);
    await s.reporter.flush();
    expect(s.send).toHaveBeenCalledTimes(21);
  });
  it('bounds offline queue to 50 rows and does not send offline', async () => {
    const s = setup(); s.online(false);
    for (let i = 0; i < 70; i++) s.reporter.record('api_network', { urlPath: `/orders/${i}` });
    await s.reporter.flush();
    expect(s.send).not.toHaveBeenCalled();
    const saved = JSON.parse(s.storage.get(QUEUE_KEY)!);
    expect(saved.queue).toHaveLength(50); expect(saved.dropped).toBe(20);
  });
  it('ignores logs endpoint and non-kiosk routes, including queued sends', async () => {
    const s = setup();
    s.reporter.record('api_5xx', { urlPath: 'https://example/api/clients/logs?secret=a' });
    s.route('/admin'); s.reporter.record('window_error', { message: 'failed' });
    await s.reporter.flush(); expect(s.send).not.toHaveBeenCalled();
    s.route('/kiosk'); s.reporter.record('window_error', { message: 'failed' });
    s.route('/admin'); await s.reporter.flush(); expect(s.send).not.toHaveBeenCalled();
  });
  it('allowlists context and strips queries, body, headers, input, credentials', async () => {
    const s = setup();
    s.reporter.record('api_5xx', { method: 'get', urlPath: '/orders?token=secret', body: { secret: 'body-secret' }, headers: { Authorization: 'secret' }, input: 'input-secret', apiCode: 'BAD_CODE', requestId: 'req-1', status: 503, durationMs: 200 });
    s.reporter.record('window_error', { name: 'TypeError', message: 'Failed /orders?token=query-secret Authorization=header-secret value=input-secret', stack: 'at /app.js?x=stack-secret' });
    await s.reporter.flush();
    const serialized = JSON.stringify(s.send.mock.calls[0]);
    expect(serialized).not.toContain('secret'); expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('headers'); expect(serialized).not.toContain('body');
  });
  it('sends render crashes immediately and tolerates unusable storage', async () => {
    const s = setup();
    const reporter = new KioskErrorReporter({ ...s.env, storage: () => { throw new Error('denied'); } });
    reporter.setTransport(s.send);
    const incident = reporter.record('render_crash', { message: 'x'.repeat(1500), stack: 'x'.repeat(3000), recoveryDecision: 'reload' });
    expect(incident?.incidentCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(s.send.mock.calls[0][0][0].message).toHaveLength(1000);
    expect(s.send.mock.calls[0][0][0].context.stack).toHaveLength(2000);
  });
  it('preserves occurrences collected while a send is in flight', async () => {
    const s = setup(); let complete!: () => void;
    s.send.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    s.reporter.record('api_network', { urlPath: '/orders' });
    const pending = s.reporter.flush();
    s.reporter.record('api_network', { urlPath: '/orders' });
    complete(); await pending;
    expect(JSON.parse(s.storage.get(QUEUE_KEY)!).queue[0].log.context.count).toBe(1);
  });
  it('resends the same failure at most once per minute while it keeps aggregating', async () => {
    const s = setup();
    s.reporter.record('api_5xx', { method: 'get', urlPath: '/orders', status: 500 });
    await s.reporter.flush();
    s.time(105000);
    s.reporter.record('api_5xx', { method: 'get', urlPath: '/orders', status: 500 });
    s.reporter.record('api_5xx', { method: 'get', urlPath: '/orders', status: 500 });
    await s.reporter.flush();
    expect(s.send).toHaveBeenCalledTimes(1);
    s.time(160000);
    await s.reporter.flush();
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send.mock.calls[1][0][0].context.count).toBe(2);
  });
  it('skips harmless ResizeObserver window errors and keeps property names in messages', async () => {
    const s = setup();
    s.reporter.record('window_error', { name: 'Error', message: 'ResizeObserver loop completed with undelivered notifications.' });
    s.reporter.record('window_error', { name: 'TypeError', message: "Cannot read properties of undefined (reading 'orderNo'), got \"山田 太郎\"" });
    await s.reporter.flush();
    expect(s.send.mock.calls[0][0]).toHaveLength(1);
    expect(s.send.mock.calls[0][0][0].message).toBe("Cannot read properties of undefined (reading 'orderNo'), got [redacted]");
  });
});
