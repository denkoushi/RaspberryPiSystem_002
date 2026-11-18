import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../lib/logger.js';
import { registerClientCoreRoutes } from '../../routes/clients/core.js';
import { createOsSecurityUpdateRequest, recordOsSecurityUpdateReport, sweepOsSecurityUpdateRequests, type OsSecurityUpdateReport } from './os-security-early-update.js';

const db = vi.hoisted(() => ({
  clientDevice: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  clientStatus: { upsert: vi.fn() },
  osSecurityUpdateClientReport: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  osSecurityUpdateTarget: { findMany: vi.fn(), updateMany: vi.fn() },
  osSecurityUpdateRequest: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } }));
vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));

const clientId = 'raspi-1';
const deliveredAt = new Date('2026-11-18T00:00:00Z');
const finishedAt = new Date('2026-11-19T01:00:00Z');
const request = {
  id: 'request-1', noticeKey: 'jpcert:job-1', title: 'Chromium に脆弱性', url: 'https://www.jpcert.or.jp/a',
  packages: ['chromium', 'chromium-browser'], mode: 'auto',
  products: { Chromium: { packages: ['chromium', 'chromium-browser'], comparable: true, fixedVersion: '131.0.1' } },
  expiresAt: new Date('2026-12-02T00:00:00Z'),
};
const target = { requestId: request.id, clientId, deliveredAt, state: 'pending' };
const enabledReport = { earlyEnabled: true, requests: [], check: null };
const deliver = vi.fn();
const log = { warn: vi.fn() };

function checkedReport(): OsSecurityUpdateReport {
  return {
    earlyEnabled: true,
    requests: [{ id: request.id, receivedAt: deliveredAt.toISOString(), baseline: {
      chromium: { state: 'installed', version: '130.0' },
    } }],
    check: {
      requestIds: [request.id], result: 'applied', finishedAt: finishedAt.toISOString(),
      packages: {
        chromium: { state: 'installed', version: '2:131.0.1-1~deb12u1', candidateRemaining: true },
        'chromium-browser': { state: 'absent', version: null, candidateRemaining: null },
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.clientDevice.findUnique.mockResolvedValue({ id: 'device-1', statusClientId: clientId });
  db.clientDevice.update.mockResolvedValue({ id: 'device-1' });
  db.clientStatus.upsert.mockResolvedValue({ id: 'status-1' });
  db.osSecurityUpdateClientReport.createMany.mockResolvedValue({ count: 1 });
  db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, request }]);
  db.osSecurityUpdateTarget.updateMany.mockResolvedValue({ count: 1 });
  db.osSecurityUpdateRequest.updateMany.mockResolvedValue({ count: 1 });
  db.clientDevice.findMany.mockResolvedValue([{ statusClientId: clientId, name: '切削端末' }]);
});

