import { describe, expect, it, vi } from 'vitest';
import { SignageContentType } from '@prisma/client';

import { BusinessHermesMcpService } from './business-hermes-mcp.service.js';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const SECRET_API_KEY = 'server-only-signage-api-key';
const STORED_API_KEY = 'stored-signage-api-key';

function progressLayout(deviceScopeKey: string, options: Record<string, number> = {}) {
  return {
    layout: 'FULL',
    slots: [{
      position: 'FULL',
      kind: 'kiosk_progress_overview',
      config: { deviceScopeKey, ...options }
    }]
  };
}

function canvasSpec(overrides: Record<string, unknown> = {}) {
  return {
    width: 1920,
    height: 1080,
    backgroundColor: '#020617',
    elements: [
      {
        id: 'title', kind: 'text', x: 40, y: 30, width: 1840, height: 80,
        text: '業務進捗', style: { fontSize: 40, fontWeight: '700' }
      },
      {
        id: 'progress', kind: 'visualization', x: 40, y: 140, width: 900, height: 860,
        title: '進捗KPI', dataSourceType: 'production_schedule', dataSourceConfig: { view: 'kpi' },
        rendererType: 'kpi_cards', rendererConfig: {}
      },
      {
        id: 'progress-table', kind: 'visualization', x: 980, y: 180, width: 900, height: 780,
        title: '製番別進捗', dataSourceType: 'production_schedule', dataSourceConfig: { view: 'table' },
        rendererType: 'table', rendererConfig: { maxRows: 10 }
      },
    ],
    ...overrides,
  };
}

function serviceWith({
  schedules = [],
  findMany = vi.fn(async (input?: { where?: unknown }) => input?.where
    ? [{ id: DEVICE_ID, apiKey: SECRET_API_KEY }]
    : [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]),
  a2uiData = { resolve: vi.fn(async (value) => value), readSource: vi.fn(), listSources: vi.fn() }
}: {
  schedules?: Array<Record<string, unknown>>;
  findMany?: ReturnType<typeof vi.fn>;
  a2uiData?: { resolve: ReturnType<typeof vi.fn>; readSource: ReturnType<typeof vi.fn>; listSources: ReturnType<typeof vi.fn> };
} = {}) {
  const createSchedule = vi.fn(async (input: Record<string, unknown>) => ({
    id: 'new-schedule',
    ...input,
    targetClientKeys: input.targetClientKeys ?? [],
    layoutConfig: input.layoutConfig ?? null,
    enabled: input.enabled ?? true
  }));
  const updateSchedule = vi.fn(async (id: string, input: Record<string, unknown>) => ({
    id,
    ...input,
    targetClientKeys: input.targetClientKeys ?? [],
    layoutConfig: input.layoutConfig ?? null,
    enabled: input.enabled ?? true
  }));
  const db = { clientDevice: { findMany } };
  const signage = {
    listSchedulesForManagement: vi.fn().mockResolvedValue(schedules),
    createSchedule,
    updateSchedule
  };
  const service = new BusinessHermesMcpService({
    db: db as never,
    signage: signage as never,
    a2uiData: a2uiData as never,
    workInstructions: {} as never
  });
  return { service, db, signage, createSchedule, updateSchedule, a2uiData };
}

function payload(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, any>;
}

