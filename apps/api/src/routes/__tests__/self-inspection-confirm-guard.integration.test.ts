import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

/** 1x1 PNG */
const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartPng(name: string, png: Buffer) {
  const boundary = `----vitest${Date.now()}`;
  const crlf = '\r\n';
  const parts: Buffer[] = [];
  const push = (s: string) => parts.push(Buffer.from(s, 'utf8'));
  push(`--${boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="name"${crlf}${crlf}${name}${crlf}`);
  push(`--${boundary}${crlf}`);
  push(
    `Content-Disposition: form-data; name="file"; filename="d.png"${crlf}Content-Type: image/png${crlf}${crlf}`
  );
  parts.push(png);
  push(`${crlf}--${boundary}--${crlf}`);
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function cleanTables() {
  await prisma.selfInspectionMeasurementOperation.deleteMany({});
  await prisma.selfInspectionMeasurementActorAuthentication.deleteMany({});
  await prisma.selfInspectionMeasurementValue.deleteMany({});
  await prisma.selfInspectionLotEntry.deleteMany({});
  await prisma.selfInspectionSession.deleteMany({});
  await prisma.partMeasurementTemplate.deleteMany({});
  await prisma.partMeasurementVisualTemplate.deleteMany({});
}

async function seedScheduleRow(input: {
  productNo: string;
  fseiban: string;
  fhincd: string;
  resourceCd: string;
}): Promise<string> {
  await prisma.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    update: {},
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'ProductionSchedule_Test',
      columnDefinitions: [],
      templateType: 'CARD_GRID',
      templateConfig: {},
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['ProductNo'],
      dateColumnName: 'registeredAt',
      enabled: true
    }
  });
  const row = await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      dataHash: `si-guard-${Date.now()}-${Math.random()}`,
      rowData: {
        ProductNo: input.productNo,
        FSEIBAN: input.fseiban,
        FHINCD: input.fhincd,
        FHINMEI: '品',
        FSIGENCD: input.resourceCd,
        Quantity: 5
      }
    }
  });
  const supplementProductNo = input.productNo.slice(0, 20);
  const supplementResourceCd = input.resourceCd.slice(0, 20);
  await prisma.productionScheduleOrderSupplement.upsert({
    where: { csvDashboardRowId: row.id },
    update: { plannedQuantity: 5 },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: row.id,
      sourceCsvDashboardId: '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31',
      productNo: supplementProductNo,
      resourceCd: supplementResourceCd,
      processOrder: '10',
      plannedQuantity: 5
    }
  });
  return row.id;
}

