import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { requireKioskClientDevice } from '../../services/clients/client-device-auth.service.js';
import {
  TorqueTrainingService,
  TorqueTrainingKioskSettingsService,
  TorqueTrainingWrenchPreparationService
} from '../../services/torque-training/index.js';
import {
  operatorContextSchema,
  startTrainingSessionSchema,
  trainingAgentAttemptSchema,
  trainingCancelSchema,
  trainingDeactivateSchema,
  trainingExcludeSchema,
  trainingLeaseAcquireSchema,
  trainingLeaseTakeoverSchema,
  trainingLeaseTokenSchema,
  trainingProgramIdParamsSchema,
  trainingProgramInputSchema,
  trainingRevisionSchema,
  trainingSessionParamsSchema,
  torqueTrainingSettingsDeactivateSchema,
  torqueTrainingSettingsExcludeSchema,
  torqueTrainingSettingsProgramCreateSchema,
  torqueTrainingSettingsProgramRevisionSchema,
  torqueTrainingSettingsSnapshotSchema,
  trainingWrenchConfirmationSchema,
  trainingWrenchPreparationSchema
} from './schemas.js';

export async function registerTorqueTrainingRoutes(app: FastifyInstance): Promise<void> {
  const service = new TorqueTrainingService();
  const kioskSettingsService = new TorqueTrainingKioskSettingsService();
  const preparationService = new TorqueTrainingWrenchPreparationService();
  const canAdmin = authorizeRoles('ADMIN');
  const kioskSettingsRateLimit = { max: 10, timeWindow: '1 minute' };

  app.get('/torque-training/programs', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    void clientDevice;
    return { programs: await service.listPrograms(false) };
  });

  app.post('/torque-training/operator-context', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const body = operatorContextSchema.parse(request.body);
    return service.operatorContext(body.uid, clientDevice.id);
  });

  app.post('/torque-training/sessions', async (request, reply) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const body = startTrainingSessionSchema.parse(request.body);
    return reply.code(201).send({ session: await service.startSession(body.uid, body.programVersionId, clientDevice, body.requestId) });
  });

  app.get('/torque-training/sessions/:id', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingSessionParamsSchema.parse(request.params);
    return { session: await service.getSession(params.id, clientDevice.id) };
  });

  app.post('/torque-training/sessions/:id/cancel', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingSessionParamsSchema.parse(request.params);
    const body = trainingCancelSchema.parse(request.body);
    return service.cancelSession(params.id, clientDevice.id, body.reason);
  });

  app.post('/torque-training/sessions/:id/wrench-confirmations', async (request, reply) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingSessionParamsSchema.parse(request.params);
    const body = trainingWrenchConfirmationSchema.parse(request.body);
    return reply.code(201).send({ confirmation: await service.confirmWrench(params.id, body.uid, body.torqueWrenchProfileId, clientDevice) });
  });

  app.post('/torque-training/sessions/:id/wrench-preparations', async (request, reply) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingSessionParamsSchema.parse(request.params);
    const body = trainingWrenchPreparationSchema.parse(request.body);
    const preparation = await preparationService.prepare(params.id, body, clientDevice);
    return reply.code(preparation.duplicate ? 200 : 201).send({ preparation });
  });

  app.post('/torque-training/sessions/:id/attempts/from-agent', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingSessionParamsSchema.parse(request.params);
    const body = trainingAgentAttemptSchema.parse(request.body);
    return service.recordAgentAttempt({ sessionId: params.id, clientDeviceId: clientDevice.id, ...body });
  });

  // The kiosk settings panel uses the shared operation password. The
  // existing ADMIN JWT routes below remain unchanged for the management
  // console. Each request rechecks the password on the server, even when the
  // browser keeps the PIN in memory after the initial snapshot.
  app.post('/torque-training/settings/snapshot', { config: { rateLimit: kioskSettingsRateLimit } }, async (request) => {
    await requireKioskClientDevice(request.headers['x-client-key']);
    const body = torqueTrainingSettingsSnapshotSchema.parse(request.body);
    return { snapshot: await kioskSettingsService.snapshot(body.accessPassword) };
  });

  app.post('/torque-training/settings/programs', { config: { rateLimit: kioskSettingsRateLimit } }, async (request, reply) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const body = torqueTrainingSettingsProgramCreateSchema.parse(request.body);
    const program = await kioskSettingsService.createProgram(body.accessPassword, clientDevice, body.program);
    return reply.code(201).send({ program });
  });

  app.post('/torque-training/settings/programs/:id/revisions', { config: { rateLimit: kioskSettingsRateLimit } }, async (request, reply) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingProgramIdParamsSchema.parse(request.params);
    const body = torqueTrainingSettingsProgramRevisionSchema.parse(request.body);
    const version = await kioskSettingsService.reviseProgram(body.accessPassword, clientDevice, params.id, body.revision);
    return reply.code(201).send({ version });
  });

  app.post('/torque-training/settings/programs/:id/deactivate', { config: { rateLimit: kioskSettingsRateLimit } }, async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingProgramIdParamsSchema.parse(request.params);
    const body = torqueTrainingSettingsDeactivateSchema.parse(request.body);
    return { program: await kioskSettingsService.deactivateProgram(body.accessPassword, clientDevice, params.id, body.reason) };
  });

  app.post('/torque-training/settings/sessions/:id/exclude', { config: { rateLimit: kioskSettingsRateLimit } }, async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingSessionParamsSchema.parse(request.params);
    const body = torqueTrainingSettingsExcludeSchema.parse(request.body);
    return { session: await kioskSettingsService.excludeSession(body.accessPassword, clientDevice, params.id, body.reason) };
  });

  app.post('/torque-wrenches/:id/usage-lease/acquire', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingProgramIdParamsSchema.parse(request.params);
    const body = trainingLeaseAcquireSchema.parse(request.body);
    return { lease: await service.acquireTrainingLease({ profileId: params.id, clientDeviceId: clientDevice.id, ...body, takeover: false }) };
  });

  app.post('/torque-wrenches/:id/usage-lease/takeover', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingProgramIdParamsSchema.parse(request.params);
    const body = trainingLeaseTakeoverSchema.parse(request.body);
    return { lease: await service.acquireTrainingLease({ profileId: params.id, clientDeviceId: clientDevice.id, ...body, takeover: true }) };
  });

  app.post('/torque-wrenches/:id/usage-lease/renew', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingProgramIdParamsSchema.parse(request.params);
    const body = trainingLeaseTokenSchema.parse(request.body);
    return { lease: await service.renewTrainingLease({ profileId: params.id, clientDeviceId: clientDevice.id, ...body }) };
  });

  app.post('/torque-wrenches/:id/usage-lease/release', async (request) => {
    const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
    const params = trainingProgramIdParamsSchema.parse(request.params);
    const body = trainingLeaseTokenSchema.parse(request.body);
    const released = await service.releaseTrainingLease({ profileId: params.id, clientDeviceId: clientDevice.id, ...body });
    return { lease: released.status, result: released.result, status: released.status };
  });

  app.post('/admin/torque-training/programs', { preHandler: canAdmin }, async (request, reply) => {
    return reply.code(201).send({ program: await service.createProgram(trainingProgramInputSchema.parse(request.body)) });
  });

  app.get('/admin/torque-training/programs', { preHandler: canAdmin }, async () => ({ programs: await service.listPrograms(true) }));

  app.post('/admin/torque-training/programs/:id/revisions', { preHandler: canAdmin }, async (request, reply) => {
    const params = trainingProgramIdParamsSchema.parse(request.params);
    return reply.code(201).send({ version: await service.reviseProgram(params.id, trainingRevisionSchema.parse(request.body)) });
  });

  app.post('/admin/torque-training/programs/:id/deactivate', { preHandler: canAdmin }, async (request) => {
    const params = trainingProgramIdParamsSchema.parse(request.params);
    return { program: await service.deactivateProgram(params.id, trainingDeactivateSchema.parse(request.body).reason) };
  });

  app.get('/admin/torque-training/results', { preHandler: canAdmin }, async () => ({ results: await service.listAdminResults() }));

  app.post('/admin/torque-training/sessions/:id/exclude', { preHandler: canAdmin }, async (request) => {
    const params = trainingSessionParamsSchema.parse(request.params);
    return { session: await service.excludeSession(params.id, trainingExcludeSchema.parse(request.body).reason, { id: request.user!.id, username: request.user!.username }) };
  });
}
