import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyTemplateService } from '../../services/assembly/assembly-template.service.js';
import { AssemblyWorkSessionService } from '../../services/assembly/assembly-work-session.service.js';
import { TorqueWrenchMasterService } from '../../services/torque-wrenches/torque-wrench-master.service.js';
import { TorqueTrainingService } from '../../services/torque-training/torque-training.service.js';
import {
  createAuthHeader,
  createTestClientDevice,
  createTestEmployee,
  createTestUser
} from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

type WrenchFixture = {
  groupId: string;
  profileId: string;
  serialNumber: string;
};

type AssemblyFixture = WrenchFixture & {
  client: Awaited<ReturnType<typeof createTestClientDevice>>;
  employee: Awaited<ReturnType<typeof createTestEmployee>>;
  session: Awaited<ReturnType<AssemblyWorkSessionService['start']>>;
  boltIds: string[];
};

type TrainingFixture = WrenchFixture & {
  client: Awaited<ReturnType<typeof createTestClientDevice>>;
  employee: Awaited<ReturnType<typeof createTestEmployee>>;
  versionId: string;
};

async function resetOptionalSettingsRouteData(): Promise<void> {
  await prisma.assemblyTorqueAgentEvent.deleteMany({});
  await prisma.assemblyTorqueRecord.deleteMany({});
  await prisma.assemblyTorqueWrenchConfirmation.deleteMany({});
  await prisma.assemblyWorkSessionOperatorAccess.deleteMany({});
  await prisma.assemblyWorkUnitInvalidation.deleteMany({});
  await prisma.assemblyWorkUnitComposition.deleteMany({});
  await prisma.assemblyFormalIdentifierAssignment.deleteMany({});
  await prisma.assemblyWorkSession.deleteMany({});
  await prisma.assemblyLotSerial.deleteMany({});
  await prisma.assemblyLot.deleteMany({});
  await prisma.assemblyWorkUnit.deleteMany({});
  await prisma.assemblyTemplateBolt.deleteMany({});
  await prisma.assemblyTemplateArea.deleteMany({});
  await prisma.assemblyTemplate.deleteMany({});
  await prisma.assemblyProcedureDocumentPage.deleteMany({});
  await prisma.assemblyProcedureDocument.deleteMany({});
  await prisma.torqueTrainingAttempt.deleteMany({});
  await prisma.torqueWrenchUsageLeaseHistory.deleteMany({});
  await prisma.torqueWrenchUsageLease.deleteMany({});
  await prisma.torqueTrainingWrenchPreparationRequest.deleteMany({});
  await prisma.torqueTrainingSettingsAuditLog.deleteMany({});
  await prisma.torqueTrainingWrenchConfirmation.deleteMany({});
  await prisma.torqueTrainingSession.deleteMany({});
  await prisma.torqueTrainingProgramWrench.deleteMany({});
  await prisma.torqueTrainingProgramVersion.deleteMany({});
  await prisma.torqueTrainingProgram.deleteMany({});
  await prisma.torqueWrenchSettingHistory.deleteMany({});
  await prisma.torqueWrenchCapabilityGroupModel.deleteMany({});
  await prisma.torqueWrenchCapabilityGroup.deleteMany({});
  await prisma.torqueWrenchProfile.deleteMany({});
  await prisma.measuringInstrument.deleteMany({});
  await prisma.torqueWrenchModel.deleteMany({});
  await prisma.clientDevice.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
}

async function createBoltWrench(): Promise<WrenchFixture> {
  const master = new TorqueWrenchMasterService();
  const model = await master.createModel({
    manufacturer: 'TOHNICHI',
    modelNumber: `OPTIONAL-BOLT-${randomUUID()}`,
    torqueMinNm: 1,
    torqueMaxNm: 100,
    resolutionNm: 0.01,
    outputProfile: 'optional-settings-test',
    settingVerificationMode: 'BOLT_CONDITION_ONLY'
  });
  const group = await master.createCapabilityGroup({
    name: `OPTIONAL-GROUP-${randomUUID()}`,
    nominalDiameter: 'M10',
    boltLengthMm: 35,
    material: 'SCM435',
    strengthClass: '10.9',
    modelIds: [model.id]
  });
  const profile = await master.createProfile({
    name: 'Optional settings wrench',
    managementNumber: `OPTIONAL-MI-${randomUUID()}`,
    modelId: model.id,
    serialNumber: `OPTIONAL-SERIAL-${randomUUID()}`,
    storageLocation: 'TalkPlazaF1',
    calibrationExpiryDate: new Date('2099-01-01T00:00:00.000Z'),
    status: 'AVAILABLE'
  });
  return {
    groupId: group.id,
    profileId: profile.id,
    serialNumber: profile.serialNumber
  };
}

