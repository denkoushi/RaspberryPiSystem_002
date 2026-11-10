import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/errors.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerCsvImportConfigRoutes } from '../csv-import-configs.js';

const mocks = vi.hoisted(() => ({
  service: { list: vi.fn(), get: vi.fn(), upsert: vi.fn() },
  authorizedRoles: [] as string[][],
}));

vi.mock('../../lib/auth.js', () => ({
  authorizeRoles: (...roles: string[]) => {
    mocks.authorizedRoles.push(roles);
    return async (request: { headers: Record<string, string | string[] | undefined> }) => {
      const role = request.headers['x-test-role'];
      if (typeof role !== 'string' || !roles.includes(role)) {
        throw new ApiError(403, '操作権限がありません', undefined, 'AUTH_INSUFFICIENT_PERMISSIONS');
      }
    };
  },
}));

vi.mock('../../services/imports/csv-import-config.service.js', () => ({
  CsvImportConfigService: vi.fn(function CsvImportConfigService() {
    return mocks.service;
  }),
}));

const validColumn = { internalName: 'itemCode', displayName: '管理番号', csvHeaderCandidates: ['管理番号'], dataType: 'string', order: 0 };

describe('csv-import-configs routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    mocks.authorizedRoles.length = 0;
    mocks.service.list.mockResolvedValue([{ importType: 'items' }]);
    mocks.service.get.mockResolvedValue({ importType: 'items' });
    mocks.service.upsert.mockImplementation(async (importType: string, body: unknown) => ({ importType, ...(body as object) }));
    app = Fastify();
    registerErrorHandler(app);
    registerCsvImportConfigRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('guards routes with ADMIN only', () => {
    expect(mocks.authorizedRoles).toEqual([['ADMIN']]);
  });

  it.each([
    ['GET', '/csv-import-configs'],
    ['GET', '/csv-import-configs/items'],
    ['PUT', '/csv-import-configs/items'],
  ] as const)('rejects %s %s for non-admin roles with 403 before calling the service', async (method, url) => {
    const res = await app.inject({ method, url, headers: { 'x-test-role': 'MANAGER' }, payload: method === 'PUT' ? { columnDefinitions: [validColumn] } : undefined });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ errorCode: 'AUTH_INSUFFICIENT_PERMISSIONS' });
    expect(mocks.service.list).not.toHaveBeenCalled();
    expect(mocks.service.get).not.toHaveBeenCalled();
    expect(mocks.service.upsert).not.toHaveBeenCalled();
  });

  it('lists configs for admins', async () => {
    const res = await app.inject({ method: 'GET', url: '/csv-import-configs', headers: { 'x-test-role': 'ADMIN' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configs: [{ importType: 'items' }] });
  });

  it('rejects unsupported import types such as csvDashboards with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/csv-import-configs/csvDashboards', headers: { 'x-test-role': 'ADMIN' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    expect(mocks.service.get).not.toHaveBeenCalled();
  });

  it('applies defaults when upserting with only columnDefinitions', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/csv-import-configs/riggingGears', headers: { 'x-test-role': 'ADMIN' }, payload: { columnDefinitions: [validColumn] },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.service.upsert).toHaveBeenCalledWith('riggingGears', {
      enabled: true,
      allowedManualImport: true,
      allowedScheduledImport: true,
      importStrategy: 'UPSERT',
      columnDefinitions: [validColumn],
    });
  });

  it('keeps explicit false flags and REPLACE strategy', async () => {
    await app.inject({
      method: 'PUT', url: '/csv-import-configs/items', headers: { 'x-test-role': 'ADMIN' },
      payload: { enabled: false, allowedManualImport: false, allowedScheduledImport: false, importStrategy: 'REPLACE', columnDefinitions: [validColumn] },
    });
    expect(mocks.service.upsert).toHaveBeenCalledWith('items', expect.objectContaining({
      enabled: false, allowedManualImport: false, allowedScheduledImport: false, importStrategy: 'REPLACE',
    }));
  });

  it.each([
    ['empty columnDefinitions', { columnDefinitions: [] }],
    ['missing columnDefinitions', {}],
    ['blank header candidate', { columnDefinitions: [{ ...validColumn, csvHeaderCandidates: [''] }] }],
    ['negative order', { columnDefinitions: [{ ...validColumn, order: -1 }] }],
    ['fractional order', { columnDefinitions: [{ ...validColumn, order: 1.5 }] }],
    ['unknown dataType', { columnDefinitions: [{ ...validColumn, dataType: 'datetime' }] }],
    ['unknown importStrategy', { importStrategy: 'MERGE', columnDefinitions: [validColumn] }],
  ])('rejects %s with 400 without writing', async (_label, payload) => {
    const res = await app.inject({ method: 'PUT', url: '/csv-import-configs/items', headers: { 'x-test-role': 'ADMIN' }, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errorCode: 'VALIDATION_ERROR' });
    expect(mocks.service.upsert).not.toHaveBeenCalled();
  });

  it('delegates the empty csvHeaderCandidates check to the service layer', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/csv-import-configs/items', headers: { 'x-test-role': 'ADMIN' },
      payload: { columnDefinitions: [{ ...validColumn, csvHeaderCandidates: [] }] },
    });
    // The route schema has no array min length; CsvImportConfigService.upsert rejects it instead.
    expect(res.statusCode).toBe(200);
    expect(mocks.service.upsert).toHaveBeenCalledTimes(1);
  });
});
