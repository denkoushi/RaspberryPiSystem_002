import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/part-measurement/part-measurement-visual-cleanup-token.js', () => ({
  assertVisualCleanupToken: vi.fn(),
  signVisualCleanupToken: vi.fn(() => 'token')
}));

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerVisualTemplateRoutes } from '../visual-templates.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url = `/part-measurement/visual-templates/${id}`;

const visualTemplateService = {
  getById: vi.fn(),
  updateName: vi.fn(),
  deleteIfUnused: vi.fn()
};

const errorBody = (message: string) => ({
  message,
  requestId: expect.any(String),
  timestamp: expect.any(String)
});

describe('visual template error responses', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    registerErrorHandler(app);
    const allow = vi.fn(async () => undefined);
    registerVisualTemplateRoutes(app, {
      allowView: allow,
      allowWriteKiosk: allow,
      visualTemplateService
    } as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 when the visual template does not exist', async () => {
    visualTemplateService.getById.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(errorBody('図面テンプレートが見つかりません。'));
  });

  it('returns 404 with the service message when renaming a missing visual template', async () => {
    visualTemplateService.updateName.mockRejectedValue(new ApiError(404, '図面テンプレートが見つかりません'));

    const response = await app.inject({ method: 'PATCH', url, payload: { name: 'new name' } });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(errorBody('図面テンプレートが見つかりません'));
  });

  it('passes other rename errors through unchanged', async () => {
    visualTemplateService.updateName.mockRejectedValue(new ApiError(400, '名前が不正です', undefined, 'BAD_NAME'));

    const response = await app.inject({ method: 'PATCH', url, payload: { name: 'new name' } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ ...errorBody('名前が不正です'), errorCode: 'BAD_NAME' });
  });

  it('returns 404 when deleting a missing visual template', async () => {
    visualTemplateService.deleteIfUnused.mockResolvedValue('not_found');

    const response = await app.inject({ method: 'DELETE', url, headers: { 'x-visual-cleanup-token': 'token' } });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(errorBody('図面テンプレートが見つかりません。'));
  });

  it('returns 409 when deleting a visual template that is in use', async () => {
    visualTemplateService.deleteIfUnused.mockResolvedValue('in_use');

    const response = await app.inject({ method: 'DELETE', url, headers: { 'x-visual-cleanup-token': 'token' } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(errorBody('図面テンプレートは使用中のため削除できません。'));
  });

  it('returns 204 when an unused visual template is deleted', async () => {
    visualTemplateService.deleteIfUnused.mockResolvedValue('deleted');

    const response = await app.inject({ method: 'DELETE', url, headers: { 'x-visual-cleanup-token': 'token' } });

    expect(response.statusCode).toBe(204);
  });
});
