import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import {
  findClientDeviceIdRecordByApiKey,
  parseKioskApiClientKeyHeader
} from '../../../services/clients/client-device-auth.service.js';
import {
  UnifiedInventoryListService,
  type UnifiedItem
} from '../../../services/tools/unified-inventory-list.service.js';
import { unifiedQuerySchema } from './schemas.js';

export type { UnifiedItem };

export function registerUnifiedListRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const unifiedInventoryListService = new UnifiedInventoryListService();

  app.get(
    '/unified',
    {
      config: { rateLimit: false },
      preHandler: async (request, reply) => {
        // キオスクはJWTを持たないため、x-client-keyがあればデバイス認証として許可する
        const clientKey = parseKioskApiClientKeyHeader(request.headers['x-client-key']);
        if (clientKey) {
          const clientDevice = await findClientDeviceIdRecordByApiKey(clientKey);
          if (!clientDevice) {
            throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
          }
          return;
        }
        await canView(request, reply);
      }
    },
    async (request) => {
      const query = unifiedQuerySchema.parse(request.query);
      const items = await unifiedInventoryListService.list(query);
      return { items };
    }
  );
}
