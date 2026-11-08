import type { FastifyInstance, FastifyRequest } from 'fastify';
import { findClientDeviceByApiKey } from '../../services/clients/client-device-auth.service.js';
import type { SignageContentResponse, SignageService } from '../../services/signage/index.js';

function resolveClientKeyFromRequest(request: FastifyRequest): string | null {
  const headerKey = request.headers['x-client-key'];
  const fromHeader =
    typeof headerKey === 'string' ? headerKey : headerKey?.[0] != null ? String(headerKey[0]) : null;
  const q = request.query;
  const fromQuery =
    typeof q === 'object' && q !== null && 'clientKey' in q && q.clientKey != null && q.clientKey !== ''
      ? String(q.clientKey)
      : null;
  return fromQuery ?? fromHeader ?? null;
}

/** Hide borrower names and thumbnails from callers without a registered terminal key. */
export function withoutEmployeeDetails(content: SignageContentResponse): SignageContentResponse {
  if (!content.tools) return content;
  return { ...content, tools: content.tools.map((tool) => ({ ...tool, employeeName: null, thumbnailUrl: null })) };
}

export function registerContentRoute(app: FastifyInstance, signageService: SignageService): void {
  // GET /api/signage/content - 現在時刻に基づいて表示すべきコンテンツを取得（サイネージ用）
  app.get('/content', { config: { rateLimit: false } }, async (request: FastifyRequest) => {
    const requestedKey = resolveClientKeyFromRequest(request);
    const device = requestedKey ? await findClientDeviceByApiKey(requestedKey) : null;
    const content = await signageService.getContent({ clientKey: device ? requestedKey : null });
    return device ? content : withoutEmployeeDetails(content);
  });
}
