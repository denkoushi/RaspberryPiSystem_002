import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { AssemblyCheckSheetService } from '../../../services/assembly/check-sheet/check-sheet.service.js';
import { parseCheckSheetXlsx } from '../../../services/assembly/check-sheet/check-sheet-xlsx-parser.js';
import { normalizeCheckSheet } from '../../../services/assembly/check-sheet/check-sheet-normalizer.js';
import { makeCheckSheetWorkbook } from '../../../services/assembly/check-sheet/__tests__/check-sheet.fixture.js';
import { requireClientDevice } from '../../kiosk/shared.js';
import { registerAssemblyCheckSheetRoutes } from '../check-sheets.js';

// Do not load local .env files or connect to a shared database in contract tests.
vi.mock('../../../config/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_ACCESS_SECRET: 'check-sheet-test-only-secret' } }));
vi.mock('../../kiosk/shared.js', () => ({ requireClientDevice: vi.fn(async (key: unknown) => {
  if (key !== 'kiosk') throw new ApiError(401, '端末認証が必要です');
  return { clientDevice: { id: 'synthetic-device', name: '組立1-01' } };
}) }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../services/file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000001';
const headers = (role: string) => ({
  authorization: `Bearer ${jwt.sign({ sub: id, username: 'test', role }, 'check-sheet-test-only-secret')}`
});
function upload(file: Buffer, filename = 'synthetic.xlsx') {
  const boundary = 'check-sheet-test';
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      file, Buffer.from(`\r\n--${boundary}--\r\n`)
    ]),
    headers: { ...headers('ADMIN'), 'content-type': `multipart/form-data; boundary=${boundary}` }
  };
}

