import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerAssemblyLotRoutes } from '../lots.js';
import { registerAssemblyCandidateRoutes, registerAssemblyTemplateRoutes } from '../templates.js';
import { registerAssemblyWorkSessionRoutes } from '../work-sessions.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('assembly not-found response contracts', () => {
  let app: ReturnType<typeof Fastify>;
  const lotService = { getById: vi.fn() };
  const templateService = { getById: vi.fn(), retire: vi.fn() };
  const sessionService = { getDetail: vi.fn() };
  const procedureSequenceService = { resolveForWorkSession: vi.fn() };

  beforeEach(() => {
    lotService.getById.mockResolvedValue(null);
    templateService.getById.mockResolvedValue(null);
    templateService.retire.mockResolvedValue('not_found');
    sessionService.getDetail.mockResolvedValue(null);
    procedureSequenceService.resolveForWorkSession.mockResolvedValue(null);
    vi.spyOn(prisma.employee, 'findFirst').mockResolvedValue(null);

    app = Fastify();
    registerErrorHandler(app);
    const access = {
      allowView: async () => undefined,
      allowWriteKiosk: async () => undefined
    };
    registerAssemblyLotRoutes(app, {
      ...access,
      lotService,
      sessionService
    } as unknown as Parameters<typeof registerAssemblyLotRoutes>[1]);
    registerAssemblyCandidateRoutes(app, {
      ...access,
      libraryFilterOptionsService: {},
      machineNameCandidatesService: {},
      seibanStartService: {},
      seibanLotQuantityService: {}
    } as unknown as Parameters<typeof registerAssemblyCandidateRoutes>[1]);
    registerAssemblyTemplateRoutes(app, {
      ...access,
      templateService
    } as unknown as Parameters<typeof registerAssemblyTemplateRoutes>[1]);
    registerAssemblyWorkSessionRoutes(app, {
      ...access,
      sessionService,
      procedureSequenceService,
      traceabilityService: {},
      recordApprovalService: {},
      excelService: {},
      businessHermesService: {}
    } as unknown as Parameters<typeof registerAssemblyWorkSessionRoutes>[1]);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    { name: 'missing lot', url: `/assembly/lots/${id}`, message: '組立ロットが見つかりません' },
    { name: 'missing template', url: `/assembly/templates/${id}`, message: 'テンプレートが見つかりません' },
    { name: 'missing work session', url: `/assembly/work-sessions/${id}`, message: '作業セッションが見つかりません' },
    { name: 'missing procedure sequence', url: `/assembly/work-sessions/${id}/procedure-sequence`, message: '作業セッションが見つかりません' }
  ])('returns the complete shared 404 body for $name', async ({ url, message }) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message,
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  it('returns the complete shared 404 body for an unknown employee NFC tag', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assembly/operators/resolve-nfc',
      payload: { uid: 'unknown-tag' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: '社員タグが見つかりません',
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  it('returns the complete shared 404 body when retiring a missing template', async () => {
    const response = await app.inject({ method: 'DELETE', url: `/assembly/templates/${id}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: 'テンプレートが見つかりません',
      requestId: expect.any(String),
      timestamp: expect.any(String)
    });
    expect(templateService.retire).toHaveBeenCalledWith(id);
  });
});
