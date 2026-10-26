import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import {
  ScawStFutekigoReadService,
  type ScawStFutekigoReadItem
} from '../../services/scaw-stfutekigo/scaw-stfutekigo-read.service.js';
import { normalizeWorkInstructionPartNumber } from '../../services/work-instructions/domain/normalization.js';

const querySchema = z.object({
  partNumber: z.string().trim().min(1).max(200)
});

type ReadService = Pick<ScawStFutekigoReadService, 'readCurrentByPartNumber'>;

export type SelfInspectionNonconformityRouteOptions = {
  read?: ReadService;
  readPreHandler?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
};

async function authorizeContentRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
}

function toDto(item: ScawStFutekigoReadItem) {
  return {
    id: item.id,
    discoveredOn: item.discoveredOn,
    originDepartmentName: item.originDepartmentName,
    remarks: item.remarks,
    nonconformityContent: item.nonconformityContent,
    dispositionContent: item.dispositionContent,
    correctiveContent1: item.correctiveContent1,
    correctiveContent2: item.correctiveContent2,
    partName: item.partName,
    machineName: item.machineName
  };
}

export async function registerSelfInspectionNonconformityRoutes(
  app: FastifyInstance,
  options: SelfInspectionNonconformityRouteOptions = {}
): Promise<void> {
  const read = options.read ?? new ScawStFutekigoReadService();
  const canRead = options.readPreHandler ?? authorizeContentRead;

  app.get(
    '/kiosk/self-inspection/nonconformities',
    { preHandler: [canRead], config: { rateLimit: false } },
    async (request) => {
      const query = querySchema.parse(request.query ?? {});
      const partNumber = normalizeWorkInstructionPartNumber(query.partNumber);
      if (!partNumber) return { count: 0, items: [] };
      const items = await read.readCurrentByPartNumber(partNumber);
      return { count: items.length, items: items.map(toDto) };
    }
  );
}