describe('check-sheet routes', () => {
  let app: ReturnType<typeof Fastify>;
  let service: AssemblyCheckSheetService;
  beforeEach(async () => {
    service = new AssemblyCheckSheetService();
    app = Fastify();
    registerErrorHandler(app);
    await app.register(multipart);
    await app.register(async (api: FastifyInstance) => registerAssemblyCheckSheetRoutes(api, { allowView: authorizeRoles('ADMIN', 'MANAGER', 'VIEWER'), allowWriteKiosk: async (request, reply) => {
      if (request.headers.authorization) return authorizeRoles('ADMIN', 'MANAGER')(request, reply);
      await requireClientDevice(request.headers['x-client-key']);
    } }, service), { prefix: '/api' });
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

  it('imports an XLSX with a sheet override and returns a proposal', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(buffer));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    const importer = vi.spyOn(service, 'importWorkbook').mockResolvedValue({ importId: id, sheetNames: ['合成チェックシート'], proposal });
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/imports?sheetName=' + encodeURIComponent('合成チェックシート'), ...upload(buffer) });
    expect(response.statusCode).toBe(200);
    expect(response.json().proposal.items).toHaveLength(9);
    expect(importer).toHaveBeenCalledWith(buffer, 'synthetic.xlsx', '合成チェックシート');
  });

  it.each(['VIEWER'])('rejects both write routes for %s', async (role) => {
    const importer = vi.spyOn(service, 'importWorkbook');
    const saver = vi.spyOn(service, 'saveRevision');
    for (const path of ['imports', 'revisions']) {
      const response = await app.inject({ method: 'POST', url: `/api/assembly/check-sheets/${path}`, headers: headers(role), payload: {} });
      expect(response.statusCode).toBe(403);
    }
    expect(importer).not.toHaveBeenCalled();
    expect(saver).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated writes and invalid kiosk keys', async () => {
    for (const key of [undefined, 'invalid']) {
      for (const path of ['imports', 'revisions']) {
        const response = await app.inject({ method: 'POST', url: `/api/assembly/check-sheets/${path}`, headers: key ? { 'x-client-key': key } : {}, payload: {} });
        expect(response.statusCode).toBe(401);
      }
    }
  });

  it.each(['ADMIN', 'MANAGER'])('saves edited metadata with the authenticated %s user and requested root', async (role) => {
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(await makeCheckSheetWorkbook()));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    proposal.modelCode = 'EDITED';
    const saver = vi.spyOn(service, 'saveRevision').mockResolvedValue({ id, ...proposal } as Awaited<ReturnType<AssemblyCheckSheetService['saveRevision']>>);
    const payload = { importId: id, revisionRootId: id, proposal };
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/revisions', headers: { ...headers(role), 'x-client-key': 'kiosk' }, payload });
    expect(response.statusCode).toBe(200);
    expect(saver).toHaveBeenCalledWith(payload, id);
  });

  it('imports and saves with only a kiosk key, recording the device actor', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(buffer));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    const importer = vi.spyOn(service, 'importWorkbook').mockResolvedValue({ importId: id, sheetNames: ['合成チェックシート'], proposal });
    const saver = vi.spyOn(service, 'saveRevision').mockResolvedValue({ id, ...proposal } as Awaited<ReturnType<AssemblyCheckSheetService['saveRevision']>>);
    const multipart = upload(buffer);
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/imports', ...multipart,
      headers: { 'content-type': multipart.headers['content-type'], 'x-client-key': 'kiosk' } });
    expect(response.statusCode).toBe(200);
    expect(importer).toHaveBeenCalledWith(buffer, 'synthetic.xlsx', undefined);
    const payload = { importId: response.json().importId, proposal: response.json().proposal };
    const saved = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/revisions', headers: { 'x-client-key': 'kiosk' }, payload });
    expect(saved.statusCode).toBe(200);
    expect(saver).toHaveBeenCalledWith(payload, 'client:synthetic-device');
  });

  it('rejects saving when the authenticated device can no longer be resolved', async () => {
    vi.spyOn(await import('../shared.js'), 'tryGetClientDevice').mockResolvedValueOnce(null);
    const saver = vi.spyOn(service, 'saveRevision');
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/revisions', headers: { 'x-client-key': 'kiosk' }, payload: {} });
    expect(response.statusCode).toBe(401);
    expect(saver).not.toHaveBeenCalled();
  });

  it.each([{}, { 制御設計担当: [] }, { constructor: [] }])('rejects empty or missing department members: %j', async (members) => {
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(await makeCheckSheetWorkbook()));
    proposal.departmentRoleMembers = members;
    proposal.items[0].roleKeys = ['constructor'];
    const saver = vi.spyOn(service, 'saveRevision');
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/revisions', headers: headers('ADMIN'), payload: { importId: id, proposal } });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['proposal', 'departmentRoleMembers', '制御設計担当'], message: expect.stringContaining('制御設計担当') }),
      expect.objectContaining({ path: ['proposal', 'departmentRoleMembers', 'constructor'] })
    ]));
    expect(saver).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads before saving', async () => {
    const saver = vi.spyOn(service, 'saveRevision');
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/revisions', headers: headers('ADMIN'), payload: { importId: id, proposal: {} } });
    expect(response.statusCode).toBe(400);
    expect(saver).not.toHaveBeenCalled();
  });

  it('rejects unsupported, empty and oversized uploads', async () => {
    const importer = vi.spyOn(service, 'importWorkbook');
    for (const [buffer, name, status] of [
      [Buffer.from('csv'), 'file.csv', 400], [Buffer.alloc(0), 'empty.xlsx', 400],
      [Buffer.alloc(12 * 1024 * 1024 + 1), 'large.xlsx', 413]
    ] as const) {
      const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/imports', ...upload(buffer, name) });
      expect(response.statusCode).toBe(status);
    }
    expect(importer).not.toHaveBeenCalled();
  });

  it('lists heads or root history and returns a full revision', async () => {
    const list = vi.spyOn(service, 'listRevisions').mockResolvedValue([]);
    const detail = vi.spyOn(service, 'getRevision').mockRejectedValue(new ApiError(404, '見つかりません'));
    expect((await app.inject({ method: 'GET', url: '/api/assembly/check-sheets/revisions', headers: headers('VIEWER') })).statusCode).toBe(200);
    expect(list).toHaveBeenLastCalledWith(undefined);
    expect((await app.inject({ method: 'GET', url: `/api/assembly/check-sheets/revisions?rootId=${id}`, headers: headers('VIEWER') })).statusCode).toBe(200);
    expect(list).toHaveBeenLastCalledWith(id);
    expect((await app.inject({ method: 'GET', url: `/api/assembly/check-sheets/revisions/${id}`, headers: headers('VIEWER') })).statusCode).toBe(404);
    expect(detail).toHaveBeenCalledWith(id);
    expect((await app.inject({ method: 'GET', url: '/api/assembly/check-sheets/revisions' })).statusCode).toBe(401);
  });

  it('propagates import validation and save conflicts', async () => {
    vi.spyOn(service, 'importWorkbook').mockRejectedValue(new ApiError(400, '形式が不正'));
    const response = await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/imports', ...upload(Buffer.from('invalid')) });
    expect(response.statusCode).toBe(400);
    vi.spyOn(service, 'saveRevision').mockRejectedValue(new ApiError(404, '取込元が見つかりません'));
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(await makeCheckSheetWorkbook()));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    expect((await app.inject({ method: 'POST', url: '/api/assembly/check-sheets/revisions', headers: headers('ADMIN'), payload: { importId: id, proposal } })).statusCode).toBe(404);
  });
});
