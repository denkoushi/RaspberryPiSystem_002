import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, UserRole } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import type { EmployeeService } from '../../services/tools/employee.service.js';
import { registerEmployeeGetRoute } from '../tools/employees/get.js';
import { registerEmployeeListRoute } from '../tools/employees/list.js';

vi.mock('../../config/env.js', () => ({
  env: { JWT_ACCESS_SECRET: 'employee-visibility-test-secret' }
}));

const employee: Employee = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  employeeCode: '0001',
  displayName: 'Test Employee',
  lastName: null,
  firstName: null,
  nfcTagUid: 'TEST-EMPLOYEE-TAG',
  department: 'Test Department',
  section: null,
  positionName: null,
  contact: null,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

const jwtHeaders = (role: UserRole) => ({
  authorization: `Bearer ${jwt.sign(
    { sub: 'test-user', username: 'test-user', role },
    'employee-visibility-test-secret'
  )}`
});

describe('Employee read response tag visibility', () => {
  let app: ReturnType<typeof Fastify>;
  const findAll = vi.fn();
  const findById = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    findAll.mockResolvedValue([employee]);
    findById.mockResolvedValue(employee);
    const service = { findAll, findById } as unknown as EmployeeService;
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ApiError) return reply.code(error.statusCode).send({ message: error.message });
      return reply.send(error);
    });
    registerEmployeeListRoute(app, service);
    registerEmployeeGetRoute(app, service);
  });

  afterEach(async () => {
    await app.close();
  });

  describe.each([
    { name: 'list', url: '/employees', field: 'employees' },
    { name: 'detail', url: `/employees/${employee.id}`, field: 'employee' }
  ])('$name', ({ url, field }) => {
    it.each(['VIEWER', 'MANAGER', 'ADMIN'] as const)('returns role-appropriate tag visibility for %s', async (role) => {
      const response = await app.inject({ url, headers: jwtHeaders(role) });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const actual = field === 'employees' ? body.employees[0] : body.employee;
      expect(actual).toEqual({
        ...employee,
        createdAt: employee.createdAt.toISOString(),
        updatedAt: employee.updatedAt.toISOString(),
        nfcTagUid: role === 'VIEWER' ? null : employee.nfcTagUid
      });
      expect(employee.nfcTagUid).toBe('TEST-EMPLOYEE-TAG');
    });

    it('keeps an unassigned tag null', async () => {
      findAll.mockResolvedValue([{ ...employee, nfcTagUid: null }]);
      findById.mockResolvedValue({ ...employee, nfcTagUid: null });
      const response = await app.inject({ url, headers: jwtHeaders('VIEWER') });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(field === 'employees' ? body.employees[0].nfcTagUid : body.employee.nfcTagUid).toBeNull();
    });

    it('requires JWT authentication even with a client key', async () => {
      const response = await app.inject({ url, headers: { 'x-client-key': 'test-client-key' } });

      expect(response.statusCode).toBe(401);
      expect(findAll).not.toHaveBeenCalled();
      expect(findById).not.toHaveBeenCalled();
    });

    it('keeps VIEWER tags null when a client key is also supplied', async () => {
      const response = await app.inject({
        url,
        headers: { ...jwtHeaders('VIEWER'), 'x-client-key': 'test-client-key' }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(field === 'employees' ? body.employees[0].nfcTagUid : body.employee.nfcTagUid).toBeNull();
    });
  });

  it('applies visibility to filtered lists', async () => {
    const response = await app.inject({
      url: '/employees?search=Test&status=ACTIVE',
      headers: jwtHeaders('VIEWER')
    });

    expect(response.statusCode).toBe(200);
    expect(findAll).toHaveBeenCalledWith({ search: 'Test', status: 'ACTIVE' });
    expect(response.json().employees[0].nfcTagUid).toBeNull();
  });

  it('keeps empty lists empty', async () => {
    findAll.mockResolvedValue([]);
    const response = await app.inject({ url: '/employees', headers: jwtHeaders('VIEWER') });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ employees: [] });
  });

  it('keeps missing employees as 404', async () => {
    findById.mockRejectedValue(new ApiError(404, '従業員が見つかりません'));
    const response = await app.inject({ url: `/employees/${employee.id}`, headers: jwtHeaders('VIEWER') });

    expect(response.statusCode).toBe(404);
  });
});