async function createAssemblyFixture(
  wrench: WrenchFixture,
  options: {
    client?: Awaited<ReturnType<typeof createTestClientDevice>>;
    employee?: Awaited<ReturnType<typeof createTestEmployee>>;
    boltCount?: number;
  } = {}
): Promise<AssemblyFixture> {
  const client = options.client ?? await createTestClientDevice(`optional-assembly-${randomUUID()}`);
  const employee = options.employee ?? await createTestEmployee({
    displayName: 'Optional Assembly Operator',
    nfcTagUid: `OPTIONAL-ASSEMBLY-TAG-${randomUUID()}`
  });
  const document = await prisma.assemblyProcedureDocument.create({
    data: {
      name: `optional-settings-${randomUUID()}`,
      imageRelativePath: '/test/optional-settings.png',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      isActive: true
    }
  });
  const boltCount = options.boltCount ?? 2;
  const template = await new AssemblyTemplateService().create({
    modelCode: `OPTIONAL-${randomUUID()}`,
    procedurePattern: 'standard',
    name: 'Optional settings assembly',
    procedureDocumentId: document.id,
    traceabilityMode: 'REQUIRED',
    areas: [{
      sortOrder: 0,
      processNo: '1',
      areaCode: 'A',
      areaName: 'tightening',
      unitCode: 'U1',
      bolts: Array.from({ length: boltCount }, (_, index) => ({
        sortOrder: index,
        markerNo: index + 1,
        xRatio: 0.2 + index * 0.1,
        yRatio: 0.2,
        boltSpec: 'M10x35 SCM435 10.9',
        nominalDiameter: 'M10',
        boltLengthMm: 35,
        material: 'SCM435',
        strengthClass: '10.9',
        capabilityGroupId: wrench.groupId,
        lowerLimit: 28,
        nominalTorque: 30,
        upperLimit: 32,
        unit: 'N·m'
      }))
    }]
  });
  const session = await new AssemblyWorkSessionService().start({
    templateId: template.id,
    productNo: `OPTIONAL-PRODUCT-${randomUUID()}`,
    workId: `OPTIONAL-WORK-${randomUUID()}`,
    operatorNfcTagUid: employee.nfcTagUid!,
    requestId: `optional-assembly-start-${randomUUID()}`,
    targetUnit: 'OPTIONAL',
    clientDeviceId: client.id,
    clientDeviceNameSnapshot: client.name
  });
  return {
    ...wrench,
    client,
    employee,
    session,
    boltIds: template.areas[0]!.bolts.map((bolt) => bolt.id)
  };
}

async function createTrainingFixture(
  wrench: WrenchFixture,
  options: {
    client?: Awaited<ReturnType<typeof createTestClientDevice>>;
    employee?: Awaited<ReturnType<typeof createTestEmployee>>;
  } = {}
): Promise<TrainingFixture> {
  const client = options.client ?? await createTestClientDevice(`optional-training-${randomUUID()}`);
  const employee = options.employee ?? await createTestEmployee({
    displayName: 'Optional Training Operator',
    nfcTagUid: `OPTIONAL-TRAINING-TAG-${randomUUID()}`
  });
  const program = await new TorqueTrainingService().createProgram({
    code: `OPTIONAL-TRAINING-${randomUUID()}`,
    displayName: 'Optional settings training',
    nominalDiameter: 'M10',
    boltLengthMm: 35,
    material: 'SCM435',
    strengthClass: '10.9',
    capabilityGroupId: wrench.groupId,
    nominalTorque: 30,
    lowerLimit: 28,
    upperLimit: 32,
    unit: 'N-m',
    jigConditionCode: 'OPTIONAL-JIG',
    torqueWrenchProfileIds: [wrench.profileId]
  });
  return {
    ...wrench,
    client,
    employee,
    versionId: program.versions[0]!.id
  };
}

