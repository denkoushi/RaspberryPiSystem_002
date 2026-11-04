import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerVisualTemplateRoutes } from '../visual-templates.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const proposalId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const url = `/api/part-measurement/visual-templates/${id}/placement-proposals`;
const drawingPlacementService = { listForEditor: vi.fn(), recordDecisions: vi.fn() };
const allowView = vi.fn(async () => undefined);
const allowWriteKiosk = vi.fn(async () => undefined);

describe('placement proposal route contracts', () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    registerErrorHandler(app);
    await app.register(async (scope) => registerVisualTemplateRoutes(scope, {
      allowView, allowWriteKiosk, drawingPlacementService
    } as never), { prefix: '/api' });
  });
  afterEach(async () => { await app.close(); });

  it.each(['ready', 'map-pending', 'no-sibling'])('returns the %s editor response through the view guard', async (status) => {
    const body = { status, sourceDrawingName: null, proposals: [], unplaced: [] };
    drawingPlacementService.listForEditor.mockResolvedValue(body);
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(body);
    expect(drawingPlacementService.listForEditor).toHaveBeenCalledWith(id, 'CUTTING');
    expect(allowView).toHaveBeenCalledOnce();
    expect(allowWriteKiosk).not.toHaveBeenCalled();
  });

  it.each([['cutting', 'CUTTING'], ['grinding', 'GRINDING']])('maps query process %s to %s', async (wire, processGroup) => {
    drawingPlacementService.listForEditor.mockResolvedValue({ status: 'no-sibling', proposals: [], unplaced: [], sourceDrawingName: null });
    expect((await app.inject({ method: 'GET', url: `${url}?processGroup=${wire}` })).statusCode).toBe(200);
    expect(drawingPlacementService.listForEditor).toHaveBeenCalledWith(id, processGroup);
  });

  it('rejects an invalid process before invoking the service', async () => {
    expect((await app.inject({ method: 'GET', url: `${url}?processGroup=invalid` })).statusCode).toBe(400);
    expect(drawingPlacementService.listForEditor).not.toHaveBeenCalled();
  });

  it('defaults omitted decision arrays and returns the update count', async () => {
    drawingPlacementService.recordDecisions.mockResolvedValue({ updated: 1 });
    const response = await app.inject({ method: 'POST', url: `${url}/decisions`, payload: { approvedIds: [proposalId] } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ updated: 1 });
    expect(drawingPlacementService.recordDecisions).toHaveBeenCalledWith(id, { approvedIds: [proposalId], rejectedIds: [] });
    expect(allowWriteKiosk).toHaveBeenCalledOnce();
    expect(allowView).not.toHaveBeenCalled();
  });

  it.each([[0, 1], [1, 0], [0.25, 0.75]])('accepts approved positions (%s, %s)', async (xRatio, yRatio) => {
    drawingPlacementService.recordDecisions.mockResolvedValue({ updated: 1 });
    const approvedPositions = [{ id: proposalId, xRatio, yRatio }];
    const response = await app.inject({
      method: 'POST', url: `${url}/decisions`, payload: { approvedIds: [proposalId], approvedPositions }
    });
    expect(response.statusCode).toBe(200);
    expect(drawingPlacementService.recordDecisions).toHaveBeenCalledWith(id, {
      approvedIds: [proposalId], rejectedIds: [], approvedPositions
    });
  });

  it.each([
    [{ id: proposalId, xRatio: -0.01, yRatio: 0.5 }],
    [{ id: proposalId, xRatio: 1.01, yRatio: 0.5 }],
    [{ id: proposalId, xRatio: 0.5, yRatio: -0.01 }],
    [{ id: proposalId, xRatio: 0.5, yRatio: 1.01 }],
    [{ id: proposalId, xRatio: '0.5', yRatio: 0.5 }],
    [{ id: proposalId, xRatio: null, yRatio: 0.5 }],
    [{ id: proposalId, xRatio: 0.5 }],
    [{ id: 'bad-id', xRatio: 0.5, yRatio: 0.5 }],
    Array(201).fill({ id: proposalId, xRatio: 0.5, yRatio: 0.5 })
  ].map((approvedPositions) => ({ approvedPositions })))('rejects invalid approved positions %#', async (payload) => {
    const response = await app.inject({ method: 'POST', url: `${url}/decisions`, payload });
    expect(response.statusCode).toBe(400);
    expect(drawingPlacementService.recordDecisions).not.toHaveBeenCalled();
  });

  it('returns the saved-item fields for both proposals and unplaced items', async () => {
    const item = {
      id: proposalId, measurementLabel: '深さ', measurementPoint: null, decimalPlaces: 2,
      nominalValue: 10, lowerLimit: null, upperLimit: 10.5, depthMode: 'through', valueKind: 'numeric'
    };
    const body = {
      status: 'ready', sourceDrawingName: '元図面',
      proposals: [{ ...item, sortOrder: 1, markerXRatio: 0.2, markerYRatio: 0.3, dimensionText: '10' }],
      unplaced: [{ ...item, reason: 'no-candidate' }]
    };
    drawingPlacementService.listForEditor.mockResolvedValue(body);
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(body);
  });

  it('accepts empty decisions and 200 entries in either array', async () => {
    drawingPlacementService.recordDecisions.mockResolvedValue({ updated: 0 });
    const empty = await app.inject({ method: 'POST', url: `${url}/decisions`, payload: {} });
    expect(empty.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST', url: `${url}/decisions`,
      payload: { approvedIds: Array(200).fill(proposalId), rejectedIds: Array(200).fill(proposalId) }
    });
    expect(response.statusCode).toBe(200);
  });

  it.each([
    { approvedIds: Array(201).fill(proposalId) }, { rejectedIds: Array(201).fill(proposalId) },
    { approvedIds: ['bad-id'] }, { rejectedIds: 'bad-array' }, { approvedIds: [1] }
  ])('rejects invalid decision bodies', async (payload) => {
    const response = await app.inject({ method: 'POST', url: `${url}/decisions`, payload });
    expect(response.statusCode).toBe(400);
    expect(drawingPlacementService.recordDecisions).not.toHaveBeenCalled();
  });

  it('validates the visual template ID', async () => {
    const response = await app.inject({ method: 'GET', url: url.replace(id, 'invalid') });
    expect(response.statusCode).toBe(400);
    expect(drawingPlacementService.listForEditor).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'] as const)('rejects %s before service execution if its guard fails', async (method) => {
    (method === 'GET' ? allowView : allowWriteKiosk).mockRejectedValueOnce(new ApiError(401, 'client key required'));
    const response = await app.inject({
      method, url: method === 'GET' ? url : `${url}/decisions`, ...(method === 'POST' ? { payload: {} } : {})
    });
    expect(response.statusCode).toBe(401);
    expect(drawingPlacementService.listForEditor).not.toHaveBeenCalled();
    expect(drawingPlacementService.recordDecisions).not.toHaveBeenCalled();
  });

  it('preserves the missing-drawing error', async () => {
    drawingPlacementService.listForEditor.mockRejectedValueOnce(new ApiError(404, '図面テンプレートが見つかりません。'));
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
});
