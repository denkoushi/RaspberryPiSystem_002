import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyTemplateService } from '../../services/assembly/assembly-template.service.js';
import { AssemblyWorkSessionService } from '../../services/assembly/assembly-work-session.service.js';
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
    await prisma.assemblyTorqueRecord.deleteMany({});
    await prisma.assemblyTorqueWrenchConfirmation.deleteMany({});
    await prisma.assemblyWorkSession.deleteMany({});
    await prisma.assemblySerialRegistry.deleteMany({});
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
    const template = await new AssemblyTemplateService().create({
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
});
