import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createTestClientDevice, createTestEmployee } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

async function cleanSelfInspectionTables() {
  await prisma.selfInspectionMeasurementOperation.deleteMany({});
  await prisma.selfInspectionMeasurementActorAuthentication.deleteMany({});
  await prisma.selfInspectionInspectorMeasurementValue.deleteMany({});
  await prisma.selfInspectionInspectorEntry.deleteMany({});
  await prisma.selfInspectionMeasurementValue.deleteMany({});
  await prisma.selfInspectionLotEntryInstrumentUsage.deleteMany({});
  await prisma.selfInspectionLotEntry.deleteMany({});
  await prisma.selfInspectionRecordApproval.deleteMany({});
  await prisma.selfInspectionSession.deleteMany({});
  await prisma.partMeasurementTemplate.deleteMany({});
}

async function createSession(input: { valueKind?: 'NUMERIC' | 'JUDGEMENT' } = {}) {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const valueKind = input.valueKind ?? 'NUMERIC';
  const template = await prisma.partMeasurementTemplate.create({
    data: {
      fhincd: `AUTH-${suffix}`,
      processGroup: 'CUTTING',
      resourceCd: `AUTH-${suffix}`.slice(0, 30),
      name: `actor auth ${suffix}`,
      selfInspectionMode: 'FIXED_COUNT',
      selfInspectionFixedCount: 1,
      items: {
        create: [
          valueKind === 'JUDGEMENT'
            ? {
                sortOrder: 0,
                datumSurface: 'A',
                measurementPoint: 'ネジ穴深さ 管用',
                measurementLabel: 'ネジ穴深さ',
                displayMarker: '1',
                markerXRatio: '0.2',
                markerYRatio: '0.4',
                valueKind: 'JUDGEMENT',
                nominalValue: null,
                lowerLimit: null,
                upperLimit: null,
                allowNegative: false,
                decimalPlaces: 0
              }
            : {
                sortOrder: 0,
                datumSurface: 'A',
                measurementPoint: 'P1',
                measurementLabel: '寸法1',
                displayMarker: '1',
                markerXRatio: '0.2',
                markerYRatio: '0.4',
                nominalValue: '10',
                lowerLimit: '9.8',
                upperLimit: '10.2',
                allowNegative: false,
                decimalPlaces: 2
              }
        ]
      }
    },
    include: { items: true }
  });
  const session = await prisma.selfInspectionSession.create({
    data: {
      sessionBusinessKey: `actor-auth:${suffix}`,
      templateId: template.id,
      productNo: `PN-${suffix}`,
      processGroup: 'CUTTING',
      resourceCd: template.resourceCd,
      fhincd: template.fhincd,
      fhinmei: 'NFC認証テスト品',
      plannedQuantity: 1,
      expectedEntryCount: 1,
      startedAt: new Date(),
      recordApprovalWorkflowStartedAt: new Date()
    }
  });
  return { session, template, templateItem: template.items[0]! };
}

