import { prisma } from '../../../lib/prisma.js';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureManualService } from '../../../services/assembly/procedure-manual.service.js';
import { serializeProcedureSequence } from '../index.js';
import { registerAssemblyProcedureDocumentRoutes, type AssemblyProcedureDocumentRouteOptions } from '../procedure-documents.js';
import { registerProcedureManualRoutes } from '../procedure-manuals.js';

beforeEach(() => { vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue(null); });

const documentId = '00000000-0000-4000-8000-000000000001';
const path = '/assembly/procedure-manuals/models/DFD1/processes/assembly';
describe('procedure-manual routes', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); vi.restoreAllMocks(); });

  function harness(writeDenied = false) {
    const service = {
      listProcesses: vi.fn().mockResolvedValue([{ id: 'assembly' }]),
      listModels: vi.fn().mockResolvedValue([{ modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1' }]),
      getAssignments: vi.fn().mockResolvedValue({ assignments: [{ unavailableReason: 'no_published_revision' }], sequence: {
        mode: 'configured', source: 'primary_fallback', machineName: 'ｄｆｄ１', machineNameKey: 'DFD1',
        documents: [], steps: [], stepSource: 'document_expansion', fallbackProcedureDocument: null
      } }),
      replaceAssignments: vi.fn().mockResolvedValue(undefined)
    };
    const view = vi.fn(async () => undefined);
    app = Fastify();
    registerErrorHandler(app);
    registerProcedureManualRoutes(app, {
      allowView: view,
      allowWriteKiosk: async () => { if (writeDenied) throw new ApiError(403, '権限がありません'); },
      service: service as unknown as ProcedureManualService, serializeSequence: serializeProcedureSequence
    });
    return { service, view };
  }

  it('registers all three viewing routes and serializes the document expansion sequence', async () => {
    const { service, view } = harness();
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/processes' })).json()).toEqual({ processes: [{ id: 'assembly' }] });
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/models' })).json().models[0].modelCodeKey).toBe('DFD1');
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.json().sequence).toMatchObject({ stepSource: 'document_expansion', reason: null });
    expect(response.json().assignments[0].unavailableReason).toBe('no_published_revision');
    expect(service.getAssignments).toHaveBeenCalledWith('DFD1', 'assembly');
    expect(view).toHaveBeenCalledTimes(3);
  });

  it('saves the complete list and rejects a model key mismatch or invalid document choice', async () => {
    const { service } = harness();
    const assignments = [{ assemblyProcedureDocumentId: documentId, sortOrder: 0, label: '組立' }];
    expect((await app.inject({ method: 'PUT', url: path, payload: { modelCode: 'ｄｆｄ１', assignments } })).statusCode).toBe(200);
    expect(service.replaceAssignments).toHaveBeenCalledWith('ｄｆｄ１', 'assembly', assignments);
    for (const payload of [
      { modelCode: 'OTHER', assignments }, { modelCode: '　', assignments },
      { modelCode: 'DFD1', assignments: [{ sortOrder: 0 }] },
      { modelCode: 'DFD1', assignments: [{ kioskDocumentId: documentId, assemblyProcedureDocumentId: documentId, sortOrder: 0 }] }
    ]) {
      expect((await app.inject({ method: 'PUT', url: path, payload })).statusCode).toBe(400);
    }
    expect(service.replaceAssignments).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for duplicate order values through the service and does not mutate assignments', async () => {
    harness();
    const realService = new ProcedureManualService();
    // Exercise the actual validation behind the route, without a database connection.
    app = await app.close().then(() => Fastify());
    registerErrorHandler(app);
    registerProcedureManualRoutes(app, { allowView: async () => undefined, allowWriteKiosk: async () => undefined, service: realService, serializeSequence: serializeProcedureSequence });
    const transaction = vi.spyOn(realService, 'replaceAssignments');
    const response = await app.inject({ method: 'PUT', url: path, payload: { modelCode: 'DFD1', assignments: [
      { assemblyProcedureDocumentId: documentId, sortOrder: 0 }, { kioskDocumentId: documentId, sortOrder: 0 }
    ] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('並び順が重複');
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rejects writes with 403 before calling the service', async () => {
    const { service } = harness(true);
    const response = await app.inject({ method: 'PUT', url: path, payload: { modelCode: 'DFD1', assignments: [] } });
    expect(response.statusCode).toBe(403);
    expect(service.replaceAssignments).not.toHaveBeenCalled();
  });

  it('reports procedure manual usage when an assigned document is deleted through the existing route', async () => {
    harness();
    const procedureService = {
      getReferenceUsage: vi.fn().mockResolvedValue({ inProcedureManualAssignment: true }),
      buildInUseMessage: vi.fn().mockReturnValue('要領書の機種×工程割り当てで使用中の手順書は削除・公開取消できません'),
      deleteIfUnused: vi.fn()
    };
    registerAssemblyProcedureDocumentRoutes(app, {
      allowView: async () => undefined, allowWriteKiosk: async () => undefined,
      procedureService, procedureDraftImportService: {}, procedureGmailImportService: {}
    } as unknown as AssemblyProcedureDocumentRouteOptions);
    const response = await app.inject({ method: 'DELETE', url: `/assembly/procedure-documents/${documentId}` });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('要領書の機種×工程割り当て');
    expect(procedureService.deleteIfUnused).not.toHaveBeenCalled();
  });
});