it('requires an enabled report within the configured heartbeat staleness threshold', async () => {
  vi.stubEnv('CLIENT_HEARTBEAT_STALE_MINUTES', '2');
  try {
    db.osSecurityUpdateClientReport.findMany.mockResolvedValue([]);
    const { noticeKey, title, url, products } = request;
    expect(await createOsSecurityUpdateRequest({ noticeKey, title, url, products }, finishedAt)).toBeUndefined();
    expect(db.osSecurityUpdateClientReport.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { earlyEnabled: true, receivedAt: { gte: new Date(finishedAt.getTime() - 120_000) } },
      select: { clientId: true },
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

describe('POST /clients/status OS security updates', () => {
  const app = Fastify();
  void app.register(registerClientCoreRoutes, { prefix: '/api' });
  afterAll(async () => { await app.close(); });

  function post(osSecurityUpdate: unknown) {
    return app.inject({
      method: 'POST', url: '/api/clients/status', headers: { 'x-client-key': 'fixture-client-key' },
      payload: { clientId, hostname: clientId, ipAddress: '192.0.2.1', cpuUsage: 1, memoryUsage: 2, diskUsage: 3, osSecurityUpdate },
    });
  }

  it('disables the existing report when the status omits the block', async () => {
    db.osSecurityUpdateClientReport.updateMany.mockResolvedValue({ count: 1 });
    const response = await post(undefined);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: expect.any(String), statusId: 'status-1', clientDeviceId: 'device-1', logsStored: 0 });
    expect(db.clientStatus.upsert).toHaveBeenCalledOnce();
    const receivedAt = db.clientStatus.upsert.mock.calls[0][0].update.lastSeen;
    expect(db.osSecurityUpdateClientReport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { clientId, receivedAt: { lte: receivedAt } },
      data: { earlyEnabled: false, receivedAt },
    });
    expect(db.osSecurityUpdateClientReport.createMany).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns with only the client ID and issue paths for an invalid block', async () => {
    db.osSecurityUpdateClientReport.updateMany.mockResolvedValue({ count: 1 });
    const response = await post({ ...enabledReport, earlyEnabled: 'invalid-value' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('osSecurityUpdateRequests');
    expect(db.clientStatus.upsert).toHaveBeenCalledOnce();
    expect(db.osSecurityUpdateClientReport.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { clientId, receivedAt: { lte: expect.any(Date) } },
      data: { earlyEnabled: false, receivedAt: expect.any(Date) },
    });
    expect(db.osSecurityUpdateClientReport.createMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ clientId, paths: [['earlyEnabled']] }, expect.any(String));
  });

  it('saves status and logs a failed disable write', async () => {
    db.osSecurityUpdateClientReport.updateMany.mockRejectedValue(new Error('DB error'));
    const response = await post(undefined);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: expect.any(String), statusId: 'status-1', clientDeviceId: 'device-1', logsStored: 0 });
    expect(db.clientStatus.upsert).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ clientId, error: 'Error' }, expect.any(String));
  });

  it('records a disabled report and omits the response key', async () => {
    const report = { ...enabledReport, earlyEnabled: false };
    const response = await post(report);
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('osSecurityUpdateRequests');
    expect(db.osSecurityUpdateClientReport.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { clientId, earlyEnabled: false, report, receivedAt: expect.any(Date) },
    }));
  });

  it('returns open requests and records their first delivery', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, deliveredAt: null, request: { ...request, expiresAt } }]);
    const response = await post(enabledReport);
    expect(response.statusCode).toBe(200);
    expect(response.json().osSecurityUpdateRequests).toEqual([{ id: request.id, packages: request.packages, expiresAt: expiresAt.toISOString() }]);
    expect(db.osSecurityUpdateTarget.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId, request: { status: 'open', expiresAt: { gte: expect.any(Date) } } },
    }));
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { clientId, deliveredAt: null, requestId: { in: [request.id] } },
      data: { deliveredAt: expect.any(Date) },
    });
  });

  it('returns an empty array with no open requests', async () => {
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([]);
    expect((await post(enabledReport)).json().osSecurityUpdateRequests).toEqual([]);
  });

  it('returns only requests with pending or failed targets', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.osSecurityUpdateTarget.findMany.mockResolvedValue(['pending', 'failed', 'verified'].map(state => ({
      ...target, state, requestId: state, request: { ...request, id: state, expiresAt },
    })));
    const response = await post(enabledReport);
    expect(response.json().osSecurityUpdateRequests).toEqual(['pending', 'failed'].map(id => ({
      id, packages: request.packages, expiresAt: expiresAt.toISOString(),
    })));
  });

  it('returns an empty array when this status verifies the last target', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, request: { ...request, expiresAt } }]);
    const response = await post(checkedReport());
    expect(response.json().osSecurityUpdateRequests).toEqual([]);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'verified' }),
    }));
  });

  it('leaves the first delivery timestamp in place on subsequent polls', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, request: { ...request, expiresAt } }]);
    expect((await post(enabledReport)).json().osSecurityUpdateRequests).toHaveLength(1);
    expect(db.osSecurityUpdateTarget.updateMany).not.toHaveBeenCalled();
  });

  it('preserves a successful status write when the new tables cannot be written', async () => {
    db.osSecurityUpdateClientReport.createMany.mockRejectedValue(new Error('DB error'));
    const response = await post(enabledReport);
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('osSecurityUpdateRequests');
    expect(db.clientStatus.upsert).toHaveBeenCalledOnce();
  });
});

