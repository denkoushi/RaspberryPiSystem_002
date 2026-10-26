import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { registerSelfInspectionNonconformityRoutes } from '../self-inspection-nonconformities.js';

function createTestApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    void reply.code(error instanceof ZodError ? 400 : 500).send();
  });
  return app;
}

describe('self-inspection nonconformity kiosk route', () => {
  it('normalizes the canonical part and returns only the read DTO fields', async () => {
    const readCurrentByPartNumber = vi.fn().mockResolvedValue([
      {
        id: 'case-1',
        discoveredOn: '2026-09-02',
        originDepartmentName: '製造一課',
        remarks: '備考',
        nonconformityContent: '不適合',
        dispositionContent: '処置',
        correctiveContent1: '是正1',
        correctiveContent2: '是正2',
        partName: '部品A',
        machineName: '機種A',
        manufacturingOrderNo: 'ORDER-1',
        fseiban: 'SEIBAN-1'
      }
    ]);
    const app = createTestApp();
    const readPreHandler = vi.fn(async () => undefined);
    await registerSelfInspectionNonconformityRoutes(app, {
      read: { readCurrentByPartNumber },
      readPreHandler
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kiosk/self-inspection/nonconformities?partNumber=%20%EF%BD%90%EF%BD%81%EF%BD%92%EF%BD%94%EF%BC%8D%EF%BC%91%20'
      });
      expect(response.statusCode).toBe(200);
      expect(readPreHandler).toHaveBeenCalledTimes(1);
      expect(readCurrentByPartNumber).toHaveBeenCalledWith('PART-1');
      expect(response.json()).toEqual({
        count: 1,
        items: [{
          id: 'case-1',
          discoveredOn: '2026-09-02',
          originDepartmentName: '製造一課',
          remarks: '備考',
          nonconformityContent: '不適合',
          dispositionContent: '処置',
          correctiveContent1: '是正1',
          correctiveContent2: '是正2',
          partName: '部品A',
          machineName: '機種A'
        }]
      });
    } finally {
      await app.close();
    }
  });

  it('rejects a blank part number before the current read service', async () => {
    const readCurrentByPartNumber = vi.fn();
    const app = createTestApp();
    await registerSelfInspectionNonconformityRoutes(app, {
      read: { readCurrentByPartNumber },
      readPreHandler: async () => undefined
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kiosk/self-inspection/nonconformities?partNumber=%20%20'
      });
      expect(response.statusCode).toBe(400);
      expect(readCurrentByPartNumber).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not invoke the read service when the auth preHandler denies access', async () => {
    const readCurrentByPartNumber = vi.fn();
    const readPreHandler = vi.fn(async (_request: FastifyRequest, reply: FastifyReply) => {
      await reply.code(401).send({ error: 'unauthorized' });
    });
    const app = createTestApp();
    await registerSelfInspectionNonconformityRoutes(app, {
      read: { readCurrentByPartNumber },
      readPreHandler
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/kiosk/self-inspection/nonconformities?partNumber=PART-1'
      });
      expect(response.statusCode).toBe(401);
      expect(readPreHandler).toHaveBeenCalledTimes(1);
      expect(readCurrentByPartNumber).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
