import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApiError } from '../../lib/errors.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../services/mobile-placement/haizen-placement.service.js', () => ({ applyHaizenScan: vi.fn() }));
vi.mock('../../services/production-schedule/grinding-planning-board/write-scan-arrival.js', () => ({ applyGrindingPlanningBoardScanArrival: vi.fn() }));
vi.mock('../../services/mobile-placement/edge-scan.service.js', () => ({ registerEdgeScan: vi.fn() }));
import { requireClientDevice } from '../kiosk/shared.js';
import { applyHaizenScan } from '../../services/mobile-placement/haizen-placement.service.js';
import { applyGrindingPlanningBoardScanArrival } from '../../services/production-schedule/grinding-planning-board/write-scan-arrival.js';
import { registerEdgeScan } from '../../services/mobile-placement/edge-scan.service.js';
import { registerMobilePlacementRoutes } from '../mobile-placement/index.js';

const appForTest = async () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof ZodError ? 400 : error instanceof ApiError ? error.statusCode : 500).send({ code: (error as ApiError).code });
  });
  await registerMobilePlacementRoutes(app);
  return app;
};
const payload = { manufacturingOrderBarcodeRaw: '12345', distributionNumber: 2, rawBarcode: 'raw' };
const device = { id: 'scanner', name: 'scanner', apiKey: 'key', siteKey: 'factory', haizenPresetShelfCodeRaw: null };
const scan = (app: Awaited<ReturnType<typeof appForTest>>, body = payload) => app.inject({ method: 'POST', url: '/mobile-placement/haizen-scans', headers: { 'x-client-key': 'key' }, payload: body });
afterEach(() => vi.resetAllMocks());

describe('haizen scan mode routing', () => {
  it('preserves the shelf input and response', async () => {
    const app = await appForTest();
    vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { ...device, haizenScanMode: 'shelf' } } as never);
    const result = { eventId: 'event', resolutionStatus: 'RESOLVED', current: { shelfCodeRaw: '西-北-01' } };
    vi.mocked(applyHaizenScan).mockResolvedValue(result as never);
    try {
      const response = await scan(app);
      expect(response.statusCode).toBe(200); expect(response.json()).toEqual(result);
      expect(applyHaizenScan).toHaveBeenCalledExactlyOnceWith({ clientDeviceId: 'scanner', ...payload });
      expect(applyGrindingPlanningBoardScanArrival).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(['RESOLVED', 'UNRESOLVED'] as const)('routes grinding mode without a preset shelf (%s)', async resolutionStatus => {
    const app = await appForTest();
    const clientDevice = { ...device, haizenScanMode: 'grinding_arrival' };
    vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice } as never);
    const result = { resolutionStatus, arrival: { productNo: '12345' } };
    vi.mocked(applyGrindingPlanningBoardScanArrival).mockResolvedValue(result as never);
    try {
      const response = await scan(app);
      expect(response.statusCode).toBe(200); expect(response.json()).toEqual(result);
      expect(applyGrindingPlanningBoardScanArrival).toHaveBeenCalledExactlyOnceWith({ clientDevice, manufacturingOrderBarcodeRaw: '12345' });
      expect(applyHaizenScan).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('preserves the shelf preset error', async () => {
    const app = await appForTest();
    vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { ...device, haizenScanMode: 'shelf' } } as never);
    vi.mocked(applyHaizenScan).mockRejectedValue(new ApiError(400, 'shelf required', undefined, 'HAIZEN_PRESET_SHELF_REQUIRED'));
    try {
      const response = await scan(app);
      expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ code: 'HAIZEN_PRESET_SHELF_REQUIRED' });
    } finally { await app.close(); }
  });

  it('rejects unauthenticated scans before either writer', async () => {
    const app = await appForTest();
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'Unauthorized'));
    try {
      expect((await scan(app)).statusCode).toBe(401);
      expect(applyHaizenScan).not.toHaveBeenCalled(); expect(applyGrindingPlanningBoardScanArrival).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

describe('edge scan mode routing', () => {
  const edgeBody = { clientRecordId: '6f1c2b0e-4d3a-4f5b-9c1d-2e3f4a5b6c7d', scannedAt: new Date().toISOString(), orderNumber: '0005554987', branchNo: 0 };
  const edgeScan = (app: Awaited<ReturnType<typeof appForTest>>) => app.inject({ method: 'POST', url: '/mobile-placement/edge-scans', headers: { 'x-client-key': 'key' }, payload: edgeBody });

  it('routes grinding mode to the arrival writer', async () => {
    const app = await appForTest();
    const clientDevice = { ...device, haizenEdgeEnabled: true, haizenScanMode: 'grinding_arrival' };
    vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice } as never);
    const result = { resolutionStatus: 'RESOLVED', arrival: { productNo: '0005554987' } };
    vi.mocked(applyGrindingPlanningBoardScanArrival).mockResolvedValue(result as never);
    try {
      const response = await edgeScan(app);
      expect(response.statusCode).toBe(200); expect(response.json()).toEqual(result);
      expect(applyGrindingPlanningBoardScanArrival).toHaveBeenCalledExactlyOnceWith({ clientDevice, manufacturingOrderBarcodeRaw: '0005554987' });
      expect(registerEdgeScan).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([
    ['shelf mode', { haizenEdgeEnabled: true, haizenScanMode: 'shelf' }],
    ['a disabled scanner', { haizenEdgeEnabled: false, haizenScanMode: 'grinding_arrival' }]
  ])('keeps shelf placement for %s', async (_label, mode) => {
    const app = await appForTest();
    vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { ...device, ...mode } } as never);
    vi.mocked(registerEdgeScan).mockResolvedValue({ status: 'created', branchNo: 0, shelfCodeRaw: '研削場 南' } as never);
    try {
      expect((await edgeScan(app)).statusCode).toBe(200);
      expect(registerEdgeScan).toHaveBeenCalledExactlyOnceWith({ ...edgeBody, clientDeviceId: 'scanner' });
      expect(applyGrindingPlanningBoardScanArrival).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