describe('self-inspection actor NFC authentication and pipe judgement', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  beforeEach(async () => {
    await cleanSelfInspectionTables();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function authenticate(input: {
    sessionId: string;
    employeeTagUid: string;
    clientKey: string;
    measurementMode: 'operator' | 'inspector';
  }) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${input.sessionId}/measurement-actor-authentications`,
      headers: { 'x-client-key': input.clientKey },
      payload: {
        employeeTagUid: input.employeeTagUid,
        measurementMode: input.measurementMode
      }
    });
    expect(response.statusCode).toBe(200);
    return response.json().authentication.id as string;
  }

  it('fails closed without a page authentication, binds it to session/mode/device, and preserves the first owner', async () => {
    const kiosk = await createTestClientDevice();
    const otherKiosk = await createTestClientDevice();
    const firstEmployee = await createTestEmployee({ displayName: '初回測定者' });
    const replacementEmployee = await createTestEmployee({ displayName: '交代測定者' });
    const { session, templateItem } = await createSession();
    const otherSession = await createSession();

    const unauthenticated = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 0, values: [{ templateItemId: templateItem.id, value: '10.00' }] }
    });
    expect(unauthenticated.statusCode).toBe(400);

    const firstAuthenticationId = await authenticate({
      sessionId: session.id,
      employeeTagUid: firstEmployee.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'operator'
    });
    const otherSessionAuthenticationId = await authenticate({
      sessionId: otherSession.session.id,
      employeeTagUid: firstEmployee.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'operator'
    });

    const wrongSession = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId: otherSessionAuthenticationId,
        values: [{ templateItemId: templateItem.id, value: '10.00' }]
      }
    });
    expect(wrongSession.statusCode).toBe(403);

    const wrongDevice = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries`,
      headers: { 'x-client-key': otherKiosk.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId: firstAuthenticationId,
        values: [{ templateItemId: templateItem.id, value: '10.00' }]
      }
    });
    expect(wrongDevice.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId: firstAuthenticationId,
        values: [{ templateItemId: templateItem.id, value: '10.00' }]
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().entry.createdByEmployeeId).toBe(firstEmployee.id);

    const replacementAuthenticationId = await authenticate({
      sessionId: session.id,
      employeeTagUid: replacementEmployee.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'operator'
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries/${created.json().entry.id as string}`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        ifUnmodifiedSince: created.json().entry.updatedAt as string,
        measurementActorAuthenticationId: replacementAuthenticationId,
        values: [{ templateItemId: templateItem.id, value: '10.01' }]
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().entry.createdByEmployeeId).toBe(firstEmployee.id);

    const operations = await prisma.selfInspectionMeasurementOperation.findMany({
      where: { sessionId: session.id },
      orderBy: { occurredAt: 'asc' }
    });
    expect(operations.map((row) => row.authenticationId)).toEqual([
      firstAuthenticationId,
      replacementAuthenticationId
    ]);
    expect(operations.every((row) => row.operationKind === 'ENTRY_CONFIRMED')).toBe(true);
  });

  it('stores pipe-thread NG as a direct OK/NG judgement and permits inspector remeasurement', async () => {
    const kiosk = await createTestClientDevice();
    const operator = await createTestEmployee({ displayName: '管用測定者' });
    const inspector = await createTestEmployee({ displayName: '管用検査員' });
    const { session, templateItem } = await createSession({ valueKind: 'JUDGEMENT' });
    const operatorAuthenticationId = await authenticate({
      sessionId: session.id,
      employeeTagUid: operator.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'operator'
    });

    const operatorSave = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId: operatorAuthenticationId,
        values: [{ templateItemId: templateItem.id, judgementResult: 'FAIL' }]
      }
    });
    expect(operatorSave.statusCode).toBe(200);
    expect(operatorSave.json().entry.values[0]).toMatchObject({
      value: null,
      judgementResult: 'FAIL',
      reviewStatus: 'NOT_REQUIRED'
    });

    const afterOperator = await prisma.selfInspectionSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { inspectorRemeasurementRequiredAt: true, recordApprovalRequiredAt: true }
    });
    expect(afterOperator.inspectorRemeasurementRequiredAt).toBeTruthy();
    expect(afterOperator.recordApprovalRequiredAt).toBeTruthy();

    const inspectorAuthenticationId = await authenticate({
      sessionId: session.id,
      employeeTagUid: inspector.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'inspector'
    });
    const inspectorSave = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId: inspectorAuthenticationId,
        values: [{ templateItemId: templateItem.id, judgementResult: 'FAIL' }]
      }
    });
    expect(inspectorSave.statusCode).toBe(200);
    expect(inspectorSave.json().entry.values[0]).toMatchObject({
      operatorJudgementResultSnapshot: 'FAIL',
      judgementResult: 'FAIL',
      differenceValue: null
    });
  });
});
