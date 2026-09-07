import type { FastifyInstance } from 'fastify';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import {
  BusinessHermesMcpService,
  type BusinessHermesMcpTool
} from '../../services/assembly/business-hermes-mcp.service.js';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type BusinessHermesMcpRouteDeps = {
  service?: BusinessHermesMcpService;
  apiKey?: string;
};

function tokenFromRequest(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  const explicit = request.headers['x-business-hermes-mcp-key'];
  return typeof explicit === 'string' ? explicit.trim() || null : null;
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolsPayload(tools: ReadonlyArray<BusinessHermesMcpTool>) {
  return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) };
}

export async function registerBusinessHermesMcpRoutes(
  app: FastifyInstance,
  deps: BusinessHermesMcpRouteDeps = {}
): Promise<void> {
  const service = deps.service ?? new BusinessHermesMcpService();
  app.post('/internal/business-hermes/mcp', async (request, reply) => {
    const expected = deps.apiKey ?? env.BUSINESS_HERMES_MCP_API_KEY;
    if (!expected) throw new ApiError(503, '業務Hermes MCPは設定されていません', undefined, 'BUSINESS_HERMES_MCP_NOT_CONFIGURED');
    if (tokenFromRequest(request) !== expected) {
      throw new ApiError(401, '業務Hermes MCP認証に失敗しました', undefined, 'BUSINESS_HERMES_MCP_UNAUTHORIZED');
    }
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as JsonRpcRequest;
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return reply.code(400).send(rpcError(body.id, -32600, 'invalid JSON-RPC request'));
    }
    if (body.method === 'initialize') {
      return { jsonrpc: '2.0', id: body.id ?? null, result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'business-hermes-mcp', version: '1' }
      } };
    }
    if (body.method === 'notifications/initialized') {
      if (body.id === undefined) return reply.code(202).send();
      return { jsonrpc: '2.0', id: body.id ?? null, result: {} };
    }
    if (body.method === 'ping') {
      return { jsonrpc: '2.0', id: body.id ?? null, result: {} };
    }
    if (body.method === 'tools/list') {
      return { jsonrpc: '2.0', id: body.id ?? null, result: toolsPayload(service.listTools()) };
    }
    if (body.method === 'tools/call') {
      const name = body.params?.name;
      if (typeof name !== 'string') return reply.code(200).send(rpcError(body.id, -32602, 'tools/call requires name'));
      const result = await service.call(name, body.params?.arguments ?? {});
      return { jsonrpc: '2.0', id: body.id ?? null, result };
    }
    return reply.code(200).send(rpcError(body.id, -32601, `method not found: ${body.method}`));
  });
}