describe('self-inspection confirm guard + draft WIP', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminToken: string;
  let kioskClient: Awaited<ReturnType<typeof createTestClientDevice>>;
  let employee: Awaited<ReturnType<typeof createTestEmployee>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  beforeEach(async () => {
    await cleanTables();
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
    kioskClient = await createTestClientDevice();
    employee = await createTestEmployee({ displayName: 'Guard Operator' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createFirstLastSession() {
    const { body, contentType } = buildMultipartPng('guard-drawing', MIN_PNG);
    const visualRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/visual-templates',
      headers: { ...createAuthHeader(adminToken), 'content-type': contentType },
      payload: body
    });
    expect(visualRes.statusCode).toBe(200);
    const visualTemplateId = visualRes.json().visualTemplate.id as string;
    const fhincd = `GUARD-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/templates',
      headers: createAuthHeader(adminToken),
      payload: {
        fhincd,
        processGroup: 'cutting',
        resourceCd: '021',
        name: 'guard tpl',
        visualTemplateId,
        selfInspectionMode: 'first_last',
        items: [
          {
            sortOrder: 0,
            datumSurface: 'A',
            measurementPoint: 'P1',
            measurementLabel: '寸法1',
            displayMarker: '1',
            markerXRatio: 0.2,
            markerYRatio: 0.4,
            nominalValue: 10,
            lowerLimit: 9.8,
            upperLimit: 10.2,
            allowNegative: false,
            decimalPlaces: 2
          }
        ]
      }
    });
    expect(createRes.statusCode).toBe(200);
    const templateId = createRes.json().template.id as string;
    const templateItemId = createRes.json().template.items[0].id as string;
    const productNo = `PN-GUARD-${Date.now()}`;
    const fseiban = `FS-GUARD-${Date.now()}`;
    const scheduleRowId = await seedScheduleRow({
      productNo,
      fseiban,
      fhincd,
      resourceCd: '021'
    });
    const resolveRes = await app.inject({
      method: 'POST',
      url: '/api/part-measurement/self-inspection/sessions/resolve-or-create',
      headers: createAuthHeader(adminToken),
      payload: {
        templateId,
        productNo,
        processGroup: 'cutting',
        resourceCd: '021',
        plannedQuantity: 5,
        scheduleRowId,
        fseiban,
        fhincd,
        fhinmei: '品'
      }
    });
    expect(resolveRes.statusCode).toBe(200);
    return {
      sessionId: resolveRes.json().session.id as string,
      productNo,
      templateItemId
    };
  }

  async function authenticateActor(sessionId: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/measurement-actor-authentications`,
      headers: { 'x-client-key': kioskClient.apiKey },
      payload: { employeeTagUid: employee.nfcTagUid, measurementMode: 'operator' }
    });
    expect(response.statusCode).toBe(200);
    return response.json().authentication.id as string;
  }

  it('does not demote CONFIRMED when draft upsert is called', async () => {
    const { sessionId, templateItemId } = await createFirstLastSession();
    const measurementActorAuthenticationId = await authenticateActor(sessionId);
    const createEntryRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries`,
      headers: { 'x-client-key': kioskClient.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId,
        values: [{ templateItemId, value: '10.01' }]
      }
    });
    expect(createEntryRes.statusCode).toBe(200);
    expect(createEntryRes.json().entry.persistenceStatus).toBe('confirmed');

    const draftRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries/draft`,
      headers: { 'x-client-key': kioskClient.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId,
        values: [{ templateItemId, value: '10.02' }]
      }
    });
    expect(draftRes.statusCode).toBe(200);
    expect(draftRes.json().entry.persistenceStatus).toBe('confirmed');
    expect(draftRes.json().entry.values[0]?.value).toBe('10.01');

    const row = await prisma.selfInspectionLotEntry.findFirst({
      where: { sessionId, entryIndex: 0 }
    });
    expect(row?.persistenceStatus).toBe('CONFIRMED');
  });

  it('lists draft-only sessions as in_progress with completedEntryCount 0', async () => {
    const { sessionId, productNo, templateItemId } = await createFirstLastSession();
    const measurementActorAuthenticationId = await authenticateActor(sessionId);
    const draftRes = await app.inject({
      method: 'POST',
      url: `/api/part-measurement/self-inspection/sessions/${sessionId}/entries/draft`,
      headers: { 'x-client-key': kioskClient.apiKey },
      payload: {
        entryIndex: 0,
        measurementActorAuthenticationId,
        values: [{ templateItemId, value: '10.00' }]
      }
    });
    expect(draftRes.statusCode).toBe(200);
    expect(draftRes.json().entry.persistenceStatus).toBe('draft');

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/self-inspection/sessions?status=in_progress&productNo=${encodeURIComponent(productNo)}`,
      headers: { 'x-client-key': kioskClient.apiKey }
    });
    expect(listRes.statusCode).toBe(200);
    const sessions = listRes.json().sessions as Array<{
      id: string;
      status: string;
      completedEntryCount: number;
    }>;
    const hit = sessions.find((row) => row.id === sessionId);
    expect(hit).toBeTruthy();
    expect(hit?.status).toBe('in_progress');
    expect(hit?.completedEntryCount).toBe(0);
  });
});
