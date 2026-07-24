import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyLotService } from '../../services/assembly/assembly-lot.service.js';
import { AssemblyTemplateService } from '../../services/assembly/assembly-template.service.js';
import { AssemblyWorkSessionService } from '../../services/assembly/assembly-work-session.service.js';
import {
  AssemblyTorqueTraceabilityService,
  TorqueWrenchMasterService
} from '../../services/torque-wrenches/index.js';
import { createAuthHeader, createTestClientDevice, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('torque wrench traceability API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await prisma.torqueWrenchConnectionLeaseHistory.deleteMany({});
    await prisma.torqueWrenchConnectionLease.deleteMany({});
    await prisma.assemblyTorqueRecord.deleteMany({});
    await prisma.assemblyTorqueWrenchConfirmation.deleteMany({});
    await prisma.assemblyWorkSession.deleteMany({});
    await prisma.assemblyLotSerial.deleteMany({});
    await prisma.assemblyLot.deleteMany({});
    await prisma.assemblyFormalIdentifierAssignment.deleteMany({});
    await prisma.assemblyWorkUnitComposition.deleteMany({});
    await prisma.assemblyWorkUnit.deleteMany({});
    await prisma.assemblyTemplateBolt.deleteMany({});
    await prisma.assemblyTemplateArea.deleteMany({});
    await prisma.assemblyTemplate.deleteMany({});
    await prisma.assemblyProcedureDocumentPage.deleteMany({});
    await prisma.assemblyProcedureDocument.deleteMany({});
    await prisma.torqueWrenchSettingHistory.deleteMany({});
    await prisma.torqueWrenchCapabilityGroupModel.deleteMany({});
    await prisma.torqueWrenchCapabilityGroup.deleteMany({});
    await prisma.torqueWrenchProfile.deleteMany({});
    await prisma.torqueWrenchModel.deleteMany({});
    await prisma.measuringInstrument.deleteMany({});
    await prisma.clientDevice.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('records the physical serial and setting, rejects wrong/stale inputs, and is idempotent', async () => {
    const admin = await createTestUser('ADMIN');
    const viewer = await createTestUser('VIEWER');
    const client = await createTestClientDevice();
    const adminHeaders = { ...createAuthHeader(admin.token), 'content-type': 'application/json' };

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/torque-wrench-models',
      headers: { ...createAuthHeader(viewer.token), 'content-type': 'application/json' },
      payload: {
        manufacturer: 'TOHNICHI',
        modelNumber: 'VIEWER-DENIED',
        torqueMinNm: 10,
        torqueMaxNm: 50
      }
    });
    expect(forbidden.statusCode).toBe(403);

    const modelResponse = await app.inject({
      method: 'POST',
      url: '/api/torque-wrench-models',
      headers: adminHeaders,
      payload: {
        manufacturer: '東日製作所',
        modelNumber: 'CEM3-BTLA-TEST',
        torqueMinNm: 10,
        torqueMaxNm: 50,
        resolutionNm: 0.01,
        outputProfile: 'fixture-v1'
      }
    });
    expect(modelResponse.statusCode).toBe(201);
    const modelId = modelResponse.json().model.id as string;

    const groupResponse = await app.inject({
      method: 'POST',
      url: '/api/torque-wrench-capability-groups',
      headers: adminHeaders,
      payload: {
        name: `M10-35-${randomUUID()}`,
        nominalDiameter: 'M10',
        boltLengthMm: 35,
        material: 'SCM435',
        strengthClass: '10.9',
        modelIds: [modelId]
      }
    });
    expect(groupResponse.statusCode).toBe(201);
    const capabilityGroupId = groupResponse.json().capabilityGroup.id as string;

    const profileResponse = await app.inject({
      method: 'POST',
      url: '/api/torque-wrenches',
      headers: adminHeaders,
      payload: {
        name: '東日 CEM3 テスト',
        managementNumber: `TW-${randomUUID()}`,
        modelId,
        serialNumber: 'SN 00-123',
        storageLocation: 'TalkPlazaF1',
        calibrationExpiryDate: '2027-07-17T00:00:00+09:00',
        status: 'AVAILABLE'
      }
    });
    expect(profileResponse.statusCode).toBe(201);
    const profileId = profileResponse.json().torqueWrench.id as string;

    const addSetting = () =>
      app.inject({
        method: 'POST',
        url: `/api/torque-wrenches/${profileId}/settings`,
        headers: adminHeaders,
        payload: { lowerLimit: 28, nominalTorque: 30, upperLimit: 32, unit: 'N-m', reason: '工程設定' }
      });
    const futureSetting = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profileId}/settings`,
      headers: adminHeaders,
      payload: {
        lowerLimit: 28,
        nominalTorque: 30,
        upperLimit: 32,
        unit: 'N-m',
        effectiveAt: '2099-01-01T00:00:00.000Z',
        reason: '未来の設定は即時の現在値とみなさない'
      }
    });
    expect(futureSetting.statusCode).toBe(400);
    expect((await addSetting()).statusCode).toBe(201);

    const secondProfileResponse = await app.inject({
      method: 'POST',
      url: '/api/torque-wrenches',
      headers: adminHeaders,
      payload: {
        name: '東日 CEM3 別個体',
        managementNumber: `TW-${randomUUID()}`,
        modelId,
        serialNumber: 'SN-OTHER-456',
        storageLocation: 'TalkPlazaF2',
        calibrationExpiryDate: '2027-07-17T00:00:00+09:00',
        status: 'AVAILABLE'
      }
    });
    expect(secondProfileResponse.statusCode).toBe(201);
    const secondProfileId = secondProfileResponse.json().torqueWrench.id as string;
    const secondSetting = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${secondProfileId}/settings`,
      headers: adminHeaders,
      payload: { lowerLimit: 28, nominalTorque: 30, upperLimit: 32, unit: 'N-m', reason: '別個体設定' }
    });
    expect(secondSetting.statusCode).toBe(201);

    const document = await prisma.assemblyProcedureDocument.create({
      data: {
        name: `traceability-${randomUUID()}`,
        imageRelativePath: '/test/traceability.png',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isActive: true
      }
    });
    const templateService = new AssemblyTemplateService();
    const preFeatureTemplate = await prisma.assemblyTemplate.create({
      data: {
        modelCode: 'LEGACY-NULL',
        procedurePattern: '旧形式',
        name: '旧形式NULL互換',
        procedureDocumentId: document.id
      }
    });
    expect(preFeatureTemplate.traceabilityMode).toBeNull();
    expect((await templateService.getById(preFeatureTemplate.id))?.traceabilityMode).toBe('LEGACY');

    const template = await templateService.create({
      modelCode: 'TRACE-001',
      procedurePattern: '標準',
      name: 'トルク追跡テスト',
      procedureDocumentId: document.id,
      traceabilityMode: 'REQUIRED',
      areas: [
        {
          sortOrder: 0,
          processNo: '1',
          areaCode: 'A',
          areaName: '締付',
          unitCode: 'U1',
          bolts: [1, 2].map((markerNo, index) => ({
            sortOrder: index,
            markerNo,
            xRatio: 0.2 + index * 0.1,
            yRatio: 0.2,
            boltSpec: 'M10x35 SCM435 10.9',
            nominalDiameter: 'M10',
            boltLengthMm: 35,
            material: 'SCM435',
            strengthClass: '10.9',
            capabilityGroupId,
            lowerLimit: 28,
            nominalTorque: 30,
            upperLimit: 32,
            unit: 'N·m'
          }))
        }
      ]
    });
    expect(template.areas[0].bolts[0].tighteningId).toMatch(/^TIGHTENING-1-/);

    const session = await new AssemblyWorkSessionService().start({
      templateId: template.id,
      productNo: 'TRACE-PRODUCT',
      serialNo: `TRACE-${randomUUID()}`,
      operatorNameSnapshot: '試験作業者',
      targetUnit: 'TRACE-001',
      clientDeviceId: client.id
    });
    expect(session.torqueWrenchId).toBe('');
    expect(
      (
        await prisma.assemblyWorkSession.findUniqueOrThrow({
          where: { id: session.id },
          select: { torqueWrenchId: true }
        })
      ).torqueWrenchId
    ).toBe('');

    const lot = await new AssemblyLotService().create({
      templateId: template.id,
      productNo: 'TRACE-LOT-PRODUCT',
      expectedQuantity: 1,
      serialNos: [`TRACE-LOT-${randomUUID()}`],
      operatorNameSnapshot: '試験作業者',
      targetUnit: 'TRACE-001',
      clientDeviceId: client.id
    });
    expect(lot.torqueWrenchId).toBe('');
    const kioskHeaders = { 'x-client-key': client.apiKey, 'content-type': 'application/json' };

    const compatible = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${session.id}/compatible-torque-wrenches`,
      headers: kioskHeaders
    });
    expect(compatible.statusCode).toBe(200);
    expect(compatible.json().torqueWrenches).toHaveLength(2);

    const confirm = async (expectedTemplateBoltId: string) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${session.id}/torque-wrench-confirmations`,
        headers: kioskHeaders,
        payload: { expectedTemplateBoltId, torqueWrenchProfileId: profileId, physicalDisplayConfirmed: true }
      });
      expect(response.statusCode).toBe(201);
      return response.json().confirmation.id as string;
    };

    const firstBoltId = template.areas[0].bolts[0].id;
    const firstConfirmationId = await confirm(firstBoltId);
    const currentConfirmations = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${session.id}/torque-wrench-confirmations/current`,
      headers: adminHeaders
    });
    expect(currentConfirmations.statusCode).toBe(200);
    expect(currentConfirmations.json().confirmations).toEqual([
      expect.objectContaining({ id: firstConfirmationId, serialNumber: 'SN 00-123', markerNo: 1 })
    ]);

    const wrongPhysical = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: kioskHeaders,
      payload: {
        sourceEventKey: 'evt-wrong-physical',
        expectedTemplateBoltId: firstBoltId,
        confirmationId: firstConfirmationId,
        serialNumber: 'SN-OTHER-456',
        value: 30,
        unit: 'N-m',
        rawPayload: { fixture: 'wrong-physical' }
      }
    });
    expect(wrongPhysical.statusCode).toBe(200);
    expect(wrongPhysical.json().outcome).toMatchObject({
      kind: 'rejected',
      rejectionReason: 'WRONG_PHYSICAL_WRENCH'
    });

    const wrongEvent = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: kioskHeaders,
      payload: {
        sourceEventKey: 'evt-wrong-serial',
        expectedTemplateBoltId: firstBoltId,
        confirmationId: firstConfirmationId,
        serialNumber: 'UNKNOWN-SERIAL',
        value: 30,
        unit: 'N-m',
        rawPayload: { fixture: 'wrong-serial' }
      }
    });
    expect(wrongEvent.statusCode).toBe(200);
    expect(wrongEvent.json().outcome).toMatchObject({ kind: 'rejected', rejectionReason: 'UNKNOWN_SERIAL_NUMBER' });

    const validPayload = {
      sourceEventKey: 'evt-valid-1',
      expectedTemplateBoltId: firstBoltId,
      confirmationId: firstConfirmationId,
      serialNumber: 'sn00-123',
      value: 30,
      unit: 'N·m',
      rawPayload: { fixture: 'valid' },
      deviceMemoryCounter: '101',
      deviceJudgement: 'OK'
    };
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: kioskHeaders,
      payload: validPayload
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().outcome.kind).toBe('accepted_ok');
    const acceptedRecordId = accepted.json().outcome.torqueRecordId as string;

    const replay = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: kioskHeaders,
      payload: validPayload
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().outcome.torqueRecordId).toBe(acceptedRecordId);
    expect(
      await prisma.assemblyTorqueRecord.count({
        where: { sourceClientDeviceId: client.id, sourceEventKey: 'evt-valid-1' }
      })
    ).toBe(1);
    expect(
      await prisma.assemblyTorqueAgentEvent.count({
        where: { sourceClientDeviceId: client.id, sourceEventKey: 'evt-valid-1' }
      })
    ).toBe(1);

    const otherSession = await new AssemblyWorkSessionService().start({
      templateId: template.id,
      productNo: 'TRACE-PRODUCT-OTHER',
      serialNo: `TRACE-OTHER-${randomUUID()}`,
      operatorNameSnapshot: '別作業者',
      targetUnit: 'TRACE-001',
      clientDeviceId: client.id
    });
    const crossSessionReplay = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${otherSession.id}/record-torque`,
      headers: kioskHeaders,
      payload: validPayload
    });
    expect(crossSessionReplay.statusCode).toBe(409);
    expect(crossSessionReplay.json().errorCode).toBe('EVENT_SESSION_MISMATCH');

    const secondBoltId = template.areas[0].bolts[1].id;
    const reusableConfirmations = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${session.id}/torque-wrench-confirmations/current`,
      headers: kioskHeaders
    });
    expect(reusableConfirmations.statusCode).toBe(200);
    expect(reusableConfirmations.json().confirmations).toEqual([
      expect.objectContaining({
        id: firstConfirmationId,
        torqueWrenchProfileId: profileId,
        markerNo: 2
      })
    ]);

    const reusedConfirmation = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: kioskHeaders,
      payload: {
        sourceEventKey: 'evt-reused-confirmation',
        expectedTemplateBoltId: secondBoltId,
        confirmationId: firstConfirmationId,
        serialNumber: 'SN 00-123',
        value: 27,
        unit: 'N-m',
        rawPayload: { fixture: 'reused-confirmation' }
      }
    });
    expect(reusedConfirmation.statusCode).toBe(200);
    expect(reusedConfirmation.json().outcome.kind).toBe('recorded_ng');

    expect((await addSetting()).statusCode).toBe(201);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque`,
      headers: kioskHeaders,
      payload: {
        sourceEventKey: 'evt-stale-setting',
        expectedTemplateBoltId: secondBoltId,
        confirmationId: firstConfirmationId,
        serialNumber: 'SN 00-123',
        value: 30,
        unit: 'N-m',
        rawPayload: { fixture: 'stale-setting' }
      }
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json().outcome).toMatchObject({ kind: 'rejected', rejectionReason: 'CONFIRMATION_STALE' });

    const currentConfirmationId = await confirm(secondBoltId);
    const forbiddenOverride = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque-override`,
      headers: { ...createAuthHeader(viewer.token), 'content-type': 'application/json' },
      payload: { confirmationId: currentConfirmationId, value: 30, unit: 'N-m', reason: '権限試験' }
    });
    expect(forbiddenOverride.statusCode).toBe(403);
    const override = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${session.id}/record-torque-override`,
      headers: adminHeaders,
      payload: { confirmationId: currentConfirmationId, value: 30, unit: 'N-m', reason: '通信障害の監査付き代替入力' }
    });
    expect(override.statusCode).toBe(200);
    expect(override.json().outcome.kind).toBe('accepted_ok');
    const overrideRecord = await prisma.assemblyTorqueRecord.findUniqueOrThrow({
      where: { id: override.json().outcome.torqueRecordId as string }
    });
    expect(overrideRecord).toMatchObject({
      overrideActorUserId: admin.user.id,
      overrideActorUsername: admin.user.username,
      overrideReason: '通信障害の監査付き代替入力'
    });

    const stored = await prisma.assemblyTorqueRecord.findUniqueOrThrow({ where: { id: acceptedRecordId } });
    expect(stored).toMatchObject({
      serialNumberSnapshot: 'SN 00-123',
      manufacturerSnapshot: '東日製作所',
      modelNumberSnapshot: 'CEM3-BTLA-TEST',
      settingUnitSnapshot: 'N·m',
      accepted: true
    });
    expect(stored.settingNominalTorqueSnapshot?.toString()).toBe('30');
  });

  it('reuses an adopted physical confirmation across work IDs, lots, and start-origin terminals', async () => {
    const master = new TorqueWrenchMasterService();
    const stonebase = await createTestClientDevice();
    const assembly = await createTestClientDevice();
    await prisma.clientDevice.update({
      where: { id: stonebase.id },
      data: { name: 'StoneBase', location: '1F' }
    });
    await prisma.clientDevice.update({
      where: { id: assembly.id },
      data: { name: 'Assembly-01', location: '2F' }
    });
    const admin = await createTestUser('ADMIN');
    const adminHeaders = { ...createAuthHeader(admin.token), 'content-type': 'application/json' };
    const assemblyHeaders = { 'x-client-key': assembly.apiKey, 'content-type': 'application/json' };

    const model = await master.createModel({
      manufacturer: 'TOHNICHI',
      modelNumber: `CROSS-WORK-${randomUUID()}`,
      torqueMinNm: 10,
      torqueMaxNm: 50
    });
    const group = await master.createCapabilityGroup({
      name: `CROSS-WORK-GROUP-${randomUUID()}`,
      nominalDiameter: 'M10',
      boltLengthMm: 35,
      material: 'SCM435',
      strengthClass: '10.9',
      modelIds: [model.id]
    });
    const profile = await master.createProfile({
      name: 'cross-work fixture',
      managementNumber: `CROSS-WORK-${randomUUID()}`,
      modelId: model.id,
      serialNumber: `CROSS-WORK-SERIAL-${randomUUID()}`,
      storageLocation: 'TalkPlazaF1',
      calibrationExpiryDate: new Date('2099-01-01T00:00:00.000Z')
    });
    await master.addSetting(profile.id, {
      lowerLimit: 28,
      nominalTorque: 30,
      upperLimit: 32,
      unit: 'N-m'
    });
    const document = await prisma.assemblyProcedureDocument.create({
      data: {
        name: `cross-work-${randomUUID()}`,
        imageRelativePath: '/test/cross-work.png',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isActive: true
      }
    });
    const template = await new AssemblyTemplateService().create({
      modelCode: `CROSS-${randomUUID()}`,
      procedurePattern: 'standard',
      name: 'cross-work confirmation fixture',
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
          boltSpec: 'M10x35 SCM435 10.9',
          nominalDiameter: 'M10',
          boltLengthMm: 35,
          material: 'SCM435',
          strengthClass: '10.9',
          capabilityGroupId: group.id,
          lowerLimit: 28,
          nominalTorque: 30,
          upperLimit: 32,
          unit: 'N-m'
        }]
      }]
    });
    const lotService = new AssemblyLotService();
    const lots = await Promise.all(['D26IIII', 'D26HHHH'].map((workId, index) =>
      lotService.create({
        templateId: template.id,
        productNo: `CROSS-LOT-${index + 1}`,
        expectedQuantity: 1,
        workIds: [`${workId}-${randomUUID()}`],
        operatorNameSnapshot: `operator-${index + 1}`,
        targetUnit: 'CROSS',
        clientDeviceId: stonebase.id,
        clientDeviceNameSnapshot: 'StoneBase'
      })
    ));
    const sessions = await Promise.all(lots.map((lot) =>
      lotService.startSerial({
        lotId: lot.id,
        lotSerialId: lot.serials[0]!.id,
        clientDeviceId: stonebase.id,
        clientDeviceNameSnapshot: 'StoneBase'
      })
    ));
    const boltId = template.areas[0]!.bolts[0]!.id;

    const compatible = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${sessions[0]!.id}/compatible-torque-wrenches`,
      headers: assemblyHeaders
    });
    expect(compatible.statusCode).toBe(200);
    expect(compatible.json().torqueWrenches).toHaveLength(1);
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessions[0]!.id}/torque-wrench-confirmations`,
      headers: assemblyHeaders,
      payload: {
        expectedTemplateBoltId: boltId,
        torqueWrenchProfileId: profile.id,
        physicalDisplayConfirmed: true
      }
    });
    expect(confirmed.statusCode).toBe(201);
    let confirmationId = confirmed.json().confirmation.id as string;

    const acquire = async (sessionId: string, requestId: string) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/torque-wrenches/${profile.id}/connection-lease/acquire`,
        headers: assemblyHeaders,
        payload: { sessionId, confirmationId, requestId }
      });
      expect(response.statusCode).toBe(200);
      return response.json().lease as { leaseId: string; generation: number };
    };
    const release = async (sessionId: string, lease: { leaseId: string; generation: number }) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/torque-wrenches/${profile.id}/connection-lease/release`,
        headers: assemblyHeaders,
        payload: { sessionId, ...lease, reason: 'switch work ID' }
      });
      expect(response.statusCode).toBe(200);
    };
    const record = (sessionId: string, eventKey: string, lease?: { leaseId: string; generation: number }) =>
      app.inject({
        method: 'POST',
        url: `/api/assembly/work-sessions/${sessionId}/record-torque`,
        headers: assemblyHeaders,
        payload: {
          sourceEventKey: eventKey,
          expectedTemplateBoltId: boltId,
          confirmationId,
          serialNumber: profile.serialNumber,
          value: 30,
          unit: 'N-m',
          rawPayload: { eventKey },
          ...(lease
            ? {
                connectionLeaseId: lease.leaseId,
                connectionLeaseGeneration: lease.generation
              }
            : {})
        }
      });

    const firstLease = await acquire(sessions[0]!.id, 'cross-work-first');
    const reconfirmed = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessions[0]!.id}/torque-wrench-confirmations`,
      headers: assemblyHeaders,
      payload: {
        expectedTemplateBoltId: boltId,
        torqueWrenchProfileId: profile.id,
        physicalDisplayConfirmed: true
      }
    });
    expect(reconfirmed.statusCode).toBe(201);
    confirmationId = reconfirmed.json().confirmation.id as string;
    const readoptedLease = await acquire(sessions[0]!.id, 'cross-work-readopt');
    expect(readoptedLease).toMatchObject({
      leaseId: firstLease.leaseId,
      generation: firstLease.generation
    });
    expect(await prisma.torqueWrenchConnectionLeaseHistory.findMany({
      where: { torqueWrenchProfileId: profile.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, generation: true, adoptedConfirmationId: true }
    })).toEqual([
      { action: 'ACQUIRED', generation: 1, adoptedConfirmationId: confirmed.json().confirmation.id },
      { action: 'CONFIRMATION_ADOPTED', generation: 1, adoptedConfirmationId: confirmationId }
    ]);
    const firstRecord = await record(sessions[0]!.id, 'cross-work-first-record', readoptedLease);
    expect(firstRecord.statusCode).toBe(200);
    expect(firstRecord.json().outcome.kind).toBe('accepted_ok');
    await release(sessions[0]!.id, readoptedLease);

    const listSecondSessionConfirmations = () =>
      app.inject({
        method: 'GET',
        url: `/api/assembly/work-sessions/${sessions[1]!.id}/torque-wrench-confirmations/current`,
        headers: assemblyHeaders
      });
    await master.updateProfile(profile.id, { status: 'MAINTENANCE' });
    expect((await listSecondSessionConfirmations()).json().confirmations).toEqual([]);
    await master.updateProfile(profile.id, {
      status: 'AVAILABLE',
      calibrationExpiryDate: new Date('2020-01-01T00:00:00.000Z')
    });
    expect((await listSecondSessionConfirmations()).json().confirmations).toEqual([]);
    await master.updateProfile(profile.id, {
      calibrationExpiryDate: new Date('2099-01-01T00:00:00.000Z')
    });
    await prisma.assemblyTemplateBolt.update({
      where: { id: boltId },
      data: { upperLimit: 31 }
    });
    expect((await listSecondSessionConfirmations()).json().confirmations).toEqual([]);
    await prisma.assemblyTemplateBolt.update({
      where: { id: boltId },
      data: { upperLimit: 32 }
    });

    const reusable = await listSecondSessionConfirmations();
    expect(reusable.statusCode).toBe(200);
    expect(reusable.json().confirmations).toEqual([
      expect.objectContaining({ id: confirmationId, torqueWrenchProfileId: profile.id })
    ]);
    const adminSessionOnly = await app.inject({
      method: 'GET',
      url: `/api/assembly/work-sessions/${sessions[1]!.id}/torque-wrench-confirmations/current`,
      headers: adminHeaders
    });
    expect(adminSessionOnly.statusCode).toBe(200);
    expect(adminSessionOnly.json().confirmations).toEqual([]);
    const crossSessionOverride = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${sessions[1]!.id}/record-torque-override`,
      headers: adminHeaders,
      payload: {
        confirmationId,
        value: 30,
        unit: 'N-m',
        reason: 'cross-session override must remain forbidden'
      }
    });
    expect(crossSessionOverride.statusCode).toBe(409);
    expect(crossSessionOverride.json().errorCode).toBe('CONFIRMATION_REQUIRED');

    const tokenlessCrossTerminal = await record(sessions[1]!.id, 'cross-work-tokenless');
    expect(tokenlessCrossTerminal.statusCode).toBe(403);
    expect(tokenlessCrossTerminal.json().errorCode).toBe('SESSION_CLIENT_MISMATCH');

    const secondLease = await acquire(sessions[1]!.id, 'cross-work-second');
    const secondRecord = await record(sessions[1]!.id, 'cross-work-second-record', secondLease);
    expect(secondRecord.statusCode).toBe(200);
    expect(secondRecord.json().outcome.kind).toBe('accepted_ok');
    const stored = await prisma.assemblyTorqueRecord.findUniqueOrThrow({
      where: { id: secondRecord.json().outcome.torqueRecordId as string }
    });
    expect(stored).toMatchObject({
      sessionId: sessions[1]!.id,
      confirmationId,
      sourceClientDeviceId: assembly.id,
      connectionLeaseId: secondLease.leaseId,
      connectionLeaseGeneration: secondLease.generation
    });
    expect(await prisma.torqueWrenchProfile.findUniqueOrThrow({
      where: { id: profile.id },
      select: { connectionLeaseEnforcedAt: true }
    })).toEqual({ connectionLeaseEnforcedAt: null });
    await release(sessions[1]!.id, secondLease);
  });

  it('serializes two-terminal acquisition, fences old generations, and accepts only current-generation events', async () => {
    const master = new TorqueWrenchMasterService();
    const traceability = new AssemblyTorqueTraceabilityService();
    const clientA = await createTestClientDevice();
    const clientB = await createTestClientDevice();
    await prisma.clientDevice.update({
      where: { id: clientA.id },
      data: { name: 'StoneBase', location: '1F' }
    });
    await prisma.clientDevice.update({
      where: { id: clientB.id },
      data: { name: 'Assembly-01', location: '2F' }
    });

    const model = await master.createModel({
      manufacturer: 'TOHNICHI',
      modelNumber: `LEASE-${randomUUID()}`,
      torqueMinNm: 10,
      torqueMaxNm: 50
    });
    const group = await master.createCapabilityGroup({
      name: `LEASE-GROUP-${randomUUID()}`,
      nominalDiameter: 'M10',
      boltLengthMm: 35,
      material: 'SCM435',
      strengthClass: '10.9',
      modelIds: [model.id]
    });
    const profile = await master.createProfile({
      name: 'lease fixture',
      managementNumber: `LEASE-${randomUUID()}`,
      modelId: model.id,
      serialNumber: `LEASE-SERIAL-${randomUUID()}`,
      storageLocation: 'TalkPlazaF1',
      calibrationExpiryDate: new Date('2099-01-01T00:00:00.000Z')
    });
    await master.addSetting(profile.id, {
      lowerLimit: 28,
      nominalTorque: 30,
      upperLimit: 32,
      unit: 'N-m'
    });
    const document = await prisma.assemblyProcedureDocument.create({
      data: {
        name: `lease-${randomUUID()}`,
        imageRelativePath: '/test/lease.png',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isActive: true
      }
    });
    const template = await new AssemblyTemplateService().create({
      modelCode: `LEASE-${randomUUID()}`,
      procedurePattern: 'standard',
      name: 'connection lease fixture',
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
          boltSpec: 'M10x35 SCM435 10.9',
          nominalDiameter: 'M10',
          boltLengthMm: 35,
          material: 'SCM435',
          strengthClass: '10.9',
          capabilityGroupId: group.id,
          lowerLimit: 28,
          nominalTorque: 30,
          upperLimit: 32,
          unit: 'N-m'
        }]
      }]
    });
    const sessions = await Promise.all([clientA, clientB].map((client, index) =>
      new AssemblyWorkSessionService().start({
        templateId: template.id,
        productNo: `LEASE-PRODUCT-${index}`,
        serialNo: `LEASE-WORK-${randomUUID()}`,
        operatorNameSnapshot: `operator-${index}`,
        targetUnit: 'LEASE',
        clientDeviceId: client.id,
        clientDeviceNameSnapshot: client.name
      })
    ));
    const boltId = template.areas[0]!.bolts[0]!.id;
    const confirmations = await Promise.all(sessions.map((session, index) =>
      traceability.confirm({
        sessionId: session.id,
        clientDeviceId: [clientA, clientB][index]!.id,
        clientDeviceName: [clientA, clientB][index]!.name,
        expectedTemplateBoltId: boltId,
        torqueWrenchProfileId: profile.id,
        physicalDisplayConfirmed: true
      })
    ));
    const actors = [
      { client: clientA, session: sessions[0]!, confirmation: confirmations[0]! },
      { client: clientB, session: sessions[1]!, confirmation: confirmations[1]! }
    ];
    const acquire = (actor: typeof actors[number], requestId: string) => app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/acquire`,
      headers: { 'x-client-key': actor.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: actor.session.id,
        confirmationId: actor.confirmation.id,
        requestId
      }
    });

    const confirmationFromOtherTerminal = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/acquire`,
      headers: { 'x-client-key': actors[0]!.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: actors[0]!.session.id,
        confirmationId: actors[1]!.confirmation.id,
        requestId: 'confirmation-from-other-terminal'
      }
    });
    expect(confirmationFromOtherTerminal.statusCode).toBe(409);
    expect(confirmationFromOtherTerminal.json().errorCode).toBe('CONFIRMATION_REQUIRED');

    const simultaneous = await Promise.all([
      acquire(actors[0]!, 'acquire-a'),
      acquire(actors[1]!, 'acquire-b')
    ]);
    expect(simultaneous.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winnerIndex = simultaneous.findIndex((response) => response.statusCode === 200);
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = actors[winnerIndex]!;
    const loser = actors[loserIndex]!;
    const firstLease = simultaneous[winnerIndex]!.json().lease as {
      leaseId: string;
      generation: number;
    };
    expect(firstLease.generation).toBe(1);
    expect(await prisma.torqueWrenchConnectionLease.findUniqueOrThrow({
      where: { torqueWrenchProfileId: profile.id },
      select: { adoptedConfirmationId: true }
    })).toEqual({ adoptedConfirmationId: winner.confirmation.id });

    const hiddenOwner = await app.inject({
      method: 'GET',
      url: `/api/torque-wrenches/${profile.id}/connection-lease`,
      headers: { 'x-client-key': loser.client.apiKey }
    });
    expect(hiddenOwner.statusCode).toBe(200);
    expect(hiddenOwner.json().lease).toMatchObject({
      state: 'owned_by_other',
      owner: { clientDeviceName: winnerIndex === 0 ? 'StoneBase' : 'Assembly-01' }
    });
    expect(hiddenOwner.json().lease.owner).not.toHaveProperty('clientDeviceId');
    expect(hiddenOwner.json().lease.owner).not.toHaveProperty('sessionId');
    expect(hiddenOwner.json().lease).not.toHaveProperty('leaseId');
    expect(hiddenOwner.json().lease).not.toHaveProperty('generation');

    const staleTakeover = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/takeover`,
      headers: { 'x-client-key': loser.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: loser.session.id,
        confirmationId: loser.confirmation.id,
        requestId: 'stale-physical-takeover',
        physicalWrenchPresent: true,
        reason: 'stale destination confirmation must not be adopted'
      }
    });
    expect(staleTakeover.statusCode).toBe(409);
    expect(staleTakeover.json().errorCode).toBe('CONFIRMATION_REQUIRED');

    const renewed = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/renew`,
      headers: { 'x-client-key': winner.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: winner.session.id,
        leaseId: firstLease.leaseId,
        generation: firstLease.generation
      }
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().lease.generation).toBe(1);
    const nonOwnerRelease = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/release`,
      headers: { 'x-client-key': loser.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: loser.session.id,
        leaseId: firstLease.leaseId,
        generation: firstLease.generation,
        reason: 'malicious non-owner release'
      }
    });
    expect(nonOwnerRelease.statusCode).toBe(409);
    expect(nonOwnerRelease.json().errorCode).toBe('TORQUE_WRENCH_LEASE_OWNER_MISMATCH');

    const freshLoserConfirmation = await traceability.confirm({
      sessionId: loser.session.id,
      clientDeviceId: loser.client.id,
      clientDeviceName: loser.client.name,
      expectedTemplateBoltId: boltId,
      torqueWrenchProfileId: profile.id,
      physicalDisplayConfirmed: true
    });
    const firstLeaseRow = await prisma.torqueWrenchConnectionLease.findUniqueOrThrow({
      where: { torqueWrenchProfileId: profile.id },
      select: { acquiredAt: true }
    });
    if (freshLoserConfirmation.confirmedAt.getTime() <= firstLeaseRow.acquiredAt.getTime()) {
      freshLoserConfirmation.confirmedAt = new Date(firstLeaseRow.acquiredAt.getTime() + 1);
      await prisma.assemblyTorqueWrenchConfirmation.update({
        where: { id: freshLoserConfirmation.id },
        data: { confirmedAt: freshLoserConfirmation.confirmedAt }
      });
    }
    loser.confirmation = freshLoserConfirmation;
    const takeover = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/takeover`,
      headers: { 'x-client-key': loser.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: loser.session.id,
        confirmationId: loser.confirmation.id,
        requestId: 'physical-takeover',
        physicalWrenchPresent: true,
        reason: 'physical wrench is at this terminal'
      }
    });
    expect(takeover.statusCode).toBe(200);
    expect(takeover.json().lease).toMatchObject({ state: 'handoff_wait', generation: 2 });
    expect(await prisma.torqueWrenchConnectionLease.findUniqueOrThrow({
      where: { torqueWrenchProfileId: profile.id },
      select: { adoptedConfirmationId: true }
    })).toEqual({ adoptedConfirmationId: loser.confirmation.id });
    expect(new Date(takeover.json().lease.connectAfter).getTime()).toBeGreaterThan(Date.now());
    const secondLease = takeover.json().lease as { leaseId: string; generation: number };

    const fencedRenew = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/renew`,
      headers: { 'x-client-key': winner.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: winner.session.id,
        leaseId: firstLease.leaseId,
        generation: firstLease.generation
      }
    });
    expect(fencedRenew.statusCode).toBe(409);
    expect(fencedRenew.json().errorCode).toBe('TORQUE_WRENCH_LEASE_FENCED');

    const manager = await createTestUser('MANAGER');
    const viewer = await createTestUser('VIEWER');
    const activationPayload = { reason: 'two-terminal Release B acceptance completed' };
    const activationUrl = `/api/torque-wrenches/${profile.id}/connection-lease/enforcement/enable`;
    const activationBlocked = await app.inject({
      method: 'POST',
      url: activationUrl,
      headers: { ...createAuthHeader(manager.token), 'content-type': 'application/json' },
      payload: activationPayload
    });
    expect(activationBlocked.statusCode).toBe(409);
    expect(activationBlocked.json().errorCode).toBe('TORQUE_CONNECTION_LEASE_ACTIVATION_DISABLED');
    const activationForbidden = await app.inject({
      method: 'POST',
      url: activationUrl,
      headers: { ...createAuthHeader(viewer.token), 'content-type': 'application/json' },
      payload: activationPayload
    });
    expect(activationForbidden.statusCode).toBe(403);
    const previousActivationGate = env.TORQUE_CONNECTION_LEASE_ACTIVATION_ALLOWED;
    env.TORQUE_CONNECTION_LEASE_ACTIVATION_ALLOWED = true;
    try {
      const activated = await app.inject({
        method: 'POST',
        url: activationUrl,
        headers: { ...createAuthHeader(manager.token), 'content-type': 'application/json' },
        payload: activationPayload
      });
      expect(activated.statusCode).toBe(200);
      expect(activated.json().torqueWrench).toMatchObject({
        connectionLeaseEnforcementReason: activationPayload.reason,
        connectionLeaseEnforcedByUserId: manager.user.id,
        connectionLeaseEnforcedByUsername: manager.user.username
      });
      const firstEnforcedAt = activated.json().torqueWrench.connectionLeaseEnforcedAt;
      const repeated = await app.inject({
        method: 'POST',
        url: activationUrl,
        headers: { ...createAuthHeader(manager.token), 'content-type': 'application/json' },
        payload: { reason: 'must not overwrite the activation audit' }
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().torqueWrench).toMatchObject({
        connectionLeaseEnforcedAt: firstEnforcedAt,
        connectionLeaseEnforcementReason: activationPayload.reason
      });
    } finally {
      env.TORQUE_CONNECTION_LEASE_ACTIVATION_ALLOWED = previousActivationGate;
    }
    const noDisableApi = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/enforcement/disable`,
      headers: { ...createAuthHeader(manager.token), 'content-type': 'application/json' },
      payload: { reason: 'not supported' }
    });
    expect(noDisableApi.statusCode).toBe(404);
    const torquePayload = (actor: typeof winner, sourceEventKey: string, lease?: { leaseId: string; generation: number }) => ({
      sourceEventKey,
      expectedTemplateBoltId: boltId,
      confirmationId: actor.confirmation.id,
      serialNumber: profile.serialNumber,
      value: 30,
      unit: 'N-m',
      rawPayload: { sourceEventKey },
      ...(lease
        ? { connectionLeaseId: lease.leaseId, connectionLeaseGeneration: lease.generation }
        : {})
    });
    const missingLease = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${winner.session.id}/record-torque`,
      headers: { 'x-client-key': winner.client.apiKey, 'content-type': 'application/json' },
      payload: torquePayload(winner, 'missing-lease')
    });
    expect(missingLease.statusCode).toBe(200);
    expect(missingLease.json().outcome).toMatchObject({
      kind: 'rejected',
      rejectionReason: 'CONNECTION_LEASE_REQUIRED'
    });
    const fencedEvent = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${winner.session.id}/record-torque`,
      headers: { 'x-client-key': winner.client.apiKey, 'content-type': 'application/json' },
      payload: torquePayload(winner, 'old-generation', firstLease)
    });
    expect(fencedEvent.statusCode).toBe(200);
    expect(fencedEvent.json().outcome).toMatchObject({
      kind: 'rejected',
      rejectionReason: 'CONNECTION_LEASE_FENCED'
    });
    const ownerMismatch = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${winner.session.id}/record-torque`,
      headers: { 'x-client-key': winner.client.apiKey, 'content-type': 'application/json' },
      payload: torquePayload(winner, 'wrong-owner', secondLease)
    });
    expect(ownerMismatch.statusCode).toBe(200);
    expect(ownerMismatch.json().outcome).toMatchObject({
      kind: 'rejected',
      rejectionReason: 'CONNECTION_LEASE_OWNER_MISMATCH'
    });
    await prisma.assemblyWorkSession.update({
      where: { id: winner.session.id },
      data: { clientDeviceId: loser.client.id }
    });
    const sessionMismatch = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${winner.session.id}/record-torque`,
      headers: { 'x-client-key': loser.client.apiKey, 'content-type': 'application/json' },
      payload: torquePayload(winner, 'wrong-session', secondLease)
    });
    expect(sessionMismatch.statusCode).toBe(200);
    expect(sessionMismatch.json().outcome).toMatchObject({
      kind: 'rejected',
      rejectionReason: 'CONNECTION_LEASE_SESSION_MISMATCH'
    });
    await prisma.assemblyWorkSession.update({
      where: { id: winner.session.id },
      data: { clientDeviceId: winner.client.id }
    });

    await prisma.torqueWrenchConnectionLease.update({
      where: { torqueWrenchProfileId: profile.id },
      data: { expiresAt: new Date(Date.now() - 1_000), connectAfter: new Date(Date.now() - 1_000) }
    });
    const delayedCurrentGeneration = await app.inject({
      method: 'POST',
      url: `/api/assembly/work-sessions/${loser.session.id}/record-torque`,
      headers: { 'x-client-key': loser.client.apiKey, 'content-type': 'application/json' },
      payload: torquePayload(loser, 'delayed-current-generation', secondLease)
    });
    expect(delayedCurrentGeneration.statusCode).toBe(200);
    expect(delayedCurrentGeneration.json().outcome.kind).toBe('accepted_ok');
    const storedDelayed = await prisma.assemblyTorqueRecord.findUniqueOrThrow({
      where: { id: delayedCurrentGeneration.json().outcome.torqueRecordId as string }
    });
    expect(storedDelayed).toMatchObject({
      connectionLeaseId: secondLease.leaseId,
      connectionLeaseGeneration: 2
    });

    winner.confirmation = await traceability.confirm({
      sessionId: winner.session.id,
      clientDeviceId: winner.client.id,
      clientDeviceName: winner.client.name,
      expectedTemplateBoltId: boltId,
      torqueWrenchProfileId: profile.id,
      physicalDisplayConfirmed: true
    });
    const expiredAcquire = await acquire(winner, 'expired-acquire');
    expect(expiredAcquire.statusCode).toBe(200);
    expect(expiredAcquire.json().lease.generation).toBe(3);
    const thirdLease = expiredAcquire.json().lease as { leaseId: string; generation: number };
    const released = await app.inject({
      method: 'POST',
      url: `/api/torque-wrenches/${profile.id}/connection-lease/release`,
      headers: { 'x-client-key': winner.client.apiKey, 'content-type': 'application/json' },
      payload: {
        sessionId: winner.session.id,
        leaseId: thirdLease.leaseId,
        generation: thirdLease.generation,
        reason: 'test complete'
      }
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().lease.state).toBe('available');
    await master.addSetting(profile.id, {
      lowerLimit: 28,
      nominalTorque: 30,
      upperLimit: 32,
      unit: 'N-m',
      reason: 'invalidate the previous terminal confirmation'
    });
    const staleSettingConfirmation = await acquire(winner, 'stale-setting-confirmation');
    expect(staleSettingConfirmation.statusCode).toBe(409);
    expect(staleSettingConfirmation.json().errorCode).toBe('CONFIRMATION_REQUIRED');
    expect(await prisma.torqueWrenchConnectionLeaseHistory.findMany({
      where: { torqueWrenchProfileId: profile.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, generation: true }
    })).toEqual([
      { action: 'ACQUIRED', generation: 1 },
      { action: 'TAKEN_OVER', generation: 2 },
      { action: 'EXPIRED_ACQUIRED', generation: 3 },
      { action: 'RELEASED', generation: 3 }
    ]);
  });
});