function kioskHeaders(client: Awaited<ReturnType<typeof createTestClientDevice>>) {
  return { 'x-client-key': client.apiKey, 'content-type': 'application/json' };
}

async function confirmAssemblyWrench(
  app: Awaited<ReturnType<typeof buildServer>>,
  fixture: AssemblyFixture
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/assembly/work-sessions/${fixture.session.id}/torque-wrench-confirmations`,
    headers: kioskHeaders(fixture.client),
    payload: {
      expectedTemplateBoltId: fixture.boltIds[0],
      torqueWrenchProfileId: fixture.profileId,
      physicalDisplayConfirmed: true
    }
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().confirmation).toMatchObject({
    torqueWrenchProfileId: fixture.profileId,
    settingHistoryId: null,
    settingVerificationMode: 'BOLT_CONDITION_ONLY'
  });
  return response.json().confirmation.id as string;
}

async function acquireAssemblyLease(
  app: Awaited<ReturnType<typeof buildServer>>,
  fixture: AssemblyFixture,
  confirmationId: string,
  requestId = `optional-assembly-lease-${randomUUID()}`
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/torque-wrenches/${fixture.profileId}/connection-lease/acquire`,
    headers: kioskHeaders(fixture.client),
    payload: {
      sessionId: fixture.session.id,
      confirmationId,
      requestId
    }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().lease).toMatchObject({
    state: 'owned_by_self',
    generation: expect.any(Number),
    leaseId: expect.any(String)
  });
  return response.json().lease as { leaseId: string; generation: number; state: string };
}