describe('target checks', () => {
  it.each(['no check', 'old check', 'missing ID', 'not yet delivered'])('leaves a target pending with %s', async kind => {
    const report = checkedReport();
    if (kind === 'no check') report.check = null;
    if (kind === 'old check') report.check!.finishedAt = new Date(deliveredAt.getTime() - 1).toISOString();
    if (kind === 'missing ID') report.check!.requestIds = ['other'];
    if (kind === 'not yet delivered') db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, deliveredAt: null, request }]);
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany.mock.calls.every(([args]) => !args.data.state)).toBe(true);
  });

  it('verifies a comparable version with a Debian epoch and revision and accepts the absent alternative', async () => {
    await recordOsSecurityUpdateReport(clientId, checkedReport(), finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { clientId, requestId: request.id, state: 'pending', request: { status: 'open' } },
      data: { state: 'verified', detail: { reason: 'packages_verified' }, verifiedAt: finishedAt },
    });
  });

  it('verifies a failed target after a successful check', async () => {
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, state: 'failed', request }]);
    expect(await recordOsSecurityUpdateReport(clientId, checkedReport(), finishedAt)).toEqual([]);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { clientId, requestId: request.id, state: 'failed', request: { status: 'open' } },
      data: { state: 'verified', detail: { reason: 'packages_verified' }, verifiedAt: finishedAt },
    });
  });

  it('skips rewriting the same pending state and detail regardless of JSON key order', async () => {
    const report = checkedReport();
    report.check!.packages.chromium = { state: 'unmeasured', version: null, candidateRemaining: null };
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{
      ...target, request, detail: { package: 'chromium', product: 'Chromium', reason: 'unmeasured' },
    }]);
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).not.toHaveBeenCalled();
  });

  it('skips rewriting the same failed state and detail', async () => {
    const report = checkedReport();
    report.check!.result = 'failed';
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{
      ...target, request, state: 'failed', detail: { reason: 'update_failed' },
    }]);
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['130.0', false, 'pending'], ['130.1', true, 'pending'], ['130.1', null, 'pending'], ['130.1', false, 'verified'],
  ] as const)('with version %s and candidate %s is %s without a comparable fixed version', async (version, candidateRemaining, state) => {
    const report = checkedReport();
    report.check!.packages.chromium = { state: 'installed', version, candidateRemaining };
    const products = { Chromium: { ...request.products.Chromium, comparable: false, fixedVersion: null } };
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, request: { ...request, products } }]);
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: expect.objectContaining({ state }),
    }));
  });

  it('keeps an unmeasured package pending', async () => {
    const report = checkedReport();
    report.check!.packages['chromium-browser'] = { state: 'unmeasured', version: null, candidateRemaining: null };
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { state: 'pending', detail: { reason: 'unmeasured', product: 'Chromium', package: 'chromium-browser' } },
    }));
  });

  it('keeps a non-comparable package pending without a measured baseline version', async () => {
    const report = checkedReport();
    report.requests[0].baseline.chromium.version = null;
    report.check!.packages.chromium.candidateRemaining = false;
    const products = { Chromium: { ...request.products.Chromium, comparable: false, fixedVersion: null } };
    db.osSecurityUpdateTarget.findMany.mockResolvedValue([{ ...target, request: { ...request, products } }]);
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { state: 'pending', detail: { reason: 'changed_version_not_confirmed', product: 'Chromium', package: 'chromium' } },
    }));
  });

  it('records failure and notifies with the device name before expiry', async () => {
    const report = checkedReport();
    report.check!.result = 'failed';
    await recordOsSecurityUpdateReport(clientId, report, finishedAt);
    expect(db.osSecurityUpdateTarget.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { state: 'failed', detail: { reason: 'update_failed' } },
    }));
    db.osSecurityUpdateRequest.findMany.mockResolvedValue([{ ...request, targets: [{ ...target, state: 'failed' }] }]);
    await sweepOsSecurityUpdateRequests(finishedAt, deliver, log);
    const notice = deliver.mock.calls[0][0];
    expect(notice.body).toMatch(/^要対応:/);
    expect(notice.body).toContain('更新に失敗した端末: 切削端末');
    expect(notice.body).toContain(request.title);
    expect(notice.body).toContain(request.url);
    expect(notice.key).toBe(request.noticeKey);
  });
});

describe('request sweep', () => {
  it('notifies once on expiry even if the next sweep sees the same open snapshot', async () => {
    db.osSecurityUpdateRequest.findMany.mockResolvedValue([{ ...request, targets: [target] }]);
    db.osSecurityUpdateRequest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const afterExpiry = new Date(request.expiresAt.getTime() + 1);
    await sweepOsSecurityUpdateRequests(request.expiresAt, deliver, log);
    expect(db.osSecurityUpdateRequest.updateMany).not.toHaveBeenCalled();
    await sweepOsSecurityUpdateRequests(afterExpiry, deliver, log);
    await sweepOsSecurityUpdateRequests(afterExpiry, deliver, log);
    expect(db.osSecurityUpdateRequest.updateMany).toHaveBeenCalledTimes(2);
    expect(db.osSecurityUpdateRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: request.id, status: 'open' }),
      data: { status: 'notified', resolvedAt: afterExpiry },
    }));
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0][0].body).toContain('期限までに確かめられなかった端末: 切削端末。修正版の配布待ちの可能性があります。');
  });

  it.each([
    ['auto', 'verified', 'verified'], ['trial', 'verified', 'verified'], ['trial', 'failed', 'notified'],
  ] as const)('closes a %s request with %s targets as %s without a notice', async (mode, state, status) => {
    db.osSecurityUpdateRequest.findMany.mockResolvedValue([{ ...request, mode, targets: [{ ...target, state }] }]);
    const afterExpiry = new Date(request.expiresAt.getTime() + 1);
    await sweepOsSecurityUpdateRequests(afterExpiry, deliver, log);
    expect(db.osSecurityUpdateRequest.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { status, resolvedAt: afterExpiry },
    }));
    expect(deliver).not.toHaveBeenCalled();
  });
});