describe('BusinessHermesMcpService signage tools', () => {
  it('exposes only non-secret target identifiers', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: DEVICE_ID,
      name: '業務キオスク',
      location: '工場A - 組立1'
    }]);
    const { service } = serviceWith({ findMany });

    const response = await service.call('business_hermes_list_signage_targets', {});
    const result = payload(response);

    expect(result.targets).toEqual([{
      id: DEVICE_ID,
      name: '業務キオスク',
      deviceScopeKey: '工場A - 組立1'
    }]);
    expect(response.content[0]?.text).not.toContain('apiKey');
    expect(response.content[0]?.text).not.toContain(SECRET_API_KEY);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, location: true },
      orderBy: { name: 'asc' }
    });
  });

  it('uses the canonical resolver with trimmed name fallback for a scope', async () => {
    const findMany = vi.fn(async (input?: { where?: unknown }) => input?.where
      ? [{ id: DEVICE_ID }]
      : [{ id: DEVICE_ID, name: '  業務キオスク  ', location: null }]);
    const { service } = serviceWith({ findMany });
    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', {
      scheduleName: '名前フォールバック', confirm: true, deviceScopeKey: '  業務キオスク  ',
      targetClientDeviceIds: [DEVICE_ID], dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1
    });
    expect(response.isError).toBeUndefined();
    expect(payload(response)).toMatchObject({ operation: 'create', proposal: { deviceScopeKey: '業務キオスク' } });
  });

  it('saves the official A2UI definition for periodic rendering only after application approval', async () => {
    const a2ui = {
      layoutMessage: {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'signage',
          components: [{ id: 'root', component: 'Text', text: { path: '/screen/title' } }]
        }
      },
      dataMessage: {
        version: 'v0.9',
        updateDataModel: { surfaceId: 'signage', path: '/', value: { screen: { title: '進捗' } } }
      }
    };
    const { service, a2uiData, createSchedule } = serviceWith();
    a2uiData.resolve.mockImplementation(async (definition) => ({
      ...definition,
      dataMessage: { ...definition.dataMessage, updateDataModel: {
        ...definition.dataMessage.updateDataModel, value: { screen: { title: '最新の値' } }
      } }
    }));
    const input = {
      scheduleName: 'A2UI画面', confirm: true, deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [DEVICE_ID], dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1,
      a2ui
    };
    const proposalResponse = await service.call('business_hermes_configure_signage_custom_dashboard', input);
    const proposalBody = payload(proposalResponse);
    expect(proposalBody.action).toBe('proposed');
    expect(proposalBody.proposal).toMatchObject({ scheduleName: 'A2UI画面', a2ui });
    expect(createSchedule).not.toHaveBeenCalled();

    const applyResponse = await service.applySignageProposal(proposalBody.proposal);
    expect(payload(applyResponse)).toMatchObject({ action: 'created', schedule: { pdfId: null } });
    expect(a2uiData.resolve).toHaveBeenCalledWith(a2ui);
    expect(createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      contentType: SignageContentType.TOOLS,
      pdfId: null,
      layoutConfig: { layout: 'FULL', slots: [], a2ui }
    }));

    a2uiData.resolve.mockRejectedValueOnce(new Error('source lookup failed'));
    const failed = await service.call('business_hermes_configure_signage_custom_dashboard', input);
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed.content)).toContain('business_hermes_read_signage_source');
    expect(createSchedule).toHaveBeenCalledTimes(1);
  });

  it('lists existing schedule IDs and safe settings without target keys', async () => {
    const schedules = [{
      id: '33333333-3333-4333-8333-333333333333',
      name: '既存PDF',
      contentType: 'PDF',
      pdfId: '77777777-7777-4777-8777-777777777777',
      layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind: 'pdf', config: { pdfId: 'kept' } }] },
      targetClientKeys: [SECRET_API_KEY],
      dayOfWeek: [1, 3], startTime: '08:00', endTime: '17:00', priority: 4, enabled: false
    }];
    const { service } = serviceWith({ schedules });

    const response = await service.call('business_hermes_list_signage_schedules', {});
    expect(payload(response).schedules).toEqual([expect.objectContaining({
      id: schedules[0].id,
      name: '既存PDF',
      contentType: 'PDF',
      content: {
        pdfId: schedules[0].pdfId,
        layoutConfig: schedules[0].layoutConfig
      },
      targetClientCount: 1,
      dayOfWeek: [1, 3],
      startTime: '08:00',
      endTime: '17:00',
      priority: 4,
      enabled: false,
      supportedByBusinessHermes: false
    })]);
    expect(response.content[0]?.text).not.toContain(SECRET_API_KEY);
    expect(response.content[0]?.text).not.toContain('apiKey');
  });

  it('returns a safe content summary without unknown legacy layout fields', async () => {
    const schedules = [{
      id: '88888888-8888-4888-8888-888888888888', name: '既存表示', contentType: 'PDF',
      pdfId: '99999999-9999-4999-8999-999999999999', layoutConfig: {
        layout: 'FULL',
        slots: [{ position: 'FULL', kind: 'pdf', config: {
          pdfId: '99999999-9999-4999-8999-999999999999', displayMode: 'SINGLE', apiKey: 'do-not-return'
        } }],
        hiddenInternalValue: 'do-not-return'
      }, targetClientKeys: [], dayOfWeek: [1],
      startTime: '08:00', endTime: '17:00', priority: 1, enabled: true
    }];
    const { service } = serviceWith({ schedules });

    const response = await service.call('business_hermes_list_signage_schedules', {});
    const result = payload(response).schedules[0];
    expect(result.content.layoutConfig).toEqual({
      layout: 'FULL',
      slots: [{ position: 'FULL', kind: 'pdf', config: {
        pdfId: '99999999-9999-4999-8999-999999999999', displayMode: 'SINGLE'
      } }]
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });

  it('lists the business signage tools without exposing a key field', () => {
    const { service } = serviceWith();
    const tools = service.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'business_hermes_list_signage_targets',
      'business_hermes_list_signage_schedules',
      'business_hermes_configure_signage_kiosk_progress_overview'
    ]));
    const configureTool = tools.find((tool) => tool.name === 'business_hermes_configure_signage_kiosk_progress_overview');
    expect(JSON.stringify(configureTool)).not.toContain('apiKey');
    expect(JSON.stringify(configureTool)).not.toContain('targetClientKeys');
    expect(tools.map((tool) => tool.name)).toContain('business_hermes_configure_signage_custom_dashboard');
  });

  it('rejects canvas schema boundary violations and unauthorized data sources/renderers', async () => {
    const { service, createSchedule } = serviceWith();
    const common = {
      scheduleName: '自由画面', confirm: true, deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [DEVICE_ID], dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1
    };

    const invalidBoundary = await service.call('business_hermes_configure_signage_custom_dashboard', {
      ...common, canvas: canvasSpec({ width: 639 })
    });
    expect(invalidBoundary.isError).toBe(true);

    const invalidSource = await service.call('business_hermes_configure_signage_custom_dashboard', {
      ...common,
      canvas: canvasSpec({ elements: [{ ...(canvasSpec().elements[1] as Record<string, unknown>), dataSourceType: 'javascript' }] })
    });
    expect(invalidSource.isError).toBe(true);

    const invalidRenderer = await service.call('business_hermes_configure_signage_custom_dashboard', {
      ...common,
      canvas: canvasSpec({ elements: [{ ...(canvasSpec().elements[1] as Record<string, unknown>), rendererType: 'arbitrary' }] })
    });
    expect(invalidRenderer.isError).toBe(true);
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('prepares and applies a custom canvas through the real create path without returning target secrets', async () => {
    const findMany = vi.fn(async (input?: { where?: unknown }) => input?.where
      ? [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1', apiKey: SECRET_API_KEY }]
      : [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]);
    const { service, createSchedule } = serviceWith({ findMany });
    const spec = canvasSpec();
    const response = await service.call('business_hermes_configure_signage_custom_dashboard', {
      scheduleName: '自由画面', confirm: true, deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [DEVICE_ID], dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00', endTime: '17:00', priority: 5, canvas: spec
    });
    const proposed = payload(response);

    expect(response.isError).toBeUndefined();
    expect(proposed).toMatchObject({ action: 'proposed', operation: 'create', approvalRequired: true });
    expect(proposed.proposal.canvas).toEqual(spec);
    expect(response.content[0]?.text).not.toContain(SECRET_API_KEY);
    expect(createSchedule).not.toHaveBeenCalled();

    const applied = await service.applySignageProposal(proposed.proposal);
    expect(createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      name: '自由画面',
      targetClientKeys: [SECRET_API_KEY],
      layoutConfig: { layout: 'CANVAS', ...spec }
    }));
    expect(payload(applied)).toMatchObject({ action: 'created', schedule: { name: '自由画面', targetClientCount: 1 } });
    expect(applied.content[0]?.text).not.toContain(SECRET_API_KEY);
  });

  it('updates an existing canvas schedule through the real update path', async () => {
    const existing = {
      id: '33333333-3333-4333-8333-333333333333', name: '自由画面', contentType: 'TOOLS', pdfId: null,
      layoutConfig: { layout: 'CANVAS', ...canvasSpec() }, targetClientKeys: [STORED_API_KEY],
      dayOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '17:00', priority: 5, enabled: true
    };
    const findMany = vi.fn(async (input?: { where?: unknown }) => input?.where
      ? [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]
      : [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]);
    const { service, updateSchedule } = serviceWith({ schedules: [existing], findMany });
    const updatedCanvas = canvasSpec({ backgroundColor: '#111827' });
    const response = await service.call('business_hermes_configure_signage_custom_dashboard', {
      scheduleName: '自由画面', confirm: true, canvas: updatedCanvas, priority: 8
    });
    const proposed = payload(response);

    expect(proposed).toMatchObject({ action: 'proposed', operation: 'update', proposal: { canvas: updatedCanvas, priority: 8 } });
    expect(updateSchedule).not.toHaveBeenCalled();
    await service.applySignageProposal(proposed.proposal);
    expect(updateSchedule).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      priority: 8, targetClientKeys: [STORED_API_KEY], layoutConfig: { layout: 'CANVAS', ...updatedCanvas }
    }));
  });

  it('prepares a progress schedule without writing, then applies it with server-resolved target keys', async () => {
    const { service, createSchedule } = serviceWith();

    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', {
      scheduleName: '業務進捗',
      confirm: true,
      deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [DEVICE_ID],
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '17:00',
      priority: 10,
      slideIntervalSeconds: 45,
      seibanPerPage: 6
    });

    expect(response.isError).toBeUndefined();
    expect(payload(response)).toMatchObject({
      action: 'proposed',
      operation: 'create',
      approvalRequired: true,
      proposal: { scheduleName: '業務進捗', targetClientDeviceIds: [DEVICE_ID] }
    });
    expect(createSchedule).not.toHaveBeenCalled();
    expect(response.content[0]?.text).not.toContain(SECRET_API_KEY);

    const applied = await service.applySignageProposal(payload(response).proposal);
    expect(createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      name: '業務進捗',
      targetClientKeys: [SECRET_API_KEY],
      layoutConfig: progressLayout('工場A - 組立1', { slideIntervalSeconds: 45, seibanPerPage: 6 })
    }));
    expect(applied.content[0]?.text).not.toContain(SECRET_API_KEY);
    expect(payload(applied)).toMatchObject({
      action: 'created',
      schedule: { targetClientCount: 1, name: '業務進捗' }
    });
  });

  it('preserves omitted update fields, including existing targeting and page settings', async () => {
    const existing = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '業務進捗',
      contentType: 'TOOLS',
      pdfId: null,
      layoutConfig: progressLayout('工場A - 組立1', { slideIntervalSeconds: 50, seibanPerPage: 4 }),
      targetClientKeys: [STORED_API_KEY],
      dayOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '17:00',
      priority: 7,
      enabled: false
    };
    const findMany = vi.fn(async (input?: { where?: unknown }) => input?.where
      ? [{ id: DEVICE_ID, apiKey: STORED_API_KEY }]
      : [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]);
    const { service, updateSchedule } = serviceWith({ schedules: [existing], findMany });

    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', {
      scheduleName: '業務進捗',
      startTime: '09:00',
      confirm: true
    });

    expect(payload(response)).toMatchObject({ action: 'proposed', operation: 'update', approvalRequired: true });
    expect(updateSchedule).not.toHaveBeenCalled();
    const applied = await service.applySignageProposal(payload(response).proposal);
    expect(updateSchedule).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      targetClientKeys: [STORED_API_KEY],
      dayOfWeek: existing.dayOfWeek,
      startTime: '09:00',
      endTime: existing.endTime,
      priority: existing.priority,
      enabled: existing.enabled,
      layoutConfig: progressLayout('工場A - 組立1', { slideIntervalSeconds: 50, seibanPerPage: 4 })
    }));
    expect(findMany).toHaveBeenCalledWith({ select: { id: true, name: true, location: true } });
    expect(applied.content[0]?.text).not.toContain(STORED_API_KEY);
  });

  it('rejects an unknown canonical scope without writing', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { service, createSchedule } = serviceWith({ findMany });
    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', {
      scheduleName: '業務進捗', confirm: true, deviceScopeKey: '存在しないスコープ',
      targetClientDeviceIds: [DEVICE_ID], dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1
    });
    expect(response.isError).toBe(true);
    expect(payload(response).code).toBe('BUSINESS_HERMES_UNKNOWN_DEVICE_SCOPE_KEY');
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('rejects unknown target IDs without writing', async () => {
    const findMany = vi.fn(async (input?: { where?: unknown }) => input?.where ? [] : [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]);
    const { service, createSchedule } = serviceWith({ findMany });
    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', {
      scheduleName: '業務進捗', confirm: true, deviceScopeKey: '工場A - 組立1',
      targetClientDeviceIds: [OTHER_DEVICE_ID], dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1
    });
    expect(response.isError).toBe(true);
    expect(payload(response).code).toBe('BUSINESS_HERMES_UNKNOWN_TARGET_CLIENT_DEVICE');
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('rejects duplicate names before attempting an update', async () => {
    const duplicate = {
      id: '44444444-4444-4444-8444-444444444444', name: '業務進捗', contentType: 'TOOLS',
      layoutConfig: progressLayout('工場A - 組立1'), targetClientKeys: [], dayOfWeek: [1],
      startTime: '08:00', endTime: '17:00', priority: 1, enabled: true
    };
    const { service, updateSchedule, createSchedule } = serviceWith({ schedules: [duplicate, { ...duplicate, id: '55555555-5555-4555-8555-555555555555' }] });
    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', { scheduleName: '業務進捗', confirm: true });
    expect(response.isError).toBe(true);
    expect(payload(response).code).toBe('BUSINESS_HERMES_SIGNAGE_SCHEDULE_NAME_AMBIGUOUS');
    expect(updateSchedule).not.toHaveBeenCalled();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('preserves an existing non-progress schedule while changing timing, enabled state, and targets', async () => {
    const existing = {
      id: '66666666-6666-4666-8666-666666666666', name: '業務進捗', contentType: 'PDF',
      pdfId: '77777777-7777-4777-8777-777777777777',
      layoutConfig: { layout: 'SPLIT', slots: [{ position: 'LEFT', kind: 'pdf', config: { pdfId: 'kept-layout' } }] },
      targetClientKeys: [STORED_API_KEY], dayOfWeek: [1], startTime: '08:00', endTime: '17:00', priority: 1, enabled: true
    };
    const findMany = vi.fn(async (input?: { where?: unknown }) => input?.where
      ? [{ id: OTHER_DEVICE_ID, apiKey: SECRET_API_KEY }]
      : [{ id: DEVICE_ID, name: '業務キオスク', location: '工場A - 組立1' }]);
    const { service, updateSchedule } = serviceWith({ schedules: [existing], findMany });
    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', { scheduleName: '業務進捗', confirm: true });
    expect(response.isError).toBeUndefined();
    const applied = await service.applySignageProposal({ scheduleId: existing.id, dayOfWeek: [2], startTime: '09:00', endTime: '18:00', priority: 9, enabled: false, targetClientDeviceIds: [OTHER_DEVICE_ID] });
    expect(updateSchedule).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      contentType: existing.contentType,
      pdfId: existing.pdfId,
      layoutConfig: existing.layoutConfig,
      targetClientKeys: [SECRET_API_KEY],
      dayOfWeek: [2], startTime: '09:00', endTime: '18:00', priority: 9, enabled: false
    }));
    expect(applied.content[0]?.text).not.toContain(SECRET_API_KEY);
  });

  it.each([
    { targetClientKeys: [SECRET_API_KEY] },
    { confirm: false },
    { scheduleName: '業務進捗', confirm: true }
  ])('rejects unsafe or incomplete configuration input %#', async (input) => {
    const { service, createSchedule, updateSchedule } = serviceWith();
    const response = await service.call('business_hermes_configure_signage_kiosk_progress_overview', input);
    expect(response.isError).toBe(true);
    expect(createSchedule).not.toHaveBeenCalled();
    expect(updateSchedule).not.toHaveBeenCalled();
  });
});
