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

async function createFixture() {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const template = await prisma.partMeasurementTemplate.create({
    data: {
      fhincd: `GATE-${suffix}`,
      processGroup: 'CUTTING',
      resourceCd: `GATE-${suffix}`.slice(0, 30),
      name: `per-entry gate ${suffix}`,
      selfInspectionMode: 'FULL',
      items: {
        create: {
          sortOrder: 0,
          datumSurface: 'A',
          measurementPoint: 'P1',
          measurementLabel: '寸法1',
          displayMarker: '1',
          markerXRatio: '0.2',
          markerYRatio: '0.4',
          valueKind: 'NUMERIC',
          nominalValue: '10',
          lowerLimit: '9.8',
          upperLimit: '10.2',
          allowNegative: false,
          decimalPlaces: 2
        }
      }
    },
    include: { items: true }
  });
  const session = await prisma.selfInspectionSession.create({
    data: {
      sessionBusinessKey: `per-entry-gate:${suffix}`,
      templateId: template.id,
      productNo: `PN-${suffix}`,
      processGroup: 'CUTTING',
      resourceCd: template.resourceCd,
      fhincd: template.fhincd,
      fhinmei: '個体単位ゲートテスト',
      plannedQuantity: 5,
      expectedEntryCount: 5,
      startedAt: new Date(),
      recordApprovalWorkflowStartedAt: new Date()
    }
  });
  return { session, templateItem: template.items[0]! };
}

