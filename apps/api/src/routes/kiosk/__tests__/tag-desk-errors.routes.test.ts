import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { registerKioskTagDeskRoutes } from '../tag-desk.js';

vi.mock('../../../lib/kiosk-settings-pin.js', () => ({
  createKioskSettingsPinGuard: () => ({ authorize: async () => undefined })
}));

const id = '00000000-0000-4000-8000-000000000001';

describe('tag desk error responses', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    registerErrorHandler(app);
    await registerKioskTagDeskRoutes(app);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('returns the complete 404 body when employee update raises P2025', async () => {
    vi.spyOn(EmployeeService.prototype, 'update').mockRejectedValue(
      new PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' })
    );

    const response = await app.inject({
      method: 'PUT', url: `/kiosk/tag-desk/employees/${id}`, payload: { lastName: '山田' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: '社員が見つかりません',
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  it('returns the complete 409 body with DUPLICATE_CODE when employee update raises P2002', async () => {
    vi.spyOn(EmployeeService.prototype, 'update').mockRejectedValue(
      new PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'test' })
    );

    const response = await app.inject({
      method: 'PUT', url: `/kiosk/tag-desk/employees/${id}`, payload: { employeeCode: '0001' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: '同じコード・管理番号がすでに登録されています',
      errorCode: 'DUPLICATE_CODE',
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
  });
});
