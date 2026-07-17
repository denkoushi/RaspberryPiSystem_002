import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  assertKioskApiClientKeyValid,
  requireKioskClientDevice
} from '../../services/clients/client-device-auth.service.js';
import { AssemblyTorqueTraceabilityService, TorqueWrenchMasterService } from '../../services/torque-wrenches/index.js';
import {
  assemblyWorkSessionParamsSchema,
  capabilityGroupCreateSchema,
  capabilityGroupUpdateSchema,
  compatibleCapabilityGroupQuerySchema,
  torqueWrenchIdParamsSchema,
  torqueWrenchListQuerySchema,
  torqueWrenchModelCreateSchema,
  torqueWrenchModelUpdateSchema,
  torqueWrenchProfileCreateSchema,
  torqueWrenchProfileUpdateSchema,
  torqueWrenchSettingCreateSchema,
  torqueWrenchConfirmationCreateSchema,
  torqueOverrideRecordSchema
} from './schemas.js';

export async function registerTorqueWrenchRoutes(app: FastifyInstance): Promise<void> {
  const service = new TorqueWrenchMasterService();
  const traceabilityService = new AssemblyTorqueTraceabilityService();
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch (error) {
        if (!request.headers['x-client-key']) throw error;
      }
    }
    await assertKioskApiClientKeyValid(request.headers['x-client-key']);
    if (reply.statusCode === 401) reply.code(200);
  };

  app.get('/torque-wrench-models', { preHandler: allowView }, async (request) => {
    const query = torqueWrenchListQuerySchema.parse(request.query);
    return { models: await service.listModels(query.includeInactive) };
  });

  app.post('/torque-wrench-models', { preHandler: canWrite }, async (request, reply) => {
    const model = await service.createModel(torqueWrenchModelCreateSchema.parse(request.body));
    return reply.code(201).send({ model });
  });

  app.get('/torque-wrench-models/:id', { preHandler: allowView }, async (request) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const model = await service.getModel(id);
    if (!model) throw new ApiError(404, 'トルクレンチ型番が見つかりません');
    return { model };
  });

  app.put('/torque-wrench-models/:id', { preHandler: canWrite }, async (request) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const model = await service.updateModel(id, torqueWrenchModelUpdateSchema.parse(request.body));
    return { model };
  });

  app.get('/torque-wrench-capability-groups/compatible', { preHandler: allowView }, async (request) => {
    const query = compatibleCapabilityGroupQuerySchema.parse(request.query);
    return { capabilityGroups: await service.findCompatibleCapabilityGroups(query) };
  });

  app.get('/torque-wrench-capability-groups', { preHandler: allowView }, async (request) => {
    const query = torqueWrenchListQuerySchema.parse(request.query);
    return { capabilityGroups: await service.listCapabilityGroups(query.includeInactive) };
  });

  app.post('/torque-wrench-capability-groups', { preHandler: canWrite }, async (request, reply) => {
    const capabilityGroup = await service.createCapabilityGroup(capabilityGroupCreateSchema.parse(request.body));
    return reply.code(201).send({ capabilityGroup });
  });

  app.get('/torque-wrench-capability-groups/:id', { preHandler: allowView }, async (request) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const capabilityGroup = (await service.listCapabilityGroups(true)).find((entry) => entry.id === id);
    if (!capabilityGroup) throw new ApiError(404, '適合グループが見つかりません');
    return { capabilityGroup };
  });

  app.put('/torque-wrench-capability-groups/:id', { preHandler: canWrite }, async (request) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const capabilityGroup = await service.updateCapabilityGroup(id, capabilityGroupUpdateSchema.parse(request.body));
    return { capabilityGroup };
  });

  app.get('/torque-wrenches', { preHandler: allowView }, async (request) => {
    const query = torqueWrenchListQuerySchema.parse(request.query);
    return { torqueWrenches: await service.listProfiles(query.includeInactive) };
  });

  app.post('/torque-wrenches', { preHandler: canWrite }, async (request, reply) => {
    const torqueWrench = await service.createProfile(torqueWrenchProfileCreateSchema.parse(request.body));
    return reply.code(201).send({ torqueWrench });
  });

  app.get('/torque-wrenches/:id', { preHandler: allowView }, async (request) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const torqueWrench = await service.getProfile(id);
    if (!torqueWrench) throw new ApiError(404, '物理トルクレンチが見つかりません');
    return { torqueWrench };
  });

  app.put('/torque-wrenches/:id', { preHandler: canWrite }, async (request) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const torqueWrench = await service.updateProfile(id, torqueWrenchProfileUpdateSchema.parse(request.body));
    return { torqueWrench };
  });

  app.post('/torque-wrenches/:id/settings', { preHandler: canWrite }, async (request, reply) => {
    const { id } = torqueWrenchIdParamsSchema.parse(request.params);
    const body = torqueWrenchSettingCreateSchema.parse(request.body);
    const setting = await service.addSetting(id, {
      ...body,
      actorUserId: request.user?.id,
      actorUsername: request.user?.username
    });
    return reply.code(201).send({ setting });
  });

  app.get('/assembly/work-sessions/:id/compatible-torque-wrenches', async (request) => {
    const { id } = assemblyWorkSessionParamsSchema.parse(request.params);
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    return {
      torqueWrenches: await traceabilityService.listCompatible(id, clientDevice.id)
    };
  });

  app.post('/assembly/work-sessions/:id/torque-wrench-confirmations', async (request, reply) => {
    const { id } = assemblyWorkSessionParamsSchema.parse(request.params);
    const body = torqueWrenchConfirmationCreateSchema.parse(request.body);
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const confirmation = await traceabilityService.confirm({
      sessionId: id,
      clientDeviceId: clientDevice.id,
      clientDeviceName: clientDevice.name,
      ...body
    });
    return reply.code(201).send({ confirmation });
  });

  app.get(
    '/assembly/work-sessions/:id/torque-wrench-confirmations/current',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = assemblyWorkSessionParamsSchema.parse(request.params);
      let clientDeviceId: string | undefined;
      if (request.headers.authorization) {
        try {
          await canWrite(request, reply);
        } catch (error) {
          if (!request.headers['x-client-key']) throw error;
          const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
          clientDeviceId = clientDevice.id;
        }
      } else {
        const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
        clientDeviceId = clientDevice.id;
      }
      return { confirmations: await traceabilityService.listCurrentConfirmations(id, clientDeviceId) };
    }
  );

  app.post('/assembly/work-sessions/:id/record-torque-override', { preHandler: canWrite }, async (request) => {
    const { id } = assemblyWorkSessionParamsSchema.parse(request.params);
    const body = torqueOverrideRecordSchema.parse(request.body);
    return traceabilityService.recordOverride({
      sessionId: id,
      ...body,
      actorUserId: request.user!.id,
      actorUsername: request.user!.username
    });
  });

}