describe('self-inspection per-entry inspector gate', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  beforeEach(cleanSelfInspectionTables);

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

  it('gates inspector operations by operator confirmation and locks only the same operator slot', async () => {
    const kiosk = await createTestClientDevice();
    const operator = await createTestEmployee({ displayName: '作業者' });
    const inspector = await createTestEmployee({ displayName: '検査員' });
    const { session, templateItem } = await createFixture();
    const operatorAuth = await authenticate({
      sessionId: session.id,
      employeeTagUid: operator.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'operator'
    });
    const inspectorAuth = await authenticate({
      sessionId: session.id,
      employeeTagUid: inspector.nfcTagUid,
      clientKey: kiosk.apiKey,
      measurementMode: 'inspector'
    });
    const genre = await prisma.measuringInstrumentGenre.create({
      data: { name: `ゲート検証ジャンル-${Date.now()}` }
    });
    const instrument = await prisma.measuringInstrument.create({
      data: {
        managementNumber: `GATE-MI-${Date.now()}`,
        name: 'ゲート検証計測器',
        genreId: genre.id,
        status: 'AVAILABLE'
      }
    });
    const instrumentTagUid = `GATE-MI-TAG-${Date.now()}`;
    await prisma.measuringInstrumentTag.create({
      data: { measuringInstrumentId: instrument.id, rfidTagUid: instrumentTagUid }
    });
    const values = [{ templateItemId: templateItem.id, value: '10.00' }];

    const firstOperatorEntry = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 0, measurementActorAuthenticationId: operatorAuth, values }
    });
    expect(firstOperatorEntry.statusCode).toBe(200);

    const draftEntry = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries/draft`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 1, measurementActorAuthenticationId: operatorAuth, values }
    });
    expect(draftEntry.statusCode).toBe(200);
    expect(draftEntry.json().entry.persistenceStatus).toBe('draft');

    const approvalDetailWhileDraft = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/record-approvals/sessions/${session.id}`,
      headers: { 'x-client-key': kiosk.apiKey }
    });
    expect(approvalDetailWhileDraft.statusCode).toBe(200);
    expect(
      approvalDetailWhileDraft
        .json()
        .session.requiredEntries.find((entry: { entryIndex: number; state: string }) => entry.entryIndex === 1).state
    ).toBe('input_incomplete');

    const blockedInspector = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 1, measurementActorAuthenticationId: inspectorAuth, values }
    });
    expect(blockedInspector.statusCode).toBe(409);
    expect(blockedInspector.json().errorCode).toBe('SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED');
    expect(blockedInspector.json().message).toContain('入力件2は作業者が未確定です');

    const blockedPreUse = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries/1/instrument-usages/pre-use-inspection`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        instrumentTagUid,
        employeeTagUid: inspector.nfcTagUid,
        measurementActorAuthenticationId: inspectorAuth
      }
    });
    expect(blockedPreUse.statusCode).toBe(409);
    expect(blockedPreUse.json().errorCode).toBe('SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED');

    expect(
      await prisma.selfInspectionInspectorEntry.count({ where: { sessionId: session.id } })
    ).toBe(0);
    expect(
      await prisma.selfInspectionInspectorEntryInstrumentUsage.count({
        where: { entry: { sessionId: session.id } }
      })
    ).toBe(0);
    expect(
      await prisma.loan.count({ where: { measuringInstrumentId: instrument.id } })
    ).toBe(0);
    expect(
      await prisma.inspectionRecord.count({ where: { measuringInstrumentId: instrument.id } })
    ).toBe(0);

    const firstInspectorEntry = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 0, measurementActorAuthenticationId: inspectorAuth, values }
    });
    expect(firstInspectorEntry.statusCode).toBe(200);

    const blockedOperatorUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries/${firstOperatorEntry.json().entry.id as string}`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        ifUnmodifiedSince: firstOperatorEntry.json().entry.updatedAt as string,
        measurementActorAuthenticationId: operatorAuth,
        values: [{ templateItemId: templateItem.id, value: '10.01' }]
      }
    });
    expect(blockedOperatorUpdate.statusCode).toBe(409);
    expect(blockedOperatorUpdate.json().errorCode).toBe('SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR');

    const confirmedSecond = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries/${draftEntry.json().entry.id as string}`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        ifUnmodifiedSince: draftEntry.json().entry.updatedAt as string,
        measurementActorAuthenticationId: operatorAuth,
        values
      }
    });
    expect(confirmedSecond.statusCode).toBe(200);
    expect(confirmedSecond.json().entry.persistenceStatus).toBe('confirmed');

    const secondInspectorEntry = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 1, measurementActorAuthenticationId: inspectorAuth, values }
    });
    expect(secondInspectorEntry.statusCode).toBe(200);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-measurements`,
      headers: { 'x-client-key': kiosk.apiKey }
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json().session;
    expect(detail.inspectorSlotStates).toEqual(
      expect.arrayContaining([
        { entryIndex: 0, operatorState: 'confirmed', inspectorState: 'complete' },
        { entryIndex: 1, operatorState: 'confirmed', inspectorState: 'complete' },
        { entryIndex: 2, operatorState: 'missing', inspectorState: 'not_started' }
      ])
    );
    expect(detail.inspectorCompletedRequiredEntryCount).toBe(2);
    expect(detail.inspectorMissingRequiredEntryCount).toBe(3);

    const parallelDraft = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries/draft`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: { entryIndex: 2, measurementActorAuthenticationId: operatorAuth, values }
    });
    expect(parallelDraft.statusCode).toBe(200);
    const [parallelInspector, parallelOperator] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries`,
        headers: { 'x-client-key': kiosk.apiKey },
        payload: { entryIndex: 2, measurementActorAuthenticationId: inspectorAuth, values }
      }),
      app.inject({
        method: 'PATCH',
        url: `/api/part-measurement/self-inspection/sessions/${session.id}/entries/${parallelDraft.json().entry.id as string}`,
        headers: { 'x-client-key': kiosk.apiKey },
        payload: {
          ifUnmodifiedSince: parallelDraft.json().entry.updatedAt as string,
          measurementActorAuthenticationId: operatorAuth,
          values
        }
      })
    ]);
    expect([200, 409]).toContain(parallelInspector.statusCode);
    expect(parallelOperator.statusCode).toBe(200);
    const parallelOperatorRow = await prisma.selfInspectionLotEntry.findUniqueOrThrow({
      where: { sessionId_entryIndex: { sessionId: session.id, entryIndex: 2 } }
    });
    const parallelInspectorCount = await prisma.selfInspectionInspectorEntry.count({
      where: { sessionId: session.id, entryIndex: 2 }
    });
    expect(parallelOperatorRow.persistenceStatus === 'DRAFT' && parallelInspectorCount > 0).toBe(false);
    if (parallelOperatorRow.persistenceStatus === 'DRAFT') {
      expect(parallelInspector.statusCode).toBe(409);
      expect(parallelInspector.json().errorCode).toBe('SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED');
    }
  });

  it('rejects final judgement for a DRAFT operator slot even when inspector data already exists', async () => {
    const kiosk = await createTestClientDevice();
    const operator = await createTestEmployee({ displayName: '判定作業者' });
    const inspector = await createTestEmployee({ displayName: '判定検査員' });
    const { session, templateItem } = await createFixture();
    await prisma.selfInspectionSession.update({
      where: { id: session.id },
      data: { decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT' }
    });
    const operatorEntry = await prisma.selfInspectionLotEntry.create({
      data: {
        sessionId: session.id,
        entryIndex: 0,
        entrySlotKind: 'FIXED',
        persistenceStatus: 'DRAFT',
        createdByEmployeeId: operator.id,
        createdByEmployeeNameSnapshot: operator.displayName,
        values: {
          create: {
            templateItemId: templateItem.id,
            value: '11.00',
            reviewStatus: 'PENDING'
          }
        }
      },
      include: { values: true }
    });
    const inspectorEntry = await prisma.selfInspectionInspectorEntry.create({
      data: {
        sessionId: session.id,
        entryIndex: 0,
        entrySlotKind: 'FIXED',
        inspectorEmployeeId: inspector.id,
        inspectorEmployeeCodeSnapshot: inspector.employeeCode,
        inspectorEmployeeNameSnapshot: inspector.displayName,
        inspectorEmployeeNfcTagUidSnapshot: inspector.nfcTagUid
      }
    });
    await prisma.selfInspectionInspectorMeasurementValue.create({
      data: {
        inspectorEntryId: inspectorEntry.id,
        templateItemId: templateItem.id,
        operatorMeasurementValueId: operatorEntry.values[0]!.id,
        operatorValueSnapshot: '11.00',
        inspectorValue: '11.00',
        judgementStatus: 'NOT_EVALUATED'
      }
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/part-measurement/self-inspection/sessions/${session.id}/inspector-entries/${inspectorEntry.id}/judgements`,
      headers: { 'x-client-key': kiosk.apiKey },
      payload: {
        judgements: [{ templateItemId: templateItem.id, judgementStatus: 'FINAL_OK' }]
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED');
    expect(await prisma.selfInspectionInspectorMeasurementValue.count({ where: { inspectorEntryId: inspectorEntry.id, finalJudgementStatus: { not: null } } })).toBe(0);
  });
});
