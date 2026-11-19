import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import type { ProcedureManualMailService } from '../../../services/assembly/procedure-manual-mail.service.js';
import { registerKioskConfigRoute } from '../../kiosk/config.js';
import { registerProcedureManualMailRoute } from '../procedure-manual-mail.js';

const config = vi.hoisted(() => ({ domain: undefined as string | undefined }));
vi.mock('../../../config/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../config/env.js')>();
  return { ...original, env: { ...original.env, get ASSEMBLY_PROCEDURE_MAIL_DOMAIN() { return config.domain; } } };
});
vi.mock('../../../services/kiosk/kiosk-config.service.js', () => ({
  resolveKioskConfigClientState: async (clientKey: string | undefined) => ({
    client: clientKey === 'kiosk-key' ? { name: '組立端末' } : null,
  }),
}));
vi.mock('../../../services/kiosk/kiosk-header-tab-order.service.js', () => ({
  getKioskHeaderTabOrderSettings: async () => ({ tabOrder: [] }),
}));

const path = '/assembly/procedure-manuals/mail';
const body = {
  documentId: '11ab4b1f-f93e-4bd1-9c9b-54c9750b370d',
  revisionId: '90a5d91d-3395-4f02-bfb1-c369bcafc437',
  nfcUid: 'employee-tag',
  localPart: 'worker',
};
const terminal = { id: 'terminal', name: '組立端末' };

async function setup() {
  const app = Fastify();
  registerErrorHandler(app);
  const send = vi.fn().mockResolvedValue({ deliveryId: 'delivery' });
  registerProcedureManualMailRoute(app, { send } as unknown as ProcedureManualMailService);
  await registerKioskConfigRoute(app, { normalizeClientKey: (value) => typeof value === 'string' ? value : undefined });
  const lookup = vi.spyOn(prisma.clientDevice, 'findUnique').mockResolvedValue(null);
  return { app, send, lookup };
}

afterEach(() => {
  config.domain = undefined;
  vi.restoreAllMocks();
});

describe('procedure manual mail routes', () => {
  it('requires a known client key even when Authorization is supplied', async () => {
    const { app, send } = await setup();
    try {
      const missing = await app.inject({ method: 'POST', url: path, headers: { authorization: 'Bearer sample' }, payload: body });
      expect(missing.json()).toMatchObject({ errorCode: 'CLIENT_KEY_REQUIRED' });
      const invalid = await app.inject({ method: 'POST', url: path, headers: { 'x-client-key': 'unknown' }, payload: body });
      expect(invalid.json()).toMatchObject({ errorCode: 'INVALID_CLIENT_KEY' });
      expect(send).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('uses the stored client name and rejects extra identity or recipient fields', async () => {
    const { app, send, lookup } = await setup();
    lookup.mockResolvedValue(terminal as Awaited<ReturnType<typeof prisma.clientDevice.findUnique>>);
    try {
      const headers = { 'x-client-key': 'kiosk-key' };
      const invalid = await app.inject({ method: 'POST', url: path, headers, payload: { ...body, employeeCode: '00042', to: 'someone@example.net' } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
      expect(send).not.toHaveBeenCalled();
      const response = await app.inject({ method: 'POST', url: path, headers, payload: body });
      expect(response.json()).toEqual({ deliveryId: 'delivery' });
      expect(send).toHaveBeenCalledWith(body, terminal);
    } finally {
      await app.close();
    }
  });

  it('exposes the mail configuration on the existing authenticated kiosk config response', async () => {
    const { app } = await setup();
    try {
      const request = { url: '/kiosk/config', headers: { 'x-client-key': 'kiosk-key' } };
      expect((await app.inject(request)).json().assemblyProcedureMail).toEqual({ enabled: false, domain: null });
      config.domain = 'example.com';
      expect((await app.inject(request)).json().assemblyProcedureMail).toEqual({ enabled: true, domain: 'example.com' });
      expect((await app.inject('/kiosk/config')).json().assemblyProcedureMail).toEqual({ enabled: false, domain: null });
    } finally {
      await app.close();
    }
  });
});
