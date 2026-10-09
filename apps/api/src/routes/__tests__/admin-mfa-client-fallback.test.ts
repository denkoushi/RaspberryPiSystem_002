import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { ADMIN_MFA_REQUIRED: true, JWT_ACCESS_SECRET: 'test-mfa-fallback-secret' },
  clientKey: vi.fn(), findAll: vi.fn(), getDashboard: vi.fn(), listModels: vi.fn(), confirmations: vi.fn()
}));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
// These routes' schemas import generated enums even though persistence is mocked.
vi.mock('@prisma/client', () => {
  const status = { AVAILABLE: 'AVAILABLE', IN_USE: 'IN_USE', MAINTENANCE: 'MAINTENANCE', RETIRED: 'RETIRED' };
  return { default: {
    RiggingStatus: status, MeasuringInstrumentStatus: status, ItemStatus: status,
    InspectionResult: { PASS: 'PASS', FAIL: 'FAIL' }
  } };
});
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  assertKioskApiClientKeyValid: mocks.clientKey,
  requireKioskClientDevice: async (key: unknown) => { await mocks.clientKey(key); return { clientDevice: { id: 'device' } }; }
}));
vi.mock('../../services/clients/client-device-resolution.service.js', () => ({ resolveClientDeviceId: vi.fn() }));
vi.mock('../../services/rigging/index.js', () => ({
  RiggingGearService: class { findAll = mocks.findAll; },
  RiggingGearTagService: class {}, RiggingInspectionRecordService: class {}, RiggingLoanService: class {},
  RiggingLoanAnalyticsService: class { static createDefault() { return { getDashboard: mocks.getDashboard }; } }
}));
vi.mock('../../services/measuring-instruments/index.js', () => ({
  MeasuringInstrumentService: class { findAll = mocks.findAll; },
  MeasuringInstrumentGenreService: class {}, InspectionItemService: class {},
  MeasuringInstrumentTagService: class {}, InspectionRecordService: class {},
  MeasuringInstrumentLoanAnalyticsService: class { static createDefault() { return { getDashboard: mocks.getDashboard }; } }
}));
vi.mock('../../services/measuring-instruments/loan.service.js', () => ({ MeasuringInstrumentLoanService: class {} }));
vi.mock('../../lib/measuring-instrument-genre-image-storage.js', () => ({ MeasuringInstrumentGenreImageStorage: class {} }));
vi.mock('../../services/torque-wrenches/index.js', () => ({
  TorqueWrenchMasterService: class { listModels = mocks.listModels; },
  AssemblyTorqueTraceabilityService: class { listCurrentConfirmations = mocks.confirmations; },
  TorqueWrenchConnectionLeaseService: class {}
}));
vi.mock('../../services/tools/item-loan-analytics.service.js', () => ({
  ItemLoanAnalyticsService: class { static createDefault() { return { getDashboard: mocks.getDashboard }; } }
}));

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerMeasuringInstrumentRoutes } from '../measuring-instruments/index.js';
import { registerRiggingRoutes } from '../rigging/index.js';
import { registerItemLoanAnalyticsRoute } from '../tools/items/loan-analytics.js';
import { registerTorqueWrenchRoutes } from '../torque-wrenches/index.js';

let app: ReturnType<typeof Fastify>;
const sessionId = '00000000-0000-4000-8000-000000000001';
const readPaths = [
  '/api/measuring-instruments', '/api/rigging-gears', '/api/items/loan-analytics',
  '/api/torque-wrench-models', `/api/assembly/work-sessions/${sessionId}/torque-wrench-confirmations/current`
];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.env.ADMIN_MFA_REQUIRED = true;
  mocks.clientKey.mockResolvedValue(undefined);
  mocks.findAll.mockResolvedValue([]);
  mocks.getDashboard.mockResolvedValue({});
  mocks.listModels.mockResolvedValue([]);
  mocks.confirmations.mockResolvedValue([]);
  app = Fastify();
  registerErrorHandler(app);
  await app.register(async (api) => {
    await registerMeasuringInstrumentRoutes(api);
    await registerRiggingRoutes(api);
    registerItemLoanAnalyticsRoute(api);
    await registerTorqueWrenchRoutes(api);
  }, { prefix: '/api' });
});
afterEach(async () => { await app.close(); });

function userHeaders(role = 'ADMIN') {
  const token = jwt.sign({ sub: 'user', username: 'test', role }, mocks.env.JWT_ACCESS_SECRET);
  return { authorization: `Bearer ${token}`, 'x-client-key': 'valid-device-key' };
}

describe('MFA rejection in JWT/client-key fallback routes', () => {
  it.each([
    ...readPaths.map(url => ({ method: 'GET' as const, url })),
    { method: 'POST' as const, url: '/api/rigging-inspection-records' },
    { method: 'POST' as const, url: `/api/measuring-instruments/${sessionId}/inspection-records` }
  ])('preserves MFA_SETUP_REQUIRED for $method $url even with a valid device key', async (request) => {
    const response = await app.inject({ ...request, headers: userHeaders(), payload: request.method === 'POST' ? {} : undefined });
    expect(response.statusCode).toBe(403);
    expect(response.json().errorCode).toBe('MFA_SETUP_REQUIRED');
    expect(mocks.clientKey).not.toHaveBeenCalled();
  });

  it.each(readPaths)('preserves client-key-only access for %s', async (url) => {
    const response = await app.inject({ url, headers: { 'x-client-key': 'valid-device-key' } });
    expect(response.statusCode).toBe(200);
    expect(mocks.clientKey).toHaveBeenCalledWith('valid-device-key');
  });

  it.each(readPaths)('preserves unconfigured ADMIN access when off for %s', async (url) => {
    mocks.env.ADMIN_MFA_REQUIRED = false;
    const response = await app.inject({ url, headers: userHeaders() });
    expect(response.statusCode).toBe(200);
    expect(mocks.clientKey).not.toHaveBeenCalled();
  });

  it.each(readPaths)('preserves VIEWER/device-key access for %s', async (url) => {
    const response = await app.inject({ url, headers: userHeaders('VIEWER') });
    expect(response.statusCode).toBe(200);
  });
});
