import Fastify from 'fastify';
import { ZodError } from 'zod';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ add: vi.fn(), replace: vi.fn(), auth: vi.fn() }));
vi.mock('../pallet-visualization-command.service.js', () => ({
  commandAddPalletItem: mocks.add, commandReplacePalletItem: mocks.replace,
  commandClearPallet: vi.fn(), commandDeletePalletItem: vi.fn(),
}));
vi.mock('../pallet-visualization-query.service.js', () => ({
  queryPalletVisualizationMachine: vi.fn(), queryPalletVisualizationMachines: vi.fn(),
  queryPalletVisualizationBoard: vi.fn(), queryPalletVisualizationHistory: vi.fn(),
}));
import { registerKioskPalletVisualizationRoutes } from '../../../routes/kiosk/pallet-visualization.js';

const key = '83665518-0506-47d7-8534-8995a04a1b25';
const body = { machineCd: 'MC', palletNo: 1, manufacturingOrderBarcodeRaw: 'ORDER' };
async function post(payload: object, replace = false) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    reply.status(error instanceof ZodError ? 400 : 500).send({ message: 'invalid' });
  });
  await registerKioskPalletVisualizationRoutes(app, { requireClientDevice: mocks.auth });
  try {
    return await app.inject({ method: 'POST', url: `/kiosk/pallet-visualization/items${replace ? `/${key}/replace` : ''}`, payload, headers: { 'x-client-key': 'client-key' } });
  } finally { await app.close(); }
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ clientDevice: { id: 'device' } });
  mocks.add.mockResolvedValue({ id: 'item' });
  mocks.replace.mockResolvedValue({ id: 'item' });
});
it.each([false, true])('accepts optional event identity and parses ISO readAt (replace=%s)', async replace => {
  const readAt = new Date().toISOString();
  expect((await post({ ...body, eventKey: key, readAt }, replace)).statusCode).toBe(200);
  expect((replace ? mocks.replace : mocks.add)).toHaveBeenCalledWith(expect.objectContaining({ eventKey: key, readAt: new Date(readAt), clientDeviceId: 'device' }));
  expect(mocks.auth).toHaveBeenCalledWith('client-key');
});
it.each([false, true])('accepts legacy request bodies (replace=%s)', async replace => {
  expect((await post(body, replace)).statusCode).toBe(200);
});
it.each([{ eventKey: 'barcode-agent-event' }, { readAt: 'invalid' }])('rejects malformed optional fields', async invalid => {
  expect((await post({ ...body, ...invalid })).statusCode).toBe(400);
  expect(mocks.add).not.toHaveBeenCalled();
});
