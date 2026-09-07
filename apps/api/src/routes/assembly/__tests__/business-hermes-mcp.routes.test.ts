import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerBusinessHermesMcpRoutes } from '../business-hermes-mcp.js';

describe('business Hermes MCP route', () => {
  it('requires the dedicated service token and exposes MCP discovery/call semantics', async () => {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ApiError ? error.statusCode : 500).send({ code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR' }));
    const service = {
      listTools: vi.fn().mockReturnValue([{ name: 'business_hermes_search', description: 'search', inputSchema: { type: 'object' } }]),
      call: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"results":[]}' }] })
    };
    await registerBusinessHermesMcpRoutes(app, { service: service as never, apiKey: 'mcp-secret' });
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    expect((await app.inject({ method: 'POST', url: '/internal/business-hermes/mcp', payload: body })).statusCode).toBe(401);
    const list = await app.inject({ method: 'POST', url: '/internal/business-hermes/mcp', headers: { authorization: 'Bearer mcp-secret' }, payload: body });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ result: { tools: [{ name: 'business_hermes_search' }] } });
    const call = await app.inject({ method: 'POST', url: '/internal/business-hermes/mcp', headers: { authorization: 'Bearer mcp-secret' }, payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'business_hermes_search', arguments: { query: 'offset' } } } });
    expect(call.statusCode).toBe(200);
    expect(service.call).toHaveBeenCalledWith('business_hermes_search', { query: 'offset' });
  });
});
