import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { LoanService } from '../../../services/tools/loan.service.js';
import { registerEmployeeDeleteRoute } from '../employees/delete.js';
import { registerItemDeleteRoute } from '../items/delete.js';

vi.mock('../../../lib/auth.js', () => ({
  authorizeRoles: () => async () => undefined
}));

const id = '00000000-0000-4000-8000-000000000001';

describe('tool delete error responses', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify();
    registerErrorHandler(app);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('returns the complete 404 body when item deletion raises P2025', async () => {
    vi.spyOn(LoanService.prototype, 'countActiveLoansForItem').mockResolvedValue(0);
    vi.spyOn(ItemService.prototype, 'delete').mockRejectedValue(
      new PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' })
    );
    registerItemDeleteRoute(app, new ItemService());

    const response = await app.inject({ method: 'DELETE', url: `/items/${id}` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: 'アイテムが見つかりません',
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  it('returns the complete 404 body when employee deletion raises P2025', async () => {
    vi.spyOn(LoanService.prototype, 'countActiveLoansForEmployee').mockResolvedValue(0);
    vi.spyOn(EmployeeService.prototype, 'delete').mockRejectedValue(
      new PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'test' })
    );
    registerEmployeeDeleteRoute(app, new EmployeeService());

    const response = await app.inject({ method: 'DELETE', url: `/employees/${id}` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: '従業員が見つかりません',
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
  });
});