async function recordAssemblyAgent(
  app: Awaited<ReturnType<typeof buildServer>>,
  fixture: AssemblyFixture,
  input: {
    confirmationId: string;
    expectedTemplateBoltId: string;
    sourceEventKey: string;
    value: number;
    lease?: { leaseId: string; generation: number };
  }
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/assembly/work-sessions/${fixture.session.id}/record-torque`,
    headers: kioskHeaders(fixture.client),
    payload: {
      sourceEventKey: input.sourceEventKey,
      expectedTemplateBoltId: input.expectedTemplateBoltId,
      confirmationId: input.confirmationId,
      serialNumber: fixture.serialNumber,
      value: input.value,
      unit: 'N-m',
      rawPayload: { fixture: 'torque-wrench-optional-settings' },
      ...(input.lease
        ? {
            connectionLeaseId: input.lease.leaseId,
            connectionLeaseGeneration: input.lease.generation
          }
        : {})
    }
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe('torque-wrench optional settings route integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await resetOptionalSettingsRouteData();
  });

  afterAll(async () => {
    try {
      await resetOptionalSettingsRouteData();
    } finally {
      await app.close();
    }
  });

  it('runs a BOLT assembly through confirmation, connection, NG, and OK without setting history', async () => {
    const fixture = await createAssemblyFixture(await createBoltWrench());
    const confirmationId = await confirmAssemblyWrench(app, fixture);
    const lease = await acquireAssemblyLease(app, fixture, confirmationId);

    const ng = await recordAssemblyAgent(app, fixture, {
      confirmationId,
      expectedTemplateBoltId: fixture.boltIds[0]!,
      sourceEventKey: 'optional-assembly-ng',
      value: 40,
      lease
    });
    expect(ng.outcome).toMatchObject({
      kind: 'recorded_ng',
      movedToBoltId: fixture.boltIds[0]
    });

    const ok = await recordAssemblyAgent(app, fixture, {
      confirmationId,
      expectedTemplateBoltId: fixture.boltIds[0]!,
      sourceEventKey: 'optional-assembly-ok',
      value: 30,
      lease
    });
    expect(ok.outcome).toMatchObject({
      kind: 'accepted_ok',
      movedToBoltId: fixture.boltIds[1]
    });

    const nextBolt = await recordAssemblyAgent(app, fixture, {
      confirmationId,
      expectedTemplateBoltId: fixture.boltIds[1]!,
      sourceEventKey: 'optional-assembly-next-bolt',
      value: 30,
      lease
    });
    expect(nextBolt.outcome).toMatchObject({
      kind: 'accepted_ok',
      movedToBoltId: null
    });

    expect(await prisma.torqueWrenchSettingHistory.count({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).toBe(0);
    const records = await prisma.assemblyTorqueRecord.findMany({
      where: { sessionId: fixture.session.id },
      orderBy: { recordedAt: 'asc' }
    });
    expect(records).toHaveLength(3);
    expect(records.every((record) => (
      record.settingVerificationMode === 'BOLT_CONDITION_ONLY'
      && record.settingHistoryId === null
      && record.settingLowerLimitSnapshot === null
      && record.settingNominalTorqueSnapshot === null
      && record.settingUpperLimitSnapshot === null
      && record.settingUnitSnapshot === null
    ))).toBe(true);
  });

  it('continues BOLT assembly after an incompatible setting is added through the management API', async () => {
    const fixture = await createAssemblyFixture(await createBoltWrench(), { boltCount: 1 });
    const admin = await createTestUser('ADMIN');
    const confirmationId = await confirmAssemblyWrench(app, fixture);
    const setting = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${fixture.profileId}/settings`,
      headers: { ...createAuthHeader(admin.token), 'content-type': 'application/json' },
      payload: {
        lowerLimit: 40,
        nominalTorque: 45,
        upperLimit: 50,
        unit: 'N-m',
        reason: 'incompatible history must not block BOLT mode'
      }
    });
    expect(setting.statusCode).toBe(201);
    expect(await prisma.torqueWrenchSettingHistory.count({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).toBe(1);

    const lease = await acquireAssemblyLease(app, fixture, confirmationId);
    const recorded = await recordAssemblyAgent(app, fixture, {
      confirmationId,
      expectedTemplateBoltId: fixture.boltIds[0]!,
      sourceEventKey: 'optional-assembly-incompatible-history',
      value: 30,
      lease
    });
    expect(recorded.outcome).toMatchObject({ kind: 'accepted_ok' });
    const record = await prisma.assemblyTorqueRecord.findUniqueOrThrow({
      where: { id: recorded.outcome.torqueRecordId as string }
    });
    expect(record).toMatchObject({
      settingVerificationMode: 'BOLT_CONDITION_ONLY',
      settingHistoryId: null,
      settingLowerLimitSnapshot: null,
      settingNominalTorqueSnapshot: null,
      settingUpperLimitSnapshot: null,
      settingUnitSnapshot: null
    });
  });

  it('runs BOLT training preparation without history or a prior lease and completes five agent attempts', async () => {
    const fixture = await createTrainingFixture(await createBoltWrench());
    const headers = kioskHeaders(fixture.client);
    const started = await app.inject({
      method: 'POST',
      url: '/api/torque-training/sessions',
      headers,
      payload: {
        uid: fixture.employee.nfcTagUid,
        programVersionId: fixture.versionId,
        requestId: 'optional-training-session'
      }
    });
    expect(started.statusCode).toBe(201);
    const sessionId = started.json().session.id as string;

    const prepared = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${sessionId}/wrench-preparations`,
      headers,
      payload: {
        uid: fixture.employee.nfcTagUid,
        torqueWrenchProfileId: fixture.profileId,
        requestId: 'optional-training-preparation',
        physicalSettingConfirmed: true
      }
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().preparation).toMatchObject({
      torqueWrenchProfileId: fixture.profileId,
      settingHistoryId: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY',
      duplicate: false
    });
    const confirmationId = prepared.json().preparation.confirmationId as string;
    expect(await prisma.torqueWrenchSettingHistory.count({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).toBe(0);
    const preparationReplay = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${sessionId}/wrench-preparations`,
      headers,
      payload: {
        uid: fixture.employee.nfcTagUid,
        torqueWrenchProfileId: fixture.profileId,
        requestId: 'optional-training-preparation',
        physicalSettingConfirmed: true
      }
    });
    expect(preparationReplay.statusCode).toBe(200);
    expect(preparationReplay.json().preparation).toMatchObject({
      confirmationId,
      settingHistoryId: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY',
      duplicate: true
    });
    expect(await prisma.torqueTrainingWrenchPreparationRequest.count({
      where: { requestId: 'optional-training-preparation' }
    })).toBe(1);
    expect(await prisma.torqueTrainingWrenchConfirmation.count({
      where: { sessionId }
    })).toBe(1);
    expect(await prisma.torqueWrenchSettingHistory.count({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).toBe(0);
    expect(await prisma.torqueWrenchUsageLease.count({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).toBe(0);

    const leaseResponse = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${fixture.profileId}/usage-lease/acquire`,
      headers,
      payload: {
        sessionId,
        confirmationId,
        requestId: 'optional-training-agent-lease'
      }
    });
    expect(leaseResponse.statusCode).toBe(200);
    const lease = leaseResponse.json().lease as { leaseId: string; generation: number };
    expect(leaseResponse.json().lease).toMatchObject({
      state: 'owned_by_self',
      generation: 1,
      leaseId: expect.any(String)
    });

    for (let index = 0; index < 5; index += 1) {
      const attempt = await app.inject({
        method: 'POST',
        url: `/api/torque-training/sessions/${sessionId}/attempts/from-agent`,
        headers,
        payload: {
          sourceEventKey: `optional-training-attempt-${index + 1}`,
          confirmationId,
          torqueWrenchProfileId: fixture.profileId,
          serialNumber: fixture.serialNumber,
          value: 30,
          unit: 'N-m',
          connectionLeaseId: lease.leaseId,
          connectionLeaseGeneration: lease.generation
        }
      });
      expect(attempt.statusCode).toBe(200);
      expect(attempt.json().attempt).toMatchObject({
        accepted: true,
        attemptNo: index + 1,
        settingVerificationMode: 'BOLT_CONDITION_ONLY'
      });
    }

    expect(await prisma.torqueWrenchSettingHistory.count({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).toBe(0);
    const attempts = await prisma.torqueTrainingAttempt.findMany({
      where: { sessionId },
      orderBy: { attemptNo: 'asc' }
    });
    expect(attempts).toHaveLength(5);
    expect(attempts.every((attempt) => (
      attempt.accepted
      && attempt.settingVerificationMode === 'BOLT_CONDITION_ONLY'
      && attempt.settingHistoryId === null
      // Training target snapshots are distinct from setting-history evidence.
      // BOLT mode must retain the program target while leaving history unset.
      && attempt.lowerLimitSnapshot?.toString() === '28'
      && attempt.nominalTorqueSnapshot?.toString() === '30'
      && attempt.upperLimitSnapshot?.toString() === '32'
    ))).toBe(true);
    await expect(prisma.torqueTrainingSession.findUniqueOrThrow({ where: { id: sessionId } })).resolves.toMatchObject({
      status: 'COMPLETED'
    });
    await expect(prisma.torqueWrenchUsageLease.findUniqueOrThrow({
      where: { torqueWrenchProfileId: fixture.profileId }
    })).resolves.toMatchObject({ releasedAt: expect.any(Date), generation: 1 });
  });

  it('fences old A assembly confirmation across B training takeover and allows a fresh A retry', async () => {
    const wrench = await createBoltWrench();
    const assembly = await createAssemblyFixture(wrench, { boltCount: 1 });
    const training = await createTrainingFixture(wrench);
    const assemblyHeaders = kioskHeaders(assembly.client);
    const trainingHeaders = kioskHeaders(training.client);

    const oldAConfirmationId = await confirmAssemblyWrench(app, assembly);
    const oldALease = await acquireAssemblyLease(app, assembly, oldAConfirmationId, 'optional-handoff-a-lease');

    const startedB = await app.inject({
      method: 'POST',
      url: '/api/torque-training/sessions',
      headers: trainingHeaders,
      payload: {
        uid: training.employee.nfcTagUid,
        programVersionId: training.versionId,
        requestId: 'optional-handoff-b-session'
      }
    });
    expect(startedB.statusCode).toBe(201);
    const trainingSessionId = startedB.json().session.id as string;
    const preparedB = await app.inject({
      method: 'POST',
      url: `/api/torque-training/sessions/${trainingSessionId}/wrench-preparations`,
      headers: trainingHeaders,
      payload: {
        uid: training.employee.nfcTagUid,
        torqueWrenchProfileId: wrench.profileId,
        requestId: 'optional-handoff-b-preparation',
        physicalSettingConfirmed: true
      }
    });
    expect(preparedB.statusCode).toBe(201);
    const bConfirmationId = preparedB.json().preparation.confirmationId as string;

    const takeoverB = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${wrench.profileId}/usage-lease/takeover`,
      headers: trainingHeaders,
      payload: {
        sessionId: trainingSessionId,
        confirmationId: bConfirmationId,
        requestId: 'optional-handoff-b-takeover',
        physicalWrenchPresent: true,
        reason: 'training handoff'
      }
    });
    expect(takeoverB.statusCode).toBe(200);
    expect(takeoverB.json().lease).toMatchObject({
      state: 'handoff_wait',
      generation: 2,
      leaseId: expect.any(String)
    });

    const fencedOldToken = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${wrench.profileId}/connection-lease/renew`,
      headers: assemblyHeaders,
      payload: {
        sessionId: assembly.session.id,
        leaseId: oldALease.leaseId,
        generation: oldALease.generation
      }
    });
    expect(fencedOldToken.statusCode).toBe(409);
    expect(fencedOldToken.json().errorCode).toBe('TORQUE_WRENCH_LEASE_FENCED');

    const freshAConfirmationId = await confirmAssemblyWrench(app, assembly);
    const takeoverA = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${wrench.profileId}/connection-lease/takeover`,
      headers: assemblyHeaders,
      payload: {
        sessionId: assembly.session.id,
        confirmationId: freshAConfirmationId,
        requestId: 'optional-handoff-a-return',
        physicalWrenchPresent: true,
        reason: 'assembly handoff return'
      }
    });
    expect(takeoverA.statusCode).toBe(200);
    expect(takeoverA.json().lease).toMatchObject({
      state: 'handoff_wait',
      generation: 3,
      leaseId: expect.any(String)
    });
    const returnedLease = takeoverA.json().lease as { leaseId: string; generation: number };

    const sameRequestRetry = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${wrench.profileId}/connection-lease/acquire`,
      headers: assemblyHeaders,
      payload: {
        sessionId: assembly.session.id,
        confirmationId: freshAConfirmationId,
        requestId: 'optional-handoff-a-return'
      }
    });
    expect(sameRequestRetry.statusCode).toBe(200);
    expect(sameRequestRetry.json().lease).toMatchObject({
      state: 'handoff_wait',
      leaseId: returnedLease.leaseId,
      generation: returnedLease.generation
    });

    const oldConfirmationAcquire = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${wrench.profileId}/connection-lease/acquire`,
      headers: assemblyHeaders,
      payload: {
        sessionId: assembly.session.id,
        confirmationId: oldAConfirmationId,
        requestId: 'optional-handoff-old-a-retry'
      }
    });
    expect(oldConfirmationAcquire.statusCode).toBe(409);
    expect(oldConfirmationAcquire.json().errorCode).toBe('CONFIRMATION_REQUIRED');

    const recorded = await recordAssemblyAgent(app, assembly, {
      confirmationId: freshAConfirmationId,
      expectedTemplateBoltId: assembly.boltIds[0]!,
      sourceEventKey: 'optional-handoff-a-record',
      value: 30,
      lease: returnedLease
    });
    expect(recorded.outcome).toMatchObject({ kind: 'accepted_ok' });
    expect(await prisma.torqueWrenchSettingHistory.count({
      where: { torqueWrenchProfileId: wrench.profileId }
    })).toBe(0);
    await expect(prisma.torqueWrenchUsageLease.findUniqueOrThrow({
      where: { torqueWrenchProfileId: wrench.profileId }
    })).resolves.toMatchObject({
      generation: 3,
      ownerKind: 'ASSEMBLY',
      ownerAssemblySessionId: assembly.session.id,
      ownerClientDeviceId: assembly.client.id,
      adoptedConfirmationId: freshAConfirmationId,
      releasedAt: null
    });
  });
});
