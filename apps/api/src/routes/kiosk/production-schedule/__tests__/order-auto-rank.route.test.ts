import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../../config/env.js';
import { ApiError } from '../../../../lib/errors.js';
import { registerErrorHandler } from '../../../../plugins/error-handler.js';
import { registerProductionScheduleOrderRoute } from '../order.js';

const mocks = vi.hoisted(() => ({ save: vi.fn(), single: vi.fn(), registered: vi.fn() }));
vi.mock('../../../../services/production-schedule/production-schedule-auto-rank.service.js', () => ({ autoRankProductionScheduleOrder: mocks.save }));
vi.mock('../../../../services/production-schedule/production-schedule-command.service.js', () => ({ upsertProductionScheduleOrder: mocks.single }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { clientDevice: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock('../../../../lib/manual-order-device-scope.js', () => ({ assertRegisteredDeviceScopeKey: mocks.registered }));
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const payload = { resourceCd: '305', assignments: [{ rowId: a, orderNumber: 1 }, { rowId: b, orderNumber: 2 }] };
const url = '/kiosk/production-schedule/order/auto-rank';
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ success: true, assignments: payload.assignments }); });

const originalV2 = env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;
afterEach(() => { env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED = originalV2; });

async function setup(authenticated = true, proxy = false) {
  const app = Fastify(); registerErrorHandler(app);
  const requireClientDevice = vi.fn(async () => {
    if (!authenticated) throw new ApiError(401, 'unauthorized');
    return { clientDevice: { id: 'device' } };
  });
  await registerProductionScheduleOrderRoute(app, {
    requireClientDevice,
    resolveLocationScopeContext: () => ({ deviceScopeKey: '第2工場 - kioskA', siteKey: '第2工場', canProxyOtherDevices: proxy }),
    resolveTargetLocation: ({ requestedTargetLocation, actorLocation }: { requestedTargetLocation?: string; actorLocation: string }) => requestedTargetLocation ?? actorLocation
  } as never);
  return { app, requireClientDevice };
}

describe('auto-rank order route', () => {
  it('authenticates and uses the existing terminal location resolution', async () => {
    const { app, requireClientDevice } = await setup();
    try {
      const response = await app.inject({ method: 'PUT', url, headers: { 'x-client-key': 'key' }, payload });
      expect(response.statusCode).toBe(200);
      expect(requireClientDevice).toHaveBeenCalledExactlyOnceWith('key');
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...payload,
        locationKey: env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED ? '第2工場' : '第2工場 - kioskA', actorLocationKey: '第2工場 - kioskA' });
      expect(response.json()).toEqual({ success: true, assignments: payload.assignments });
    } finally { await app.close(); }
  });

  it.each([
    { ...payload, assignments: [] },
    { ...payload, assignments: Array.from({ length: 11 }, (_, i) => ({ rowId: a, orderNumber: i + 1 })) },
    { ...payload, assignments: [{ rowId: a, orderNumber: 1 }, { rowId: a, orderNumber: 2 }] },
    { ...payload, assignments: [{ rowId: a, orderNumber: 1 }, { rowId: b, orderNumber: 1 }] },
    ...[0, 11, 1.5, null].map(orderNumber => ({ ...payload, assignments: [{ rowId: a, orderNumber }] })),
    { ...payload, assignments: [{ rowId: 'invalid', orderNumber: 1 }] },
    { ...payload, resourceCd: '' }
  ])('rejects invalid input with 400: %j', async (input) => {
    const { app } = await setup();
    try {
      expect((await app.inject({ method: 'PUT', url, payload: input })).statusCode).toBe(400);
      expect(mocks.save).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects unauthenticated requests before saving', async () => {
    const { app } = await setup(false);
    try {
      expect((await app.inject({ method: 'PUT', url, payload })).statusCode).toBe(401);
      expect(mocks.save).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('exposes the dedicated already-assigned conflict errorCode', async () => {
    mocks.save.mockRejectedValueOnce(new ApiError(409, 'assigned', undefined, 'AUTO_RANK_ROW_ALREADY_ASSIGNED'));
    const { app } = await setup();
    try {
      const response = await app.inject({ method: 'PUT', url, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'AUTO_RANK_ROW_ALREADY_ASSIGNED' });
    } finally { await app.close(); }
  });
  it.each([false, true])('retains the existing single-row API (v2=%s)', async (v2) => {
    env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED = v2;
    mocks.single.mockResolvedValueOnce({ success: true, orderNumber: 1 });
    const { app } = await setup();
    try {
      const response = await app.inject({ method: 'PUT', url: `/kiosk/production-schedule/${a}/order`, payload: { resourceCd: '305', orderNumber: 1 } });
      expect(response.statusCode).toBe(200);
      expect(mocks.single).toHaveBeenCalledExactlyOnceWith({ rowId: a, resourceCd: '305', orderNumber: 1,
        locationKey: v2 ? '第2工場' : '第2工場 - kioskA', actorLocationKey: '第2工場 - kioskA' });
      expect(mocks.save).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([false, true])('forbids another target location on regular terminals (v2=%s)', async (v2) => {
    env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED = v2;
    const { app } = await setup();
    try {
      expect((await app.inject({ method: 'PUT', url, payload: { ...payload, targetLocation: 'other' } })).statusCode).toBe(v2 ? 400 : 403);
      expect(mocks.save).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('allows a legacy proxy terminal to select targetLocation', async () => {
    env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED = false;
    const { app } = await setup(true, true);
    try {
      const response = await app.inject({ method: 'PUT', url, payload: { ...payload, targetLocation: '第2工場 - kioskB' } });
      expect(response.statusCode).toBe(200);
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...payload, targetLocation: '第2工場 - kioskB',
        locationKey: '第2工場 - kioskB', actorLocationKey: '第2工場 - kioskA' });
    } finally { await app.close(); }
  });

  it('requires a registered device target for v2 proxy terminals', async () => {
    env.KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED = true;
    const { app } = await setup(true, true);
    try {
      expect((await app.inject({ method: 'PUT', url, payload })).statusCode).toBe(400);
      expect(mocks.save).not.toHaveBeenCalled();
      const response = await app.inject({ method: 'PUT', url, payload: { ...payload, targetDeviceScopeKey: '第2工場 - kioskB' } });
      expect(response.statusCode).toBe(200);
      expect(mocks.registered).toHaveBeenCalledExactlyOnceWith('第2工場 - kioskB');
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...payload, targetDeviceScopeKey: '第2工場 - kioskB',
        locationKey: '第2工場', actorLocationKey: '第2工場 - kioskA' });
    } finally { await app.close(); }
  });

});
