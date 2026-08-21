import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { findClientDeviceByApiKey } from '../../services/clients/client-device-auth.service.js';
import {
  getAssemblyProcedureAssetStorage,
  resolveAssemblyProcedureAssetStoragePath,
} from '../../services/assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.js';
import { buildPdfPageEtag, ifNoneMatchSatisfied } from './pdf-page-http-cache.js';

const ASSET_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const ASSET_RATE_LIMIT = { max: 240, timeWindow: '1 minute' };
const ASSET_PATH_PREFIX = '/api/storage/assembly-procedure-assets/';

function contentTypeForAssetPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  switch (extension) {
    case '.pdf':
      return 'application/pdf';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function authorizeAssetView(
  request: FastifyRequest,
  reply: FastifyReply,
  canView: ReturnType<typeof authorizeRoles>,
): Promise<void> {
  const headerKey = request.headers['x-client-key'];
  if (headerKey) {
    const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
    const client = await findClientDeviceByApiKey(apiKey);
    if (client) return;
  }
  await canView(request, reply);
}

/**
 * Immutable original/overlay asset delivery. The DB remains the authority
 * for references; this route only validates a generated asset URL and
 * verifies its integrity catalog entry before returning bytes.
 */
export function registerAssemblyProcedureAssetStorageRoutes(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const storage = getAssemblyProcedureAssetStorage();

  app.get(
    '/storage/assembly-procedure-assets/*',
    { config: { rateLimit: ASSET_RATE_LIMIT } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await authorizeAssetView(request, reply, canView);
      const urlPath = request.url.split('?')[0]?.replace(ASSET_PATH_PREFIX, '') ?? '';
      if (!urlPath) {
        return reply.status(400).send({ message: '手順書assetのパスが指定されていません' });
      }

      try {
        const parsed = resolveAssemblyProcedureAssetStoragePath(urlPath);
        const reference = { storageKey: parsed.storageKey };
        const stat = await storage.stat(reference);
        const etag = buildPdfPageEtag(stat);
        reply.header('ETag', etag);
        reply.header('Cache-Control', ASSET_CACHE_CONTROL);
        if (ifNoneMatchSatisfied(request.headers['if-none-match'], etag)) {
          return reply.code(304).send();
        }
        const buffer = await storage.read(reference);
        reply.type(parsed.contentType || contentTypeForAssetPath(urlPath));
        return reply.send(buffer);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const err = error instanceof Error ? error : new Error(String(error));
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.status(404).send({ message: '手順書assetが見つかりません' });
        }
        if (
          err.message.startsWith('Invalid assembly procedure asset') ||
          err.message.startsWith('Unsupported assembly procedure asset')
        ) {
          return reply.status(400).send({ message: '手順書assetのパスが不正です' });
        }
        request.log.error({ err, urlPath }, '手順書assetの読み込みに失敗しました');
        return reply.status(500).send({ message: '手順書assetの読み込みに失敗しました' });
      }
    },
  );
}
