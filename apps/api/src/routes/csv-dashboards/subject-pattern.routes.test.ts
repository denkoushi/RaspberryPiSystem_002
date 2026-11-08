import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: 'MANAGER', create: vi.fn(), update: vi.fn(), findById: vi.fn() }));
vi.mock('../../lib/auth.js', () => ({ authorizeRoles: () => async (request: { user: unknown }) => { request.user = { role: mocks.role }; } }));
vi.mock('../../services/csv-dashboard/index.js', () => ({ CsvDashboardService: class { create = mocks.create; update = mocks.update; findById = mocks.findById; } }));
import { registerCsvDashboardRoutes } from './index.js';
const id = '340ec33a-23f9-432e-bac4-df392e366051';
const updateDefaults = { dedupKeyColumns: [], displayPeriodDays: 1, ingestMode: 'APPEND', templateType: 'TABLE' };
beforeEach(() => { vi.clearAllMocks(); mocks.role = 'MANAGER'; mocks.findById.mockResolvedValue({ gmailSubjectPattern: 'saved' }); mocks.create.mockResolvedValue({ id }); mocks.update.mockResolvedValue({ id }); });
async function inject(method: 'POST' | 'PUT', payload: unknown) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code((error as { statusCode?: number }).statusCode ?? 500).send({}));
  registerCsvDashboardRoutes(app);
  try { return await app.inject({ method, url: method === 'PUT' ? `/csv-dashboards/${id}` : '/csv-dashboards', payload }); } finally { await app.close(); }
}
const createBody = { name: 'board', columnDefinitions: [{ internalName: 'col', displayName: '列', csvHeaderCandidates: ['列'], dataType: 'string', order: 0 }], templateConfig: { rowsPerPage: 10, fontSize: 16, displayColumns: ['col'] } };
describe('subject pattern route permissions', () => {
  it('allows MANAGER to save other fields and unchanged patterns without rewriting the protected field', async () => {
    expect((await inject('PUT', { name: 'new name', gmailSubjectPattern: 'saved' })).statusCode).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(id, { ...updateDefaults, name: 'new name', gmailSubjectPattern: undefined });
  });
  it('rejects changed MANAGER patterns before writing', async () => {
    expect((await inject('PUT', { gmailSubjectPattern: 'changed' })).statusCode).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('allows MANAGER creation with an empty pattern, and rejects a nonempty one', async () => {
    expect((await inject('POST', { ...createBody, gmailSubjectPattern: null })).statusCode).toBe(201);
    mocks.create.mockClear();
    expect((await inject('POST', { ...createBody, gmailSubjectPattern: 'new' })).statusCode).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('allows ADMIN to change a pattern', async () => {
    mocks.role = 'ADMIN';
    expect((await inject('PUT', { gmailSubjectPattern: 'changed' })).statusCode).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(id, { ...updateDefaults, gmailSubjectPattern: 'changed' });
  });
});
