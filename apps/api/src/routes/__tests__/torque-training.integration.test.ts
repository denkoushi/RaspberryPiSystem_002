import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyTemplateService } from '../../services/assembly/assembly-template.service.js';
import { AssemblyWorkSessionService } from '../../services/assembly/assembly-work-session.service.js';
import { AssemblyTorqueTraceabilityService } from '../../services/torque-wrenches/assembly-torque-traceability.service.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('torque training API concurrency boundary', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await prisma.assemblyTorqueRecord.deleteMany({});
    await prisma.assemblyTorqueWrenchConfirmation.deleteMany({});
    await prisma.assemblyWorkSessionOperatorAccess.deleteMany({});
    await prisma.assemblyWorkSession.deleteMany({});
    await prisma.assemblyLotSerial.deleteMany({});
    await prisma.assemblyLot.deleteMany({});
    await prisma.assemblyWorkUnitComposition.deleteMany({});
    await prisma.assemblyWorkUnit.deleteMany({});
    await prisma.assemblyTemplateBolt.deleteMany({});
    await prisma.assemblyTemplateArea.deleteMany({});
    await prisma.assemblyTemplate.deleteMany({});
    await prisma.assemblyProcedureDocumentPage.deleteMany({});
    await prisma.assemblyProcedureDocument.deleteMany({});
    await prisma.torqueTrainingAttempt.deleteMany({});
    await prisma.torqueWrenchUsageLeaseHistory.deleteMany({});
    await prisma.torqueWrenchUsageLease.deleteMany({});
    await prisma.torqueTrainingWrenchConfirmation.deleteMany({});
    await prisma.torqueTrainingSession.deleteMany({});
    await prisma.torqueTrainingProgramWrench.deleteMany({});
    await prisma.torqueTrainingProgramVersion.deleteMany({});
    await prisma.torqueTrainingProgram.deleteMany({});
    await prisma.torqueWrenchSettingHistory.deleteMany({});
    await prisma.torqueWrenchCapabilityGroupModel.deleteMany({});
    await prisma.torqueWrenchProfile.deleteMany({});
    await prisma.measuringInstrument.deleteMany({});
    await prisma.torqueWrenchCapabilityGroup.deleteMany({});
    await prisma.torqueWrenchModel.deleteMany({});
    await prisma.clientDevice.deleteMany({});
    await prisma.employee.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  async function fixture() {
    const employee = await createTestEmployee({ nfcTagUid: `TRAINING_TAG_${randomUUID()}` });
    const client = await createTestClientDevice(`training-client-${randomUUID()}`);
    const model = await prisma.torqueWrenchModel.create({
      data: {
        manufacturer: 'TOHNICHI',
        manufacturerKey: 'TOHNICHI',
        modelNumber: 'CEM3-BTLA-TEST',
        modelNumberKey: 'CEM3-BTLA-TEST',
        torqueMinNm: 1,
        torqueMaxNm: 100,
        resolutionNm: 0.01,
        outputProfile: 'fixture-v1'
      }
    });
    const group = await prisma.torqueWrenchCapabilityGroup.create({
      data: {
        name: `TRAINING-GROUP-${randomUUID()}`,
        nominalDiameter: 'M6',
        boltLengthMm: 20,
        material: 'SCM435',
        strengthClass: '10.9'
      }
    });
    await prisma.torqueWrenchCapabilityGroupModel.create({ data: { capabilityGroupId: group.id, modelId: model.id } });
    const instrument = await prisma.measuringInstrument.create({
      data: {
        name: 'Training wrench',
        managementNumber: `TRAINING-MI-${randomUUID()}`,
        calibrationExpiryDate: new Date(Date.now() + 86_400_000),
        status: 'AVAILABLE'
      }
    });
    const profile = await prisma.torqueWrenchProfile.create({
      data: {
        measuringInstrumentId: instrument.id,
        modelId: model.id,
        serialNumber: '702902S',
        serialNumberKey: '702902S'
      }
    });
    await prisma.torqueWrenchSettingHistory.create({
      data: {
        torqueWrenchProfileId: profile.id,
        lowerLimit: 9,
        nominalTorque: 10,
        upperLimit: 11,
        unit: 'N-m',
        lowerLimitNm: 9,
        nominalTorqueNm: 10,
        upperLimitNm: 11,
        reason: 'training fixture'
      }
    });
    const program = await prisma.torqueTrainingProgram.create({
      data: {
        code: `TRAINING-${randomUUID()}`,
        currentVersion: 1,
        versions: {
          create: {
            version: 1,
            displayName: 'M6 training',
            nominalDiameter: 'M6',
            boltLengthMm: 20,
            material: 'SCM435',
            strengthClass: '10.9',
            capabilityGroupId: group.id,
            nominalTorque: 10,
            lowerLimit: 9,
            upperLimit: 11,
            unit: 'N-m',
            jigConditionCode: 'JIG-A',
            conditionFingerprint: 'fixture-fingerprint',
            attemptCount: 5,
            wrenches: { create: { torqueWrenchProfileId: profile.id } }
          }
        }
      },
      include: { versions: true }
    });
    return { employee, client, profile, program, version: program.versions[0]! };
  }

  it('keeps requestId strict and serializes six concurrent agent events to five accepted attempts', async () => {
    const { employee, client, profile, program, version } = await fixture();
    const headers = { 'x-client-key': client.apiKey, 'content-type': 'application/json' };
    const start = (requestId: string, selectedVersionId = version.id) => app.inject({
      method: 'POST',
      url: '/api/torque-training/sessions',
      headers,
      payload: { uid: employee.nfcTagUid, programVersionId: selectedVersionId, requestId }
    });
    const first = await start('training-request-1');
    expect(first.statusCode).toBe(201);
    const session = first.json().session;
    expect(session.program).toMatchObject({
      conditionFingerprint: version.conditionFingerprint,
      torqueWrenchProfiles: [{ id: profile.id, serialNumber: profile.serialNumber }]
    });
    const retry = await start('training-request-1');
    expect(retry.statusCode).toBe(201);
    expect(retry.json().session.id).toBe(session.id);
    expect((await start('training-request-2')).statusCode).toBe(409);

    const nonCurrent = await prisma.torqueTrainingProgramVersion.create({
      data: {
        programId: program.id,
        version: 2,
        displayName: 'old revision',
        nominalDiameter: 'M6',
        boltLengthMm: 20,
        material: 'SCM435',
        strengthClass: '10.9',
        capabilityGroupId: version.capabilityGroupId,
        nominalTorque: 10,
        lowerLimit: 9,
        upperLimit: 11,
        unit: 'N-m',
        jigConditionCode: 'JIG-A',
        conditionFingerprint: 'fixture-fingerprint',
        attemptCount: 5
      }
    });
    await prisma.torqueTrainingSession.update({ where: { id: session.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), activeEmployeeKey: null, activeClientKey: null } });
    expect((await start('training-request-old', nonCurrent.id)).statusCode).toBe(409);
    await prisma.torqueTrainingSession.update({ where: { id: session.id }, data: { status: 'IN_PROGRESS', cancelledAt: null, cancelReason: null, activeEmployeeKey: 'ACTIVE', activeClientKey: 'ACTIVE' } });

    const confirmationResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${session.id}/wrench-confirmations`,
      headers,
      payload: { uid: employee.nfcTagUid, torqueWrenchProfileId: profile.id }
    });
    expect(confirmationResponse.statusCode).toBe(201);
    const confirmationId = confirmationResponse.json().confirmation.id as string;
    const leaseResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/usage-lease/acquire`,
      headers,
      payload: { sessionId: session.id, confirmationId, requestId: 'training-lease-1' }
    });
    expect(leaseResponse.statusCode).toBe(200);
    const lease = leaseResponse.json().lease as { leaseId: string; generation: number };
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${session.id}/attempts/from-agent`,
      headers,
      payload: {
        sourceEventKey: `training-event-${index}`,
        confirmationId,
        torqueWrenchProfileId: profile.id,
        serialNumber: profile.serialNumber,
        value: 10,
        unit: 'N-m',
        connectionLeaseId: lease.leaseId,
        connectionLeaseGeneration: lease.generation
      }
    })));
    expect(attempts.every((response) => [200, 409].includes(response.statusCode))).toBe(true);
    expect(await prisma.torqueTrainingAttempt.count({ where: { sessionId: session.id, accepted: true } })).toBe(5);
    expect(await prisma.torqueTrainingAttempt.count({ where: { sessionId: session.id, attemptNo: { not: null } } })).toBe(5);
    expect((await prisma.torqueTrainingSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('COMPLETED');
    const replay = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${session.id}/attempts/from-agent`,
      headers,
      payload: {
        sourceEventKey: 'training-event-0',
        confirmationId,
        torqueWrenchProfileId: profile.id,
        serialNumber: profile.serialNumber,
        value: 10,
        unit: 'N-m',
        connectionLeaseId: lease.leaseId,
        connectionLeaseGeneration: lease.generation
      }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicate).toBe(true);
    expect(await prisma.torqueWrenchUsageLeaseHistory.findFirst({ where: { torqueWrenchProfileId: profile.id, action: 'RELEASE', reason: 'TRAINING_COMPLETED' } })).toMatchObject({ adoptedConfirmationId: confirmationId });
    expect(await prisma.torqueWrenchUsageLease.findUniqueOrThrow({ where: { torqueWrenchProfileId: profile.id } })).toMatchObject({ releasedAt: expect.any(Date), generation: 1 });
  });

  it('acknowledges legacy stale events and accepts new events with the profile ID', async () => {
    const { employee, client, profile, version } = await fixture();
    const headers = { 'x-client-key': client.apiKey, 'content-type': 'application/json' };
    const started = await app.inject({
      method: 'POST',
      url: '/api/torque-training/sessions',
      headers,
      payload: { uid: employee.nfcTagUid, programVersionId: version.id, requestId: 'legacy-agent-request' }
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;
    const confirmation = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${sessionId}/wrench-confirmations`,
      headers,
      payload: { uid: employee.nfcTagUid, torqueWrenchProfileId: profile.id }
    });
    expect(confirmation.statusCode).toBe(201);
    const confirmationId = confirmation.json().confirmation.id as string;
    const lease = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/usage-lease/acquire`,
      headers,
      payload: { sessionId, confirmationId, requestId: 'legacy-agent-lease' }
    });
    expect(lease.statusCode).toBe(200);
    const leaseBody = lease.json().lease as { leaseId: string; generation: number };

    // This is the shape emitted by an older queued outbox row: the profile ID
    // is absent and the old lease token is no longer valid. It must be
    // persisted as an ignored audit row and acknowledged so the queue can
    // continue to the next event.
    const legacyResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${sessionId}/attempts/from-agent`,
      headers,
      payload: {
        sourceEventKey: 'legacy-agent-event',
        confirmationId,
        serialNumber: profile.serialNumber,
        value: 10,
        unit: 'N-m',
        connectionLeaseId: randomUUID(),
        connectionLeaseGeneration: leaseBody.generation
      }
    });
    expect(legacyResponse.statusCode).toBe(200);
    expect(legacyResponse.json()).toMatchObject({
      duplicate: false,
      attempt: { accepted: false, attemptNo: null, ignoredReason: 'LEASE_TOKEN_INVALID' }
    });
    await expect(prisma.torqueTrainingAttempt.findUniqueOrThrow({
      where: { sourceClientDeviceId_sourceEventKey: { sourceClientDeviceId: client.id, sourceEventKey: 'legacy-agent-event' } }
    })).resolves.toMatchObject({ torqueWrenchProfileId: profile.id, accepted: false, ignoredReason: 'LEASE_TOKEN_INVALID' });

    const currentResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${sessionId}/attempts/from-agent`,
      headers,
      payload: {
        sourceEventKey: 'current-agent-event',
        confirmationId,
        torqueWrenchProfileId: profile.id,
        serialNumber: profile.serialNumber,
        value: 10,
        unit: 'N-m',
        connectionLeaseId: leaseBody.leaseId,
        connectionLeaseGeneration: leaseBody.generation
      }
    });
    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json()).toMatchObject({
      duplicate: false,
      attempt: { accepted: true, attemptNo: 1, ignoredReason: null }
    });
    await expect(prisma.torqueTrainingAttempt.findUniqueOrThrow({
      where: { sourceClientDeviceId_sourceEventKey: { sourceClientDeviceId: client.id, sourceEventKey: 'current-agent-event' } }
    })).resolves.toMatchObject({ torqueWrenchProfileId: profile.id, accepted: true });
  });

  it('writes a release history row when an in-progress training session is cancelled', async () => {
    const { employee, client, profile, version } = await fixture();
    const headers = { 'x-client-key': client.apiKey, 'content-type': 'application/json' };
    const started = await app.inject({ method: 'POST', url: '/api/torque-training/sessions', headers, payload: { uid: employee.nfcTagUid, programVersionId: version.id, requestId: 'cancel-request' } });
    const sessionId = started.json().session.id as string;
    const confirmation = await app.inject({ method: 'POST', url: `/api/torque-training/sessions/${sessionId}/wrench-confirmations`, headers, payload: { uid: employee.nfcTagUid, torqueWrenchProfileId: profile.id } });
    const confirmationId = confirmation.json().confirmation.id as string;
    const lease = await app.inject({ method: 'POST', url: `/api/torque-wrenches/${profile.id}/usage-lease/acquire`, headers, payload: { sessionId, confirmationId, requestId: 'cancel-lease' } });
    expect(lease.statusCode).toBe(200);
    const cancelled = await app.inject({ method: 'POST', url: `/api/torque-training/sessions/${sessionId}/cancel`, headers, payload: { reason: 'operator left' } });
    expect(cancelled.statusCode).toBe(200);
    expect(await prisma.torqueWrenchUsageLeaseHistory.findFirst({ where: { torqueWrenchProfileId: profile.id, action: 'RELEASE', reason: 'TRAINING_CANCELLED' } })).not.toBeNull();
  });

  it('keeps the training lease connectAfter deadline stable across renewals', async () => {
    const { employee, client, profile, version } = await fixture();
    const headers = { 'x-client-key': client.apiKey, 'content-type': 'application/json' };
    const started = await app.inject({
      method: 'POST',
      url: '/api/torque-training/sessions',
      headers,
      payload: { uid: employee.nfcTagUid, programVersionId: version.id, requestId: 'renew-connect-after-request' }
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;
    const confirmation = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${sessionId}/wrench-confirmations`,
      headers,
      payload: { uid: employee.nfcTagUid, torqueWrenchProfileId: profile.id }
    });
    expect(confirmation.statusCode).toBe(201);
    const confirmationId = confirmation.json().confirmation.id as string;
    const acquired = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/usage-lease/acquire`,
      headers,
      payload: { sessionId, confirmationId, requestId: 'renew-connect-after-lease' }
    });
    expect(acquired.statusCode).toBe(200);
    const acquiredLease = acquired.json().lease as { leaseId: string; generation: number; connectAfter: string; expiresAt: string };
    const before = await prisma.torqueWrenchUsageLease.findUniqueOrThrow({ where: { torqueWrenchProfileId: profile.id } });

    const renewed = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/usage-lease/renew`,
      headers,
      payload: { sessionId, leaseId: acquiredLease.leaseId, generation: acquiredLease.generation }
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().lease).toMatchObject({
      leaseId: acquiredLease.leaseId,
      generation: acquiredLease.generation,
      connectAfter: acquiredLease.connectAfter
    });
    expect(new Date(renewed.json().lease.expiresAt).getTime()).toBeGreaterThan(new Date(acquiredLease.expiresAt).getTime());

    const after = await prisma.torqueWrenchUsageLease.findUniqueOrThrow({ where: { torqueWrenchProfileId: profile.id } });
    expect(after.connectAfter).toEqual(before.connectAfter);
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('keeps assembly and training owners exclusive, even when they share a client device', async () => {
    const { employee, client, profile, version } = await fixture();
    const headers = { 'x-client-key': client.apiKey, 'content-type': 'application/json' };

    const document = await prisma.assemblyProcedureDocument.create({
      data: {
        name: `training-lease-${randomUUID()}`,
        imageRelativePath: '/test/training-lease.png',
        status: 'PUBLISHED',
        publishedAt: new Date()
      }
    });
    const template = await new AssemblyTemplateService().create({
      modelCode: `TRAINING-LEASE-${randomUUID()}`,
      procedurePattern: 'standard',
      name: 'training lease assembly fixture',
      procedureDocumentId: document.id,
      traceabilityMode: 'REQUIRED',
      areas: [{
        sortOrder: 0,
        processNo: '1',
        areaCode: 'A',
        areaName: 'tightening',
        unitCode: 'U1',
        bolts: [{
          sortOrder: 0,
          markerNo: 1,
          xRatio: 0.2,
          yRatio: 0.2,
          boltSpec: 'M6x20 SCM435 10.9',
          nominalDiameter: 'M6',
          boltLengthMm: 20,
          material: 'SCM435',
          strengthClass: '10.9',
          capabilityGroupId: version.capabilityGroupId,
          nominalTorque: 10,
          lowerLimit: 9,
          upperLimit: 11,
          unit: 'N-m'
        }]
      }]
    });
    const assemblySession = await new AssemblyWorkSessionService().start({
      templateId: template.id,
      productNo: `TRAINING-LEASE-${randomUUID()}`,
      serialNo: `TRAINING-LEASE-${randomUUID()}`,
      operatorNfcTagUid: employee.nfcTagUid,
      requestId: randomUUID(),
      targetUnit: 'TRAINING-LEASE',
      clientDeviceId: client.id,
      clientDeviceNameSnapshot: client.name
    });
    const assemblyConfirmation = await new AssemblyTorqueTraceabilityService().confirm({
      sessionId: assemblySession.id,
      clientDeviceId: client.id,
      clientDeviceName: client.name,
      expectedTemplateBoltId: template.areas[0]!.bolts[0]!.id,
      torqueWrenchProfileId: profile.id,
      physicalDisplayConfirmed: true
    });

    const trainingStart = await app.inject({
      method: 'POST',
      url: '/api/torque-training/sessions',
      headers,
      payload: { uid: employee.nfcTagUid, programVersionId: version.id, requestId: `lease-training-${randomUUID()}` }
    });
    expect(trainingStart.statusCode).toBe(201);
    const trainingSessionId = trainingStart.json().session.id as string;
    const trainingConfirmation = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${trainingSessionId}/wrench-confirmations`,
      headers,
      payload: { uid: employee.nfcTagUid, torqueWrenchProfileId: profile.id }
    });
    expect(trainingConfirmation.statusCode).toBe(201);
    const trainingConfirmationId = trainingConfirmation.json().confirmation.id as string;

    const assemblyLeaseResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/acquire`,
      headers,
      payload: { sessionId: assemblySession.id, confirmationId: assemblyConfirmation.id, requestId: `assembly-lease-${randomUUID()}` }
    });
    expect(assemblyLeaseResponse.statusCode).toBe(200);
    const assemblyLease = assemblyLeaseResponse.json().lease as { leaseId: string; generation: number };

    const trainingWhileAssembly = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/usage-lease/acquire`,
      headers,
      payload: { sessionId: trainingSessionId, confirmationId: trainingConfirmationId, requestId: `training-held-${randomUUID()}` }
    });
    expect(trainingWhileAssembly.statusCode).toBe(409);
    expect(trainingWhileAssembly.json().errorCode).toBe('TORQUE_WRENCH_LEASE_HELD');
    expect(trainingWhileAssembly.json().details.lease).toMatchObject({
      state: 'owned_by_other',
      owner: { ownerKind: 'ASSEMBLY', clientDeviceName: expect.any(String) }
    });
    expect(trainingWhileAssembly.json().details.lease).not.toHaveProperty('leaseId');
    expect(trainingWhileAssembly.json().details.lease).not.toHaveProperty('generation');
    expect(trainingWhileAssembly.json().details.lease.owner).not.toHaveProperty('clientDeviceId');
    expect(trainingWhileAssembly.json().details.lease.owner).not.toHaveProperty('sessionId');

    const releaseAssembly = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/release`,
      headers,
      payload: { sessionId: assemblySession.id, ...assemblyLease, reason: 'switch to training' }
    });
    expect(releaseAssembly.statusCode).toBe(200);

    const trainingLeaseResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/usage-lease/acquire`,
      headers,
      payload: { sessionId: trainingSessionId, confirmationId: trainingConfirmationId, requestId: `training-lease-${randomUUID()}` }
    });
    expect(trainingLeaseResponse.statusCode).toBe(200);
    const trainingLease = trainingLeaseResponse.json().lease as { leaseId: string; generation: number };

    const assemblyWhileTraining = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/acquire`,
      headers,
      payload: { sessionId: assemblySession.id, confirmationId: assemblyConfirmation.id, requestId: `assembly-held-${randomUUID()}` }
    });
    expect(assemblyWhileTraining.statusCode).toBe(409);
    expect(assemblyWhileTraining.json().errorCode).toBe('TORQUE_WRENCH_LEASE_HELD');

    const assemblyView = await app.inject({
      method: 'GET',
      url: `/api/torque-wrenches/${profile.id}/connection-lease`,
      headers
    });
    expect(assemblyView.statusCode).toBe(200);
    expect(assemblyView.json().lease).toMatchObject({ state: 'owned_by_other' });
    expect(assemblyView.json().lease).not.toHaveProperty('leaseId');
    expect(assemblyView.json().lease).not.toHaveProperty('generation');

    const staleAssemblyRenew = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/renew`,
      headers,
      payload: { sessionId: assemblySession.id, ...assemblyLease }
    });
    expect(staleAssemblyRenew.statusCode).toBe(409);
    expect(staleAssemblyRenew.json().errorCode).toBe('TORQUE_WRENCH_LEASE_FENCED');

    const staleAssemblyRelease = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/release`,
      headers,
      payload: { sessionId: assemblySession.id, ...assemblyLease, reason: 'stale release' }
    });
    expect(staleAssemblyRelease.statusCode).toBe(200);
    expect(staleAssemblyRelease.json().result).toBe('stale_noop');
    expect(staleAssemblyRelease.json().lease).toMatchObject({ state: 'owned_by_other' });
    expect(staleAssemblyRelease.json().lease).not.toHaveProperty('leaseId');
    expect(staleAssemblyRelease.json().lease).not.toHaveProperty('generation');
    expect(await prisma.torqueWrenchUsageLease.count({ where: { torqueWrenchProfileId: profile.id } })).toBe(1);
    expect((await prisma.torqueWrenchUsageLease.findUniqueOrThrow({ where: { torqueWrenchProfileId: profile.id } })).leaseId).toBe(trainingLease.leaseId);
  });

  it('limits operator history to ten sessions per fingerprint without dropping another fingerprint', async () => {
    const { employee, client, version } = await fixture();
    const otherVersion = await prisma.torqueTrainingProgramVersion.create({
      data: {
        programId: version.programId,
        version: 2,
        displayName: 'M6 other jig',
        nominalDiameter: 'M6',
        boltLengthMm: 20,
        material: 'SCM435',
        strengthClass: '10.9',
        capabilityGroupId: version.capabilityGroupId,
        nominalTorque: 10,
        lowerLimit: 9,
        upperLimit: 11,
        unit: 'N-m',
        jigConditionCode: 'JIG-B',
        conditionFingerprint: 'other-fingerprint',
        attemptCount: 5
      }
    });
    const makeCompleted = async (index: number, programVersionId: string, fingerprint: string) => {
      const completedAt = new Date(Date.now() - index * 1_000);
      return prisma.torqueTrainingSession.create({
        data: {
          requestId: `history-${fingerprint}-${index}-${randomUUID()}`,
          programVersionId,
          employeeId: employee.id,
          employeeCodeSnapshot: employee.employeeCode,
          employeeNameSnapshot: employee.displayName,
          clientDeviceId: client.id,
          clientDeviceNameSnapshot: client.name,
          conditionFingerprint: fingerprint,
          status: 'COMPLETED',
          targetAttemptCount: 5,
          startedAt: new Date(completedAt.getTime() - 5_000),
          completedAt,
          attempts: {
            create: Array.from({ length: 5 }, (_, attemptNo) => ({
              attemptNo: attemptNo + 1,
              value: 10,
              inputUnit: 'N-m',
              valueNm: 10,
              nominalTorqueSnapshot: 10,
              lowerLimitSnapshot: 9,
              upperLimitSnapshot: 11,
              deviationNm: 0,
              deviationPercent: 0,
              absoluteDeviationPercent: 0,
              judgement: 'OK',
              accepted: true,
              torqueWrenchProfileId: null,
              sourceClientDeviceId: client.id,
              sourceEventKey: `history-${fingerprint}-${index}-${attemptNo}`
            }))
          }
        }
      });
    };
    await Promise.all(Array.from({ length: 11 }, (_, index) => makeCompleted(index, version.id, 'fixture-fingerprint')));
    await makeCompleted(0, otherVersion.id, 'other-fingerprint');

    const response = await app.inject({
      method: 'POST',
      url: '/api/torque-training/operator-context',
      headers: { 'x-client-key': client.apiKey, 'content-type': 'application/json' },
      payload: { uid: employee.nfcTagUid }
    });
    expect(response.statusCode).toBe(200);
    const metrics = response.json().metrics as Array<{ conditionFingerprint: string; sessions: unknown[] }>;
    expect(metrics.find((metric) => metric.conditionFingerprint === 'fixture-fingerprint')?.sessions).toHaveLength(10);
    expect(metrics.find((metric) => metric.conditionFingerprint === 'other-fingerprint')?.sessions).toHaveLength(1);
  });

  it('locks concurrent revisions and enforces ADMIN authorization', async () => {
    const { profile, program, version } = await fixture();
    const viewer = await createTestUser('VIEWER');
    const admin = await createTestUser('ADMIN');
    const endpoint = '/api/admin/torque-training/programs';

    expect((await app.inject({ method: 'GET', url: endpoint })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: endpoint, headers: createAuthHeader(viewer.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: endpoint, headers: createAuthHeader(admin.token) })).statusCode).toBe(200);

    const revision = {
      displayName: 'M6 revised',
      nominalDiameter: version.nominalDiameter,
      boltLengthMm: Number(version.boltLengthMm),
      material: version.material,
      strengthClass: version.strengthClass,
      capabilityGroupId: version.capabilityGroupId,
      nominalTorque: Number(version.nominalTorque),
      lowerLimit: Number(version.lowerLimit),
      upperLimit: Number(version.upperLimit),
      unit: version.unit,
      jigConditionCode: version.jigConditionCode,
      torqueWrenchProfileIds: [profile.id]
    };
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: `/api/admin/torque-training/programs/${program.id}/revisions`, headers: { ...createAuthHeader(admin.token), 'content-type': 'application/json' }, payload: revision }),
      app.inject({ method: 'POST', url: `/api/admin/torque-training/programs/${program.id}/revisions`, headers: { ...createAuthHeader(admin.token), 'content-type': 'application/json' }, payload: revision })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 201]);
    expect(await prisma.torqueTrainingProgram.findUniqueOrThrow({ where: { id: program.id }, select: { currentVersion: true } })).toMatchObject({ currentVersion: 3 });
    expect((await prisma.torqueTrainingProgramVersion.findMany({ where: { programId: program.id }, orderBy: { version: 'asc' }, select: { version: true, capabilityGroupId: true } })).map((row) => row.version)).toEqual([1, 2, 3]);
  });
});
