import { describe, expect, it, vi } from 'vitest';

import { KioskNetworkReporter, NETWORK_SAMPLE_LIMIT, NETWORK_WINDOW_MS } from './networkReporter';

function fixture() {
  let now = 0;
  let route = '/kiosk/borrow';
  const send = vi.fn().mockResolvedValue(undefined);
  const reporter = new KioskNetworkReporter({
    now: () => now, route: () => route, online: () => true,
    connection: () => ({ effectiveType: '4g', downlink: 10, rtt: 50 })
  });
  reporter.setTransport(send);
  return { reporter, send, time: (value = NETWORK_WINDOW_MS) => { now = value; }, route: (value: string) => { route = value; } };
}

describe('kiosk network aggregation', () => {
  it('reports counts, failures and nearest-rank percentiles once per window', async () => {
    const f = fixture();
    for (let index = 1; index <= 100; index += 1) {
      f.reporter.record({ url: '/orders?input=secret', durationMs: index * 10, status: index === 1 ? undefined : index === 2 ? 503 : index === 3 ? 400 : 200 });
    }
    await f.reporter.flush(); expect(f.send).not.toHaveBeenCalled();
    f.time(); await f.reporter.flush();
    expect(f.send).toHaveBeenCalledWith([{ level: 'INFO', message: 'キオスクAPI応答時間の集計', context: {
      category: 'kiosk_net_stats', route: '/kiosk/borrow', windowStart: '1970-01-01T00:00:00.000Z', windowSeconds: 300,
      requests: 100, failures: 2, p50Ms: 500, p95Ms: 950, maxMs: 1000, online: true,
      effectiveType: '4g', downlinkMbps: 10, rttMs: 50
    } }]);
    await f.reporter.flush(); expect(f.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.send.mock.calls)).not.toContain('secret');
  });

  it('does not report empty windows or non-kiosk observations', async () => {
    const f = fixture();
    f.time(); await f.reporter.flush();
    f.route('/admin'); f.reporter.record({ url: '/orders', status: 200, durationMs: 100 });
    f.time(NETWORK_WINDOW_MS * 2); await f.reporter.flush();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('drops pending samples when sending outside kiosk and uses the sending route', async () => {
    const f = fixture();
    f.reporter.record({ url: '/orders', durationMs: 10, status: 200 });
    f.route('/admin'); f.time(); await f.reporter.flush(); expect(f.send).not.toHaveBeenCalled();
    f.route('/kiosk/return'); f.reporter.record({ url: '/orders', durationMs: 20, status: 200 });
    f.route('/kiosk/call'); f.time(2 * NETWORK_WINDOW_MS); await f.reporter.flush();
    expect(f.send.mock.calls[0][0][0].context.route).toBe('/kiosk/call');
    expect(f.send.mock.calls[0][0][0].context.requests).toBe(1);
  });

  it.each(['/clients/logs', '/api/clients/logs/?secret=value', 'https://server/api/clients/logs?key=secret',
    '/api/webrtc/signaling?clientKey=secret', '/stream', '/events/sse', 'wss://server/api/webrtc/signaling'])('excludes %s', async (url) => {
    const f = fixture(); f.reporter.record({ url, durationMs: 60000, status: 500 });
    f.time(); await f.reporter.flush(); expect(f.send).not.toHaveBeenCalled();
  });

  it('excludes configured streams and cancellations, and ignores invalid durations', async () => {
    const f = fixture();
    for (const input of [{ streaming: true }, { code: 'ERR_CANCELED' }, { durationMs: NaN }, { durationMs: -1 }]) {
      f.reporter.record({ url: '/orders', status: 200, durationMs: 10, ...input });
    }
    f.time(); await f.reporter.flush(); expect(f.send).not.toHaveBeenCalled();
  });

  it('caps percentile samples but counts all requests/failures and max', async () => {
    const f = fixture();
    for (let i = 0; i < NETWORK_SAMPLE_LIMIT; i += 1) f.reporter.record({ url: '/orders', durationMs: 10, status: 200 });
    for (let i = 0; i < 5000; i += 1) f.reporter.record({ url: '/orders', durationMs: 9999, status: 500 });
    expect((f.reporter as unknown as { samples: number[] }).samples).toHaveLength(NETWORK_SAMPLE_LIMIT);
    f.time(); await f.reporter.flush();
    expect(f.send.mock.calls[0][0][0].context).toMatchObject({ requests: 5500, failures: 5000, p50Ms: 10, p95Ms: 10, maxMs: 9999 });
  });

  it('discards failed sending without exceptions, persistence or retry', async () => {
    const f = fixture(); f.send.mockRejectedValue(new Error('offline'));
    f.reporter.record({ url: '/orders', durationMs: 20 }); f.time();
    await expect(f.reporter.flush()).resolves.toBeUndefined();
    f.time(2 * NETWORK_WINDOW_MS); await f.reporter.flush(); expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('survives delayed hidden timers and isolates a new request into the next window', async () => {
    const f = fixture();
    f.reporter.record({ url: '/orders', durationMs: 10 });
    f.time(4 * NETWORK_WINDOW_MS);
    f.reporter.record({ url: '/orders', durationMs: 20 });
    await f.reporter.flush();
    expect(f.send.mock.calls[0][0][0].context).toMatchObject({ requests: 1, maxMs: 10, windowSeconds: 300 });
    f.time(5 * NETWORK_WINDOW_MS); await f.reporter.flush();
    expect(f.send.mock.calls[1][0][0].context).toMatchObject({ requests: 1, maxMs: 20 });
  });

  it('omits unavailable connection fields and never serializes request metadata', async () => {
    let now = 0;
    const send = vi.fn().mockResolvedValue(undefined);
    const reporter = new KioskNetworkReporter({ now: () => now, route: () => '/kiosk', online: () => false,
      connection: () => { throw new Error('unsupported'); } });
    reporter.setTransport(send);
    const input = { url: '/orders?secret=value', durationMs: 1, status: 401, body: 'private', headers: { token: 'private' }, method: 'POST' };
    reporter.record(input); now = NETWORK_WINDOW_MS; await reporter.flush();
    expect(Object.keys(send.mock.calls[0][0][0].context).sort()).toEqual(['category', 'route', 'windowStart', 'windowSeconds', 'requests', 'failures', 'p50Ms', 'p95Ms', 'maxMs', 'online'].sort());
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/private|orders|secret|POST/);
  });

  it('swallows observation/environment exceptions', async () => {
    const reporter = new KioskNetworkReporter({ now: () => 0, route: () => { throw new Error(); }, online: () => true });
    expect(() => reporter.record({ url: '/orders', durationMs: 1 })).not.toThrow();
    await expect(reporter.flush()).resolves.toBeUndefined();
  });
});
