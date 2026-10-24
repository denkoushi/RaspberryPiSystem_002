import { DomainHttpError } from '../../lib/errors.js';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod/v3';
import {
  AssemblyLotService,
  AssemblyWorkSessionService,
  buildAssemblyLotSummary
} from '../../services/assembly/index.js';
import {
  idParamSchema,
  createAssemblyLotBodySchema,
  lotSerialParamsSchema,
  operatorAccessBodySchema
} from './schemas.js';
import { serializeAssemblyLotSummary, serializeSession } from './serializers.js';
import { tryGetClientDevice } from './shared.js';

export function registerAssemblyLotRoutes(app: FastifyInstance, {
  allowView,
  allowWriteKiosk,
  sessionService,
  lotService
}: {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  sessionService: AssemblyWorkSessionService;
  lotService: AssemblyLotService;
}): void {
  app.post('/assembly/lots', { preHandler: allowWriteKiosk }, async (request) => {
    const body = createAssemblyLotBodySchema.parse(request.body);
    const clientDevice = await tryGetClientDevice(request.headers);
    const lot = await lotService.create({
      ...body,
      clientDeviceId: clientDevice?.id ?? null,
      clientDeviceNameSnapshot: clientDevice?.name ?? null
    });
    return { lot: serializeAssemblyLotSummary(buildAssemblyLotSummary(lot)) };
  });

  app.get('/assembly/lots/summary', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        productNo: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);
    const lots = await lotService.listSummary(q);
    return { lots: lots.map(serializeAssemblyLotSummary) };
  });

  app.get('/assembly/lots/:id', { preHandler: allowView }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const lot = await lotService.getById(params.id);
    if (!lot) throw new DomainHttpError(404, '組立ロットが見つかりません');
    return { lot: serializeAssemblyLotSummary(buildAssemblyLotSummary(lot)) };
  });

  app.post('/assembly/lots/:lotId/serials/:lotSerialId/start', { preHandler: allowWriteKiosk }, async (request) => {
    const params = lotSerialParamsSchema.parse(request.params);
    const body = operatorAccessBodySchema.parse(request.body ?? {});
    const clientDevice = await tryGetClientDevice(request.headers);
    const session = await lotService.startSerial({
      lotId: params.lotId,
      lotSerialId: params.lotSerialId,
      operatorNfcTagUid: body.operatorNfcTagUid,
      requestId: body.requestId,
      clientDeviceId: clientDevice?.id ?? null,
      clientDeviceNameSnapshot: clientDevice?.name ?? null
    });
    return { session: serializeSession(session, sessionService) };
  });
}
